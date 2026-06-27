// cdp-market-depth.js
//
// Real-time Coinbase order book depth and market microstructure for any crypto pair.
// Returns best bid/ask spread, 24h stats (high/low/volume/change), top-N order book
// bids and asks with cumulative notional, order pressure ratio, and last 5 trades.
//
// Sourced from Coinbase Advanced Trade API v3 (authenticated — institutional-grade
// data direct from the exchange, not aggregator delay like CoinGecko).
//
// Seam: agents running crypto-fiat-price, defi-portfolio, or crypto-momentum-pack get
// the price but not the spread, depth, or microstructure. This closes that gap —
// agents deciding WHEN and at WHAT SIZE to execute need order book data.

import { createPrivateKey, sign } from "node:crypto";

const HOST = "api.coinbase.com";
const TIMEOUT_MS = 10_000;

// Load key once at module init (not per-request)
let _privateKey = null;
let _keyName = null;

function getKey() {
  if (_privateKey) return { privateKey: _privateKey, keyName: _keyName };

  const secret = process.env.CDP_API_KEY_SECRET;
  const id = process.env.CDP_API_KEY_ID;
  if (!secret || !id) throw new Error("CDP_API_KEY_ID / CDP_API_KEY_SECRET not set");

  const rawKey = Buffer.from(secret, "base64");
  const pkcs8Header = Buffer.from("302e020100300506032b657004220420", "hex");
  const pkcs8 = Buffer.concat([pkcs8Header, rawKey.slice(0, 32)]);
  _privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  _keyName = id;
  return { privateKey: _privateKey, keyName: _keyName };
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const b64urlJson = (obj) => b64url(JSON.stringify(obj));

function makeJWT(method, path) {
  const { privateKey, keyName } = getKey();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "EdDSA", kid: keyName };
  const payload = { sub: keyName, iss: "cdp", nbf: now, exp: now + 120, uri: `${method} ${HOST}${path}` };
  const signingInput = b64urlJson(header) + "." + b64urlJson(payload);
  const sig = sign(null, Buffer.from(signingInput), _privateKey);
  return signingInput + "." + b64url(sig);
}

