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
import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadCapabilities } from "./registry.js";

const { version: PKG_VERSION } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
import { buildPaymentMiddleware } from "./payment.js";
import { makeMcpHandler } from "./mcp.js";

function parseJsonlLog(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return [];
    return raw.split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function readPaymentStats() {
  try {
    const raw = readFileSync(PAYMENT_LOG, "utf8").trim();
    if (!raw) return { total: 0, uniqueCaps: 0, since: null };
    const lines = raw.split("\n").filter(Boolean);
    const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const caps = new Set(entries.map((e) => e.cap));
    const since = entries[0]?.ts ?? null;
    return { total: entries.length, uniqueCaps: caps.size, since };
  } catch {
    return { total: 0, uniqueCaps: 0, since: null };
  }
}

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dir, "..", "logs");
mkdirSync(LOG_DIR, { recursive: true });
const PAYMENT_LOG = join(LOG_DIR, "payments.jsonl");
const REQUEST_LOG = join(LOG_DIR, "requests.jsonl");

function logPaidCall(capName, price, query, statusCode, ip) {
  try {
    const entry = JSON.stringify({ ts: new Date().toISOString(), cap: capName, price, query, status: statusCode, ip: ip || "unknown" });
    appendFileSync(PAYMENT_LOG, entry + "\n");
  } catch (_) { /* never crash on log failure */ }
}

function logRequest(method, path, statusCode, ip, ua, ms) {
  try {
    const entry = JSON.stringify({ ts: new Date().toISOString(), method, path, status: statusCode, ip: ip || "unknown", ua: (ua || "").slice(0, 200), ms });
    appendFileSync(REQUEST_LOG, entry + "\n");
  } catch (_) {}
}

const PORT = process.env.PORT || 4021;
const PAY_TO = process.env.WALLET_ADDRESS;
const NETWORK = process.env.X402_NETWORK || "base-sepolia";
const FACILITATOR = process.env.FACILITATOR_URL || "https://x402.org/facilitator";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// Funnel instrumentation — logs every request on finish for conversion analysis
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logRequest(req.method, req.path, res.statusCode, req.ip, req.get("user-agent"), Date.now() - start);
  });
  next();
});

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
    description: `Domain-agnostic x402 capability chassis by IntuiTek¹. ${capabilities.length} AI-callable data services for USDC on Base — stock prices, DeFi analytics, token security, prediction markets, macro indicators, research papers, domain WHOIS, company intelligence, weather, flight tracking, and more. MCP interface at /mcp — no wallet, no API keys.`,
    url: BASE_URL,
    version: PKG_VERSION,
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
      tags: ["x402", "mcp", "data", "finance", "base", "usdc"],
      examples: [],
    })),
    authentication: {
      schemes: ["x402", "none"],
    },
    defaultInputModes: ["data"],
    defaultOutputModes: ["data"],
    additionalInterfaces: [
      {
        type: "mcp",
        transport: "streamable-http",
        url: `${BASE_URL}/mcp`,
        description: "MCP Streamable HTTP interface — all capabilities available free, no wallet required",
      },
    ],
  })
);

// ── Smithery server card (skip-scan path for capability enumeration) ─────────
app.get("/.well-known/mcp/server-card.json", (_req, res) =>
  res.json({
    name: "The Stall",
    description: `Domain-agnostic x402 capability chassis by IntuiTek¹. ${capabilities.length} AI-callable data tools: stock prices, market overview, DeFi yields, token security, wallet screening, gas prices, macro indicators, prediction markets, company due diligence, research papers, domain WHOIS, email verification, flight tracking, weather, and more. MCP over Streamable HTTP — no wallet, no API keys, no accounts.`,
    version: PKG_VERSION,
    tools: capabilities.map((c) => ({
      name: c.name,
      description: c.description,
      inputSchema: c.inputSchema,
    })),
  })
);

