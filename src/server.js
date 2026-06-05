// server.js — The Stall. A domain-agnostic x402 capability chassis.
//
// What it does, end to end:
//   1. Loads every capability module from /capabilities.
//   2. Puts each behind an x402 paywall at GET /cap/<name>.
//   3. Exposes FREE /health and /catalog (the catalog is self-describing, so
//      both humans and agents can introspect what this stall sells).
//   4. On first settled payment via a cataloging facilitator, the route
//      auto-surfaces in the x402 Bazaar discovery layer.
//
// The call log is the buyer test. Every paid hit is a real agent deciding,
// with its own money, that this capability was worth it. That signal is the
// whole point — it costs ~nothing to list and lets the market answer.

import "dotenv/config";
import express from "express";
import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadCapabilities } from "./registry.js";
import { buildPaymentMiddleware } from "./payment.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dir, "..", "logs");
mkdirSync(LOG_DIR, { recursive: true });
const PAYMENT_LOG = join(LOG_DIR, "payments.jsonl");

function logPaidCall(capName, price, query, statusCode, ip) {
  try {
    const entry = JSON.stringify({ ts: new Date().toISOString(), cap: capName, price, query, status: statusCode, ip: ip || "unknown" });
    appendFileSync(PAYMENT_LOG, entry + "\n");
  } catch (_) { /* never crash on log failure */ }
}

const PORT = process.env.PORT || 4021;
const PAY_TO = process.env.WALLET_ADDRESS;
const NETWORK = process.env.X402_NETWORK || "base-sepolia";
const FACILITATOR = process.env.FACILITATOR_URL || "https://x402.org/facilitator";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

const capabilities = await loadCapabilities();

const BASE_URL = process.env.BASE_URL || "https://the-stall.intuitek.ai";

// ── FREE introspection routes (not paywalled) ────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ ok: true, network: NETWORK, capabilities: capabilities.map((c) => c.name) })
);

app.get("/catalog", (_req, res) =>
  res.json({
    stall: "the-stall",
    network: NETWORK,
    payTo: PAY_TO ? `${PAY_TO.slice(0, 6)}…${PAY_TO.slice(-4)}` : null,
    capabilities: capabilities.map((c) => ({
      name: c.name,
      path: `/cap/${c.name}`,
      price: c.price,
      description: c.description,
      inputSchema: c.inputSchema,
      outputSchema: c.outputSchema,
    })),
  })
);

// ── x402 Discovery document (Rug-Munch / xpaysh catalog standard) ───────────
app.get("/.well-known/x402", (_req, res) =>
  res.json({
    version: "1.0.0",
    name: "The Stall",
    description: "Domain-agnostic x402 capability chassis by IntuiTek¹. AI-callable data services for USDC on Base mainnet. No API keys or accounts required.",
    url: BASE_URL,
    network: "base",
    currency: "USDC",
    facilitator: FACILITATOR,
    paymentAddress: PAY_TO || null,
    endpoints: capabilities.map((c) => ({
      path: `/cap/${c.name}`,
      method: "GET",
      price: {
        amount: c.price.replace("$", ""),
        currency: "USDC",
        network: "base",
      },
      description: c.description,
    })),
  })
);

// ── A2A Agent Card (ACP / Google A2A discovery standard) ─────────────────────
app.get("/.well-known/agent.json", (_req, res) =>
  res.json({
    name: "The Stall",
    description: "Domain-agnostic x402 capability chassis. Sells AI-callable data services for USDC on Base. Current capabilities: US stock prices, market intelligence, concentration-risk scoring.",
    url: BASE_URL,
    version: "0.4.1",
    provider: {
      organization: "IntuiTek¹",
      url: "https://intuitek.ai",
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: capabilities.map((c) => ({
      id: c.name,
      name: c.name,
      description: c.description,
      inputModes: ["data"],
      outputModes: ["data"],
      tags: ["x402", "data", "finance", "base", "usdc"],
      examples: [],
    })),
    authentication: {
      schemes: ["x402"],
    },
    defaultInputModes: ["data"],
    defaultOutputModes: ["data"],
  })
);

// ── PAID capability routes (x402-gated) ───────────────────────────────────────
app.use(buildPaymentMiddleware({ payTo: PAY_TO, network: NETWORK, facilitator: FACILITATOR, capabilities }));

for (const cap of capabilities) {
  app.get(`/cap/${cap.name}`, async (req, res) => {
    try {
      const out = await cap.handler(req.query, { req });
      logPaidCall(cap.name, cap.price, req.query, 200, req.ip);
      res.json(out);
    } catch (err) {
      logPaidCall(cap.name, cap.price, req.query, 500, req.ip);
      res.status(500).json({ error: "capability_error", capability: cap.name, message: String(err?.message || err) });
    }
  });
}

app.listen(PORT, () => {
  console.log(`\n  THE STALL  ·  open on :${PORT}  ·  network: ${NETWORK}`);
  console.log(`  facilitator: ${FACILITATOR}`);
  console.log(`  payTo: ${PAY_TO || "⚠ NOT SET — paid routes will refuse to boot"}`);
  console.log(`  capabilities (${capabilities.length}): ${capabilities.map((c) => c.name).join(", ") || "none"}`);
  console.log(`  free:  GET /health   GET /catalog`);
  console.log(`  paid:  ${capabilities.map((c) => `GET /cap/${c.name}`).join("   ") || "(none yet — PROSPECTOR's job)"}\n`);
});
