// solana-rail.js — Solana x402 payment rail for MYRIAD.
//
// SOLANA-PILOT-01 (2026-07-06): adds Solana USDC as a second payment rail
// alongside the existing Base EVM rail. Intercepts requests carrying a Solana
// X-PAYMENT header, verifies the on-chain USDC transfer via @x402-solana/core,
// and falls through to the EVM middleware for all other requests.
//
// Usage (in server.js): mount buildSolanaRailMiddleware() BEFORE the EVM
// x402Middleware. The middleware is a no-op if SOLANA_WALLET_ADDRESS is unset.

import { createRequire } from "module";
import { appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dir, "..", "logs");

// Solana USDC mint on mainnet-beta (authoritative, never changes)
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
export const SOLANA_WALLET = process.env.SOLANA_WALLET_ADDRESS || null;

// Lazy-loaded X402Middleware (CJS→ESM interop via createRequire)
let _x402Instance = null;
let _x402LoadAttempted = false;

function getX402() {
  if (_x402LoadAttempted) return _x402Instance;
  _x402LoadAttempted = true;
  if (!SOLANA_WALLET) return null;
  try {
    const _require = createRequire(import.meta.url);
    const { X402Middleware } = _require("@x402-solana/server");
    _x402Instance = new X402Middleware({
      solanaRpcUrl: SOLANA_RPC_URL,
      recipientWallet: SOLANA_WALLET,
      network: "mainnet-beta",
    });
    console.log(`[solana-rail] initialized: payTo=${SOLANA_WALLET} rpc=${SOLANA_RPC_URL}`);
  } catch (err) {
    console.warn(`[solana-rail] @x402-solana/server unavailable: ${err.message}`);
    _x402Instance = null;
  }
  return _x402Instance;
}

// Detect whether the X-PAYMENT header carries a Solana payment.
// Solana X-PAYMENT is base64-encoded JSON with network="solana:mainnet-beta"
// (or "solana" or "mainnet-beta" for looser implementations).
function isSolanaPayment(xPayment) {
  if (!xPayment) return false;
  try {
    const decoded = JSON.parse(Buffer.from(String(xPayment), "base64").toString("utf-8"));
    const network = decoded?.network || "";
    return (
      network === "solana" ||
      network.startsWith("solana:") ||
      network === "mainnet-beta"
    );
  } catch {
    return false;
  }
}

// Extract cap name from request path: "/cap/us-stock-price" → "us-stock-price"
function capNameFromPath(path) {
  const prefix = "/cap/";
  if (!path.startsWith(prefix)) return null;
  return path.slice(prefix.length).split("?")[0];
}

// Settlement log entry for Solana payments — same schema as Base settlement.jsonl
// but with rail="solana" and signature instead of tx_hash.
function logSolanaSettlement(capName, price, req, statusCode) {
  try {
    let signature = null;
    let payer = null;
    const xPayment = req.headers["x-payment"];
    if (xPayment) {
      try {
        const decoded = JSON.parse(Buffer.from(String(xPayment), "base64").toString("utf-8"));
        signature = decoded?.payload?.signature || null;
        payer = req.payment?.payer || decoded?.payload?.from || null;
      } catch { /* ok */ }
    }
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      cap: capName,
      price,
      status: statusCode,
      ip: req.ip || "unknown",
      payer,
      tx_hash: signature, // stored as tx_hash for schema compat; is a Solana sig
      rail: "solana",
    });
    appendFileSync(join(LOG_DIR, "settlement.jsonl"), entry + "\n");
  } catch (_) { /* never crash */ }
}

/**
 * Build the Solana payment rail middleware.
 *
 * @param {Array} capabilities - Loaded capability modules (same list as EVM rail)
 * @returns {Function|null} Express middleware, or null if disabled (no wallet)
 */
export function buildSolanaRailMiddleware(capabilities) {
  if (!SOLANA_WALLET) {
    console.warn("[solana-rail] SOLANA_WALLET_ADDRESS not set — Solana rail disabled");
    return (req, res, next) => next(); // pass-through no-op
  }

  // Build price map once: cap name → float price in USD
  const capPrices = new Map(
    capabilities.map((c) => [c.name, parseFloat(c.price.replace("$", ""))])
  );

  return function solanaRailMiddleware(req, res, next) {
    const xPayment = req.headers["x-payment"];

    // Only intercept requests carrying a Solana payment header
    if (!isSolanaPayment(xPayment)) return next();

    // Only apply to /cap/* routes
    const capName = capNameFromPath(req.path);
    if (!capName) return next();

    const price = capPrices.get(capName);
    if (!price) return next(); // unknown cap

    // Load library (lazy, falls back to EVM path if unavailable)
    const x402 = getX402();
    if (!x402) {
      console.warn("[solana-rail] library not available, falling through to EVM");
      return next();
    }

    // Tag the request so downstream handlers know the rail
    req._solanaRail = true;

    // Apply Solana payment verification
    const verify = x402.requirePayment(price);
    verify(req, res, (err) => {
      if (err) return next(err);
      // Payment verified — log and continue to capability handler
      logSolanaSettlement(capName, req.payment?.amount ?? `$${price}`, req, 200);
      next();
    });
  };
}