// ── Public landing page — live traction signal ────────────────────────────────
app.get("/", (_req, res) => {
  const stats = readPaymentStats();
  const sinceStr = stats.since
    ? new Date(stats.since).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "N/A";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>The Stall — x402 Intelligence Marketplace</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#e2e8f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
    .brand{font-size:0.75rem;letter-spacing:0.2em;text-transform:uppercase;color:#6366f1;margin-bottom:1rem}
    h1{font-size:2.5rem;font-weight:700;margin-bottom:0.5rem}
    .tagline{color:#94a3b8;margin-bottom:3rem;font-size:1.1rem}
    .stats{display:flex;gap:3rem;margin-bottom:3rem;flex-wrap:wrap;justify-content:center}
    .stat{text-align:center}
    .num{display:block;font-size:3rem;font-weight:800;color:#6366f1;line-height:1}
    .label{display:block;font-size:0.8rem;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;margin-top:0.25rem}
    .since{font-size:0.65rem;color:#475569;margin-top:0.15rem}
    .links{display:flex;gap:1rem;flex-wrap:wrap;justify-content:center}
    a{color:#818cf8;text-decoration:none;padding:0.5rem 1.25rem;border:1px solid #312e81;border-radius:0.5rem;font-size:0.9rem;transition:border-color 0.15s}
    a:hover{border-color:#6366f1}
    .footer{margin-top:4rem;font-size:0.75rem;color:#334155;text-align:center}
    .dot{display:inline-block;width:7px;height:7px;background:#22c55e;border-radius:50%;margin-right:0.4rem;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
  </style>
</head>
<body>
  <div class="brand">IntuiTek¹</div>
  <h1>The Stall</h1>
  <p class="tagline">AI-callable data services. Pay USDC on Base. No accounts.</p>
  <div class="stats">
    <div class="stat">
      <span class="num">${capabilities.length}</span>
      <span class="label">capabilities</span>
    </div>
    <div class="stat">
      <span class="num">${stats.total}</span>
      <span class="label">API calls served</span>
      ${stats.since ? `<span class="since">since ${sinceStr}</span>` : ""}
    </div>
    <div class="stat">
      <span class="num">${stats.uniqueCaps}</span>
      <span class="label">caps called</span>
    </div>
  </div>
  <div class="links">
    <a href="/catalog">Browse catalog</a>
    <a href="/.well-known/x402">x402 manifest</a>
    <a href="/.well-known/agent.json">Agent card</a>
    <a href="/stats">Stats JSON</a>
  </div>
  <div class="footer">
    <span class="dot"></span>Live · Base mainnet · x402 · MCP
    <br><br>
    Built by <a href="https://intuitek.ai" style="border:none;padding:0">IntuiTek¹</a>
  </div>
</body>
</html>`);
});

// ── Machine-readable stats endpoint ──────────────────────────────────────────
app.get("/stats", (_req, res) => {
  const stats = readPaymentStats();
  res.json({
    capabilities: capabilities.length,
    paid_calls_total: stats.total,
    unique_caps_called: stats.uniqueCaps,
    first_call_at: stats.since,
    network: NETWORK,
    base_url: BASE_URL,
    ts: new Date().toISOString(),
  });
});

// ── Funnel metrics — full discovery → probe → pay conversion view ─────────────
app.get("/metrics", (_req, res) => {
  const requests = parseJsonlLog(REQUEST_LOG);
  const payments = parseJsonlLog(PAYMENT_LOG);

  const catalogHits = requests.filter(r => r.path === "/catalog").length;
  const healthHits = requests.filter(r => r.path === "/health").length;
  const mcpCalls = requests.filter(r => r.path === "/mcp").length;
  const probes = requests.filter(r => r.path?.startsWith("/cap/") && r.status === 402);
  const uniqueIPs = new Set(requests.map(r => r.ip)).size;
  const uniqueProbeIPs = new Set(probes.map(r => r.ip)).size;

  const probesByCap = {};
  for (const r of probes) {
    const cap = r.path.replace("/cap/", "");
    probesByCap[cap] = (probesByCap[cap] || 0) + 1;
  }

  const uaGroups = {};
  for (const r of requests) {
    const ua = r.ua?.slice(0, 60) || "unknown";
    uaGroups[ua] = (uaGroups[ua] || 0) + 1;
  }

  res.json({
    funnel: {
      catalog_hits: catalogHits,
      health_hits: healthHits,
      mcp_calls: mcpCalls,
      cap_probes_402: probes.length,
      paid_calls: payments.length,
    },
    conversion: {
      probe_to_pay_rate: probes.length > 0 ? (payments.length / probes.length).toFixed(4) : null,
      catalog_to_probe_rate: catalogHits > 0 ? (probes.length / catalogHits).toFixed(4) : null,
    },
    unique_ips: uniqueIPs,
    unique_probe_ips: uniqueProbeIPs,
    top_probed_caps: Object.entries(probesByCap).sort((a, b) => b[1] - a[1]).slice(0, 15),
    top_user_agents: Object.entries(uaGroups).sort((a, b) => b[1] - a[1]).slice(0, 10),
    request_total: requests.length,
    ts: new Date().toISOString(),
  });
});

// ── MCP Streamable HTTP endpoint (free — handlers called directly, no x402) ──
app.post("/mcp", makeMcpHandler(capabilities));
app.get("/mcp", (_req, res) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST for MCP requests" }, id: null })
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