async function cdpGet(path, params = "") {
  const res = await fetch(`https://${HOST}${path}${params}`, {
    headers: { Authorization: `Bearer ${makeJWT("GET", path)}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CDP API ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function round(v, d = 6) {
  return Math.round(Number(v) * 10 ** d) / 10 ** d;
}

export default {
  name: "cdp-market-depth",
  price: "$0.059",

  description:
    "Real-time Coinbase order book depth and market microstructure for any crypto trading pair (BTC-USD, ETH-USD, SOL-USD, etc.). Returns best bid/ask spread, 24h price stats (high, low, volume, % change), top-N bids and asks with cumulative notional, order pressure ratio (bid vs ask volume), and the last 5 executed trades. Sourced direct from Coinbase Advanced Trade API — exchange-native, not CoinGecko aggregator delay. Ideal for pre-execution analysis, spread-cost estimation, and market timing.",

  inputSchema: {
    type: "object",
    properties: {
      product_id: {
        type: "string",
        description: "Coinbase product ID in BASE-QUOTE format, e.g. BTC-USD, ETH-USD, SOL-USD, ETH-BTC, CBBTC-USDC. Case-insensitive.",
        default: "BTC-USD",
      },
      depth: {
        type: "integer",
        description: "Number of order book levels to return on each side (bids + asks). 3, 5, or 10. Default 5.",
        enum: [3, 5, 10],
        default: 5,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      product_id:           { type: "string", description: "Canonical Coinbase product ID" },
      price:                { type: "number", description: "Latest trade price (USD or quote currency)" },
      price_change_24h_pct: { type: "number", description: "24-hour price change as a percentage" },
      high_24h:             { type: "number", description: "24-hour high price" },
      low_24h:              { type: "number", description: "24-hour low price" },
      volume_24h:           { type: "number", description: "24-hour trading volume in base currency" },
      best_bid:             { type: "number", description: "Highest current bid price" },
      best_ask:             { type: "number", description: "Lowest current ask price" },
      spread:               { type: "number", description: "Absolute bid-ask spread (ask - bid)" },
      spread_pct:           { type: "number", description: "Spread as % of mid price" },
      bids: {
        type: "array",
        description: "Top bids ordered best-to-worst, each with price, size (base units), and notional (USD equivalent)",
        items: { type: "object", properties: { price: { type: "number" }, size: { type: "number" }, notional: { type: "number" } } },
      },
      asks: {
        type: "array",
        description: "Top asks ordered best-to-worst, each with price, size (base units), and notional (USD equivalent)",
        items: { type: "object", properties: { price: { type: "number" }, size: { type: "number" }, notional: { type: "number" } } },
      },
      bid_volume:       { type: "number", description: "Total base volume across returned bid levels" },
      ask_volume:       { type: "number", description: "Total base volume across returned ask levels" },
      order_pressure:   { type: "number", description: "Bid volume / ask volume. >1 = more buy pressure; <1 = more sell pressure" },
      recent_trades: {
        type: "array",
        description: "Last 5 executed trades on this pair",
        items: { type: "object", properties: { price: { type: "number" }, size: { type: "number" }, side: { type: "string" }, time: { type: "string" } } },
      },
      timestamp: { type: "string", description: "ISO-8601 timestamp of this snapshot" },
    },
  },

  async handler(query) {
    const productId = (query.product_id || "BTC-USD").toUpperCase().trim();
    const depth = Math.min(10, Math.max(3, Number(query.depth) || 5));

    const [productData, bookData, tickerData] = await Promise.all([
      cdpGet(`/api/v3/brokerage/products/${encodeURIComponent(productId)}`),
      cdpGet("/api/v3/brokerage/product_book", `?product_id=${encodeURIComponent(productId)}&limit=${depth}`),
      cdpGet(`/api/v3/brokerage/products/${encodeURIComponent(productId)}/ticker`, "?limit=5"),
    ]);

    const price = round(productData.price, 4);
    const bids = (bookData.pricebook?.bids || []).slice(0, depth).map((b) => ({
      price: round(b.price, 4),
      size: round(b.size, 8),
      notional: round(Number(b.price) * Number(b.size), 2),
    }));
    const asks = (bookData.pricebook?.asks || []).slice(0, depth).map((a) => ({
      price: round(a.price, 4),
      size: round(a.size, 8),
      notional: round(Number(a.price) * Number(a.size), 2),
    }));

    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    const mid = (bestBid + bestAsk) / 2;
    const spread = round(bestAsk - bestBid, 4);
    const spreadPct = mid > 0 ? round((spread / mid) * 100, 4) : 0;

    const bidVolume = round(bids.reduce((s, b) => s + b.size, 0), 8);
    const askVolume = round(asks.reduce((s, a) => s + a.size, 0), 8);
    const orderPressure = askVolume > 0 ? round(bidVolume / askVolume, 4) : null;

    const recentTrades = (tickerData.trades || []).slice(0, 5).map((t) => ({
      price: round(t.price, 4),
      size: round(t.size, 8),
      side: t.side,
      time: t.time,
    }));

    return {
      product_id: productData.product_id || productId,
      price,
      price_change_24h_pct: round(productData.price_percentage_change_24h, 4),
      high_24h: round(productData.high_24h, 4),
      low_24h: round(productData.low_24h, 4),
      volume_24h: round(productData.volume_24h, 4),
      best_bid: bestBid,
      best_ask: bestAsk,
      spread,
      spread_pct: spreadPct,
      bids,
      asks,
      bid_volume: bidVolume,
      ask_volume: askVolume,
      order_pressure: orderPressure,
      recent_trades: recentTrades,
      timestamp: bookData.pricebook?.time || new Date().toISOString(),
    };
  },
};
