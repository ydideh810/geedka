// dex-pair-search.js
//
// Search DEX trading pairs across 50+ chains by token symbol, name, or address.
// Upstream: DexScreener public API (free, no key required).
//
// Seam: blockrun.ai/api/v1/pm/dflow/trades — 34 payers, 167 calls/7d.
// Complements dex-trending-pools (trending) with token-specific pair search.

const DS_BASE = "https://api.dexscreener.com/latest/dex";
const UA      = "Mozilla/5.0 (compatible; the-stall/1.5; +https://intuitek.ai)";
const TIMEOUT = 10000;

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`DexScreener HTTP ${r.status}`);
  return r.json();
}

function formatPair(p) {
  const vol  = p.volume  || {};
  const txns = p.txns    || {};
  const ch   = p.priceChange || {};
  const liq  = p.liquidity  || {};
  const h24t = txns.h24  || {};

  const buyPressure =
    (h24t.buys || 0) + (h24t.sells || 0) > 0
      ? Math.round((h24t.buys / (h24t.buys + h24t.sells)) * 1000) / 10
      : null;

  return {
    pair_address:  p.pairAddress,
    chain:         p.chainId,
    dex:           p.dexId,
    base_token:    { symbol: p.baseToken?.symbol, name: p.baseToken?.name, address: p.baseToken?.address },
    quote_token:   { symbol: p.quoteToken?.symbol, name: p.quoteToken?.name, address: p.quoteToken?.address },
    price_usd:     p.priceUsd ? parseFloat(p.priceUsd) : null,
    price_native:  p.priceNative ? parseFloat(p.priceNative) : null,
    price_change:  { m5: ch.m5 ?? null, h1: ch.h1 ?? null, h6: ch.h6 ?? null, h24: ch.h24 ?? null },
    volume_usd:    { h24: vol.h24 ?? null, h6: vol.h6 ?? null, h1: vol.h1 ?? null, m5: vol.m5 ?? null },
    txns_h24:      { buys: h24t.buys ?? null, sells: h24t.sells ?? null },
    buy_pressure_24h_pct: buyPressure,
    liquidity_usd: liq.usd ?? null,
    fdv:           p.fdv ?? null,
    market_cap:    p.marketCap ?? null,
    pair_created:  p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
  };
}

export default {
  name:  "dex-pair-search",
  price: "$0.005",

  description:
    "Search DEX trading pairs for any token (by symbol, name, or contract address) across 50+ chains including Ethereum, Solana, Base, BSC, Arbitrum, Polygon, and Avalanche. Returns top pairs by liquidity with real-time price, 24h volume, buy/sell transaction counts, price change %, and buy pressure metric. Free via DexScreener. Ideal for agents tracking on-chain trade flow, entry/exit signals, or multi-chain token prices without maintaining DEX integrations.",

  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Token symbol (e.g. SOL, ETH, USDC), name, or contract address to search.",
      },
      chain: {
        type: "string",
        description: "Optional: filter to a specific chain ID (solana, base, eth, bsc, arbitrum, polygon, etc.).",
      },
      limit: {
        type: "integer",
        description: "Max pairs to return (1–30). Default 10.",
        default: 10,
        minimum: 1,
        maximum: 30,
      },
      min_liquidity_usd: {
        type: "number",
        description: "Filter pairs with less than this USD liquidity. Default 10000.",
        default: 10000,
      },
    },
    required: ["q"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      query:  { type: "string" },
      pairs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pair_address:        { type: "string" },
            chain:               { type: "string" },
            dex:                 { type: "string" },
            base_token:          { type: "object" },
            quote_token:         { type: "object" },
            price_usd:           { type: "number" },
            price_change:        { type: "object" },
            volume_usd:          { type: "object" },
            txns_h24:            { type: "object" },
            buy_pressure_24h_pct: { type: "number", description: "% of 24h txns that were buys. >50 = net accumulation." },
            liquidity_usd:       { type: "number" },
            fdv:                 { type: "number" },
          },
        },
      },
      count: { type: "integer" },
      ts:    { type: "string" },
    },
  },

  async handler(query) {
    const q      = (query.q || "").trim();
    const chain  = (query.chain || "").toLowerCase().trim();
    const limit  = Math.min(Math.max(1, parseInt(query.limit || "10", 10)), 30);
    const minLiq = query.min_liquidity_usd ?? 10000;

    if (!q) throw new Error("q is required");

    const url = `${DS_BASE}/search?q=${encodeURIComponent(q)}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      throw new Error(`DexScreener search failed: ${err.message}`);
    }

    let pairs = (data.pairs || []).map(formatPair);

    if (chain) pairs = pairs.filter((p) => p.chain === chain);
    pairs = pairs.filter((p) => (p.liquidity_usd ?? 0) >= minLiq);
    pairs = pairs
      .sort((a, b) => (b.liquidity_usd ?? 0) - (a.liquidity_usd ?? 0))
      .slice(0, limit);

    return { query: q, pairs, count: pairs.length, ts: new Date().toISOString() };
  },
};
