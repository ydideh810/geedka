// dex-trending-pools.js
//
// Trending DEX pools with buy/sell pressure across all timeframes.
// Sourced from GeckoTerminal public API (free, no key required).
// Supports 100+ networks: eth, base, bsc, arbitrum, polygon_pos, solana, etc.
//
// Seam origin: GeckoTerminal pool data observed in agent workflows alongside
// market-intelligence and market-overview, signal-intel signals 2026-06-05.
// Complements korean-market-movers (CEX) with on-chain DEX flow data.

const GT_BASE_URL = "https://api.geckoterminal.com/api/v2";
const UA          = "Mozilla/5.0 (compatible; myriad/1.5; +https://synaptiic.org)";
const TIMEOUT_MS  = 10000;

const VALID_NETWORKS = new Set([
  "eth", "base", "bsc", "arbitrum", "polygon_pos", "avax", "optimism",
  "solana", "sui", "ton", "celo", "ftm", "linea", "zksync",
]);

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`GeckoTerminal HTTP ${resp.status}`);
  return resp.json();
}

function formatPool(p) {
  const attr = p.attributes || {};
  const txH24 = attr.transactions?.h24 || {};
  const txH1  = attr.transactions?.h1  || {};
  const volUsd = attr.volume_usd || {};

  const buyPressure24h =
    txH24.buys + txH24.sells > 0
      ? Math.round((txH24.buys / (txH24.buys + txH24.sells)) * 1000) / 10
      : null;

  return {
    pool:              p.id,
    name:              attr.name,
    address:           attr.address,
    base_token_price:  attr.base_token_price_usd
      ? Math.round(parseFloat(attr.base_token_price_usd) * 1e8) / 1e8
      : null,
    quote_token_price: attr.quote_token_price_usd
      ? Math.round(parseFloat(attr.quote_token_price_usd) * 1e6) / 1e6
      : null,
    price_change_pct: {
      m5:  attr.price_change_percentage?.m5  ?? null,
      h1:  attr.price_change_percentage?.h1  ?? null,
      h6:  attr.price_change_percentage?.h6  ?? null,
      h24: attr.price_change_percentage?.h24 ?? null,
    },
    volume_usd_24h:   volUsd.h24 != null ? Math.round(parseFloat(volUsd.h24)) : null,
    volume_usd_1h:    volUsd.h1  != null ? Math.round(parseFloat(volUsd.h1))  : null,
    transactions_h24: {
      buys:    txH24.buys    ?? null,
      sells:   txH24.sells   ?? null,
      buyers:  txH24.buyers  ?? null,
      sellers: txH24.sellers ?? null,
    },
    transactions_h1: {
      buys:   txH1.buys   ?? null,
      sells:  txH1.sells  ?? null,
      buyers: txH1.buyers ?? null,
    },
    buy_pressure_24h_pct: buyPressure24h,
    fdv_usd:     attr.fdv_usd           ? Math.round(parseFloat(attr.fdv_usd))           : null,
    market_cap:  attr.market_cap_usd    ? Math.round(parseFloat(attr.market_cap_usd))    : null,
    pool_age:    attr.pool_created_at   || null,
  };
}

export default {
  name:  "dex-trending-pools",
  price: "$0.059",

  description:
    "Trending DEX liquidity pools with buy/sell pressure data across multiple timeframes (5m, 1h, 6h, 24h). Sourced from GeckoTerminal (free, no key). Supports 100+ networks: eth, base, bsc, arbitrum, polygon_pos, solana, etc. Returns pool name, price, price change %, volume, buy vs sell transaction counts, and a buy_pressure_24h_pct metric (% of transactions that are buys — above 50% = net accumulation, below 50% = net distribution). Useful for spotting early momentum, identifying which on-chain tokens agents are accumulating, and validating signals from price feeds with raw flow data.",

  inputSchema: {
    type: "object",
    properties: {
      network: {
        type: "string",
        description: "Network ID to query. Common: eth, base, bsc, arbitrum, polygon_pos, solana, avax, optimism. Default: base.",
        default: "base",
      },
      page: {
        type: "integer",
        description: "Page of trending pools (20 per page). Default 1, max 10.",
        default: 1,
        minimum: 1,
        maximum: 10,
      },
      min_volume_usd_24h: {
        type: "number",
        description: "Filter pools with less than this 24h volume. Default 10000.",
        default: 10000,
      },
      buy_pressure_min: {
        type: "number",
        description: "Only return pools where buy_pressure_24h_pct >= this value (e.g. 60 = at least 60% buys). Omit for no filter.",
        minimum: 0,
        maximum: 100,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      network: { type: "string" },
      pools: {
        type: "array",
        description: "Trending pools sorted by GeckoTerminal trending rank.",
        items: {
          type: "object",
          properties: {
            pool:                  { type: "string" },
            name:                  { type: "string" },
            address:               { type: "string" },
            base_token_price:      { type: "number" },
            price_change_pct:      { type: "object" },
            volume_usd_24h:        { type: "number" },
            transactions_h24:      { type: "object" },
            buy_pressure_24h_pct:  { type: "number", description: "% of 24h txns that were buys. >50 = accumulation, <50 = distribution." },
            fdv_usd:               { type: "number" },
            pool_age:              { type: "string" },
          },
        },
      },
      count:          { type: "integer" },
      total_returned: { type: "integer" },
      ts:             { type: "string" },
    },
  },

  async handler(query) {
    const network    = (query.network || "base").toLowerCase().trim();
    const page       = Math.min(Math.max(1, parseInt(query.page || "1", 10)), 10);
    const minVol     = query.min_volume_usd_24h ?? 10000;
    const minBP      = query.buy_pressure_min   ?? null;

    const url = `${GT_BASE_URL}/networks/${encodeURIComponent(network)}/trending_pools?page=${page}`;

    let raw;
    try {
      raw = await fetchJson(url);
    } catch (err) {
      if (err.message.includes("404")) {
        throw new Error(`Network "${network}" not found. Common IDs: eth, base, bsc, arbitrum, polygon_pos, solana, avax, optimism.`);
      }
      throw new Error(`GeckoTerminal fetch failed: ${err.message}`);
    }

    let pools = (raw.data || []).map(formatPool);

    // Apply filters
    pools = pools.filter((p) => (p.volume_usd_24h ?? 0) >= minVol);
    if (minBP !== null) {
      pools = pools.filter(
        (p) => p.buy_pressure_24h_pct !== null && p.buy_pressure_24h_pct >= minBP
      );
    }

    return {
      network,
      pools,
      count:          pools.length,
      total_returned: (raw.data || []).length,
      ts: new Date().toISOString(),
    };
  },
};
