// yield-farming-active.js
//
// Active DeFi yield farming pools sorted by 30-day average APY.
// Collapses the observed seam: x402.ottoai.services/yield-farming-active
// → x402.ottoai.services/tx-explainer chain.
// PROSPECTOR signal: 13 distinct wallets, 8-day persistence, strength 1.0.
// Priced at $0.005 (70% of observed chain avg).
//
// Free upstream: DeFiLlama yields API (yields.llama.fi) — no API key required.

const YIELDS_URL = "https://yields.llama.fi/pools";
const UA         = "Mozilla/5.0 (compatible; the-stall/0.7; +https://intuitek.ai)";

export default {
  name:  "yield-farming-active",
  price: "$0.005",

  description:
    "Returns active DeFi yield farming pools sorted by 30-day average APY. Sourced from DeFiLlama (free, no key). Each pool includes protocol, chain, symbol, TVL, current APY, 30-day mean APY, impermanent-loss risk, and stablecoin flag. Filter by chain, protocol, minimum TVL, minimum APY, or stablecoin-only pools. Use for portfolio yield research, pre-trade DeFi reconnaissance, or capital allocation decisions.",

  inputSchema: {
    type: "object",
    properties: {
      chain: {
        type: "string",
        description:
          "Filter by blockchain (e.g. 'Ethereum', 'Base', 'Polygon', 'Arbitrum', 'Solana'). Case-insensitive. Omit for all chains.",
      },
      protocol: {
        type: "string",
        description:
          "Filter by protocol name (e.g. 'aave-v3', 'uniswap-v3', 'curve', 'lido'). Case-insensitive substring match.",
      },
      min_tvl_usd: {
        type: "number",
        description:
          "Minimum Total Value Locked in USD. Default 1000000 ($1M). Lower values include smaller pools with potentially higher (but riskier) yields.",
        default: 1000000,
        minimum: 0,
      },
      min_apy: {
        type: "number",
        description:
          "Minimum APY percentage to include (based on 30-day mean). Default 0. E.g. 5 returns pools yielding ≥5% annualized.",
        default: 0,
        minimum: 0,
      },
      stablecoin_only: {
        type: "boolean",
        description:
          "If true, returns only stablecoin pools (no impermanent loss from token price volatility). Default false.",
      },
      sort_by: {
        type: "string",
        enum: ["apy_30d", "apy_current", "tvl"],
        description:
          "Sort order: 'apy_30d' (30-day average APY, default and most stable), 'apy_current' (live APY, more volatile), 'tvl' (largest pools first).",
        default: "apy_30d",
      },
      limit: {
        type: "integer",
        description: "Number of pools to return (1–50, default 20).",
        default: 20,
        minimum: 1,
        maximum: 50,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      pools: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rank:          { type: "integer",  description: "Position in sorted result set (1-based)." },
            protocol:      { type: "string",   description: "Protocol name (e.g. 'aave-v3')." },
            chain:         { type: "string",   description: "Blockchain (e.g. 'Ethereum')." },
            symbol:        { type: "string",   description: "LP or single-asset token symbol." },
            tvl_usd:       { type: "number",   description: "Total Value Locked in USD." },
            apy_current:   { type: "number",   description: "Current APY (%)." },
            apy_30d_mean:  { type: "number",   description: "30-day mean APY (%) — more reliable signal than spot." },
            apy_base:      { type: "number",   description: "Base (non-reward) APY component (%)." },
            apy_reward:    { type: "number",   description: "Reward token APY component (%)." },
            il_risk:       { type: "string",   description: "Impermanent loss risk: 'no', 'low', 'medium', 'high', 'very high'." },
            stablecoin:    { type: "boolean",  description: "True if this is a stablecoin-only pool." },
            exposure:      { type: "string",   description: "'single' (no IL risk) or 'multi' (exposed to IL)." },
            pool_meta:     { type: "string",   description: "Extra pool context (e.g. fee tier, lock duration). May be null." },
          },
        },
      },
      total_returned:    { type: "integer" },
      total_matching:    { type: "integer", description: "Pools matching filters before limit." },
      filters_applied:   { type: "object" },
      generated_at:      { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(input) {
    const chainFilter     = (input.chain    || "").trim().toLowerCase();
    const protocolFilter  = (input.protocol || "").trim().toLowerCase();
    const minTvl          = Number(input.min_tvl_usd ?? 1_000_000);
    const minApy          = Number(input.min_apy ?? 0);
    const stablecoinOnly  = Boolean(input.stablecoin_only);
    const sortBy          = input.sort_by || "apy_30d";
    const limit           = Math.min(Math.max(parseInt(input.limit || "20", 10), 1), 50);

    const resp = await fetch(YIELDS_URL, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal:  AbortSignal.timeout(20_000),
    });
    if (!resp.ok) throw new Error(`DeFiLlama yields API HTTP ${resp.status}`);

    const { data } = await resp.json();
    if (!Array.isArray(data)) throw new Error("Unexpected DeFiLlama response shape");

    let pools = data.filter(p => {
      if (!p || typeof p.apy !== "number") return false;
      const tvl   = p.tvlUsd ?? 0;
      const apy30 = p.apyMean30d ?? p.apy;
      if (tvl < minTvl)    return false;
      if (apy30 < minApy)  return false;
      if (stablecoinOnly && !p.stablecoin) return false;
      if (chainFilter    && (p.chain    || "").toLowerCase() !== chainFilter)   return false;
      if (protocolFilter && !(p.project || "").toLowerCase().includes(protocolFilter)) return false;
      return true;
    });

    // Sort
    const sortFn = sortBy === "tvl"
      ? (a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)
      : sortBy === "apy_current"
        ? (a, b) => (b.apy ?? 0) - (a.apy ?? 0)
        : (a, b) => ((b.apyMean30d ?? b.apy ?? 0)) - ((a.apyMean30d ?? a.apy ?? 0));
    pools.sort(sortFn);

    const totalMatching = pools.length;
    pools = pools.slice(0, limit);

    return {
      pools: pools.map((p, i) => ({
        rank:         i + 1,
        protocol:     p.project  ?? "unknown",
        chain:        p.chain    ?? "unknown",
        symbol:       p.symbol   ?? "unknown",
        tvl_usd:      Math.round(p.tvlUsd ?? 0),
        apy_current:  Number((p.apy ?? 0).toFixed(4)),
        apy_30d_mean: Number((p.apyMean30d ?? p.apy ?? 0).toFixed(4)),
        apy_base:     Number((p.apyBase ?? 0).toFixed(4)),
        apy_reward:   Number((p.apyReward ?? 0).toFixed(4)),
        il_risk:      p.ilRisk  ?? "unknown",
        stablecoin:   Boolean(p.stablecoin),
        exposure:     p.exposure ?? "unknown",
        pool_meta:    p.poolMeta ?? null,
      })),
      total_returned:  pools.length,
      total_matching:  totalMatching,
      filters_applied: { chainFilter, protocolFilter, minTvl, minApy, stablecoinOnly, sortBy },
      generated_at:    new Date().toISOString(),
    };
  },
};
