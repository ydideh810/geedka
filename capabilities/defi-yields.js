// defi-yields.js
//
// Returns top DeFi yield pools ranked by APY from DeFiLlama's public yields API.
// Covers 16,000+ pools across 400+ protocols and 50+ chains. Free upstream —
// no API key, no rate limit, updated continuously. Priced at $0.025, undercutting
// otto.ai's /yield-markets and /yield-farming-active endpoints (both observed
// generating organic seam traffic, strength 1.0, signal-intel signals 52618/52618).
//
// Data source: https://yields.llama.fi/pools (DeFiLlama public API).

const LLAMA_POOLS = "https://yields.llama.fi/pools";
const UA          = "Mozilla/5.0 (compatible; myriad/0.7; +https://synaptiic.org)";

export default {
  name: "defi-yields",
  price: "$0.059",

  description:
    "Returns top DeFi yield pools ranked by APY from DeFiLlama. Covers 16,000+ pools across 400+ protocols and 50+ chains (Ethereum, Base, Solana, Arbitrum, Polygon, etc.). Filter by chain, minimum APY, minimum TVL, or stablecoin-only. Each pool includes APY breakdown (base + reward), TVL, 7-day APY change, and a direct DeFiLlama link. Sourced from DeFiLlama public API — no key required, updated continuously.",

  inputSchema: {
    type: "object",
    properties: {
      chain: {
        type: "string",
        description: "Filter to a specific chain (e.g. Ethereum, Base, Solana, Arbitrum, Polygon). Case-insensitive. Omit for all chains.",
      },
      min_apy: {
        type: "number",
        description: "Minimum APY percentage (e.g. 5 for 5%). Default: 0.",
      },
      min_tvl_usd: {
        type: "number",
        description: "Minimum TVL in USD (e.g. 1000000 for $1M). Default: 100000.",
      },
      stablecoin_only: {
        type: "boolean",
        description: "If true, return only stablecoin-denominated pools. Default: false.",
      },
      limit: {
        type: "integer",
        description: "Max results to return (default 20, max 50).",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      pools: {
        type: "array",
        description: "Yield pools matching filters, sorted by APY descending.",
        items: {
          type: "object",
          properties: {
            project:     { type: "string",  description: "Protocol name (e.g. aave-v3, uniswap-v3)." },
            symbol:      { type: "string",  description: "Pool token symbol (e.g. USDC, ETH-USDC)." },
            chain:       { type: "string",  description: "Chain name." },
            apy:         { type: "number",  description: "Total APY % (base + reward)." },
            apy_base:    { type: "number",  description: "Base APY % (lending/protocol yield, no token rewards)." },
            apy_reward:  { type: "number",  description: "Reward APY % (token incentives on top of base)." },
            apy_7d_pct_change: { type: "number", description: "APY change over last 7 days in percentage points." },
            tvl_usd:     { type: "number",  description: "Total value locked in USD." },
            stablecoin:  { type: "boolean", description: "True if pool is denominated in stablecoins." },
            pool_id:     { type: "string",  description: "DeFiLlama pool UUID for precise reference." },
            url:         { type: "string",  description: "DeFiLlama pool page URL." },
          },
        },
      },
      total_matched: {
        type: "integer",
        description: "Total pools matching the given filters before the limit was applied.",
      },
      ts: { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const chain          = (query.chain || "").trim() || null;
    const min_apy        = Number(query.min_apy ?? 0);
    const min_tvl_usd    = Number(query.min_tvl_usd ?? 100_000);
    const stablecoin_only = query.stablecoin_only === true || query.stablecoin_only === "true";
    const limit          = Math.min(Math.max(1, parseInt(query.limit) || 20), 50);

    let data;
    try {
      const resp = await fetch(LLAMA_POOLS, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) throw new Error(`DeFiLlama returned ${resp.status}`);
      data = await resp.json();
    } catch (err) {
      throw new Error(`upstream fetch failed: ${err.message}`);
    }

    const allPools = data?.data;
    if (!Array.isArray(allPools)) throw new Error("unexpected DeFiLlama response shape");

    const chainLc = chain ? chain.toLowerCase() : null;

    const filtered = allPools.filter((p) => {
      if (p.outlier) return false;                              // DeFiLlama marks anomalous pools
      if (chainLc && (p.chain || "").toLowerCase() !== chainLc) return false;
      if ((p.apy ?? 0) < min_apy) return false;
      if ((p.tvlUsd ?? 0) < min_tvl_usd) return false;
      if (stablecoin_only && !p.stablecoin) return false;
      return true;
    });

    filtered.sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0));

    const round2 = (v) => (v != null ? Math.round(v * 100) / 100 : null);

    const pools = filtered.slice(0, limit).map((p) => ({
      project:           p.project || null,
      symbol:            p.symbol  || null,
      chain:             p.chain   || null,
      apy:               round2(p.apy),
      apy_base:          round2(p.apyBase),
      apy_reward:        round2(p.apyReward),
      apy_7d_pct_change: round2(p.apyPct7D),
      tvl_usd:           p.tvlUsd != null ? Math.round(p.tvlUsd) : null,
      stablecoin:        p.stablecoin ?? false,
      pool_id:           p.pool || null,
      url:               p.pool ? `https://defillama.com/yields?pool=${p.pool}` : null,
    }));

    return { pools, total_matched: filtered.length, ts: new Date().toISOString() };
  },
};
