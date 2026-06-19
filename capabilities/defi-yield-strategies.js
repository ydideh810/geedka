// defi-yield-strategies.js
//
// Portfolio-level DeFi yield strategy planner.
// Given a portfolio size and risk tolerance, returns an optimized allocation
// across top DeFi yield opportunities with risk-adjusted expected yield.
//
// Seam: orbisapi.com/proxy/defi-yield-strategies-api-bfb3cd
//   23 payers / 2,392 calls in 3d (observed 2026-06-09 via signal-intel).
//   This cap provides richer output (full allocation plan + per-position APY
//   breakdown) at $0.006 — 20% undercut from observed $0.0050/call.
//
// Upstream: DeFiLlama yields API (free, no key, 16K+ pools across 400+ protocols).

const YIELDS_URL = "https://yields.llama.fi/pools";
const UA         = "Mozilla/5.0 (compatible; the-stall/4.42; +https://intuitek.ai)";
const TIMEOUT_MS = 15000;

async function fetchPools() {
  const resp = await fetch(YIELDS_URL, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`DeFiLlama API HTTP ${resp.status}`);
  const data = await resp.json();
  return data.data || [];
}

function riskFilter(pool, risk) {
  const tvl   = pool.tvlUsd || 0;
  const apy   = pool.apy    || 0;
  const stable = pool.stablecoin || false;

  if (risk === "low") {
    return stable && apy < 30 && tvl >= 50_000_000 && apy > 0;
  } else if (risk === "medium") {
    return tvl >= 10_000_000 && apy < 80 && apy > 0;
  } else {
    // high
    return tvl >= 1_000_000 && apy > 0 && apy < 500;
  }
}

function tvlScore(tvl) {
  // Logarithmic TVL weight — big pools get a boost but not linear
  if (tvl <= 0) return 0;
  return Math.log10(tvl / 1_000_000 + 1);
}

function diversityBonus(positions, protocol, chain) {
  // Penalty for over-concentration in one protocol or chain
  const sameProtocol = positions.filter(p => p.protocol === protocol).length;
  const sameChain    = positions.filter(p => p.chain === chain).length;
  const protocolPenalty = Math.max(0, 1 - sameProtocol * 0.25);
  const chainPenalty    = Math.max(0, 1 - sameChain    * 0.15);
  return protocolPenalty * chainPenalty;
}

function scorePool(pool, positions) {
  const apy   = pool.apy || 0;
  const bonus = diversityBonus(positions, pool.project, pool.chain);
  return apy * tvlScore(pool.tvlUsd) * bonus;
}

function allocate(candidates, totalUsd, maxPositions) {
  // Proportional allocation by score, capped at maxPositions
  const topN  = candidates.slice(0, maxPositions);
  const total = topN.reduce((s, c) => s + c.score, 0);
  if (total === 0) return [];

  return topN.map(c => {
    const fraction = c.score / total;
    const allocated = totalUsd * fraction;
    const weeklyYield = allocated * (c.pool.apy / 100) / 52;
    return {
      protocol:       c.pool.project || "unknown",
      pool:           c.pool.pool,
      symbol:         c.pool.symbol || "",
      chain:          c.pool.chain  || "",
      apy:            parseFloat((c.pool.apy || 0).toFixed(2)),
      apy_7d_change:  parseFloat((c.pool.apyPct7D || 0).toFixed(2)),
      tvl_usd:        Math.round(c.pool.tvlUsd || 0),
      stablecoin:     c.pool.stablecoin || false,
      allocated_usd:  parseFloat(allocated.toFixed(2)),
      weekly_yield_usd: parseFloat(weeklyYield.toFixed(4)),
      allocation_pct: parseFloat((fraction * 100).toFixed(1)),
    };
  });
}

export default {
  name:  "defi-yield-strategies",
  price: "$0.006",

  description:
    "DeFi yield strategy planner. Given a portfolio size and risk tolerance, returns an optimized allocation across top DeFi yield opportunities. Risk tiers: low (stablecoins only, APY < 30%, TVL ≥ $50M), medium (TVL ≥ $10M, APY < 80%), high (TVL ≥ $1M, all assets). Output includes per-position allocation, APY, weekly yield estimate, chain, and 7-day APY trend. Covers 16K+ pools across 400+ DeFi protocols via DeFiLlama.",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      amount_usd: {
        type: "number",
        description: "Portfolio size in USD to allocate (e.g. 10000).",
      },
      risk_tolerance: {
        type: "string",
        enum: ["low", "medium", "high"],
        default: "medium",
        description: "Risk tier: low (stablecoin-only, large TVL), medium (mixed assets, min $10M TVL), high (any asset, min $1M TVL). Default: medium.",
      },
      chains: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of chains to include (e.g. [\"Ethereum\", \"Base\", \"Arbitrum\"]). Omit for all chains.",
      },
      max_positions: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        default: 5,
        description: "Maximum number of positions in the strategy. Default: 5.",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      strategy: {
        type: "array",
        description: "Recommended positions with allocation details.",
        items: {
          type: "object",
          properties: {
            protocol:           { type: "string",  description: "DeFi protocol name." },
            pool:               { type: "string",  description: "DeFiLlama pool UUID." },
            symbol:             { type: "string",  description: "Pool token symbol." },
            chain:              { type: "string",  description: "Blockchain name." },
            apy:                { type: "number",  description: "Current APY %." },
            apy_7d_change:      { type: "number",  description: "7-day APY change in percentage points." },
            tvl_usd:            { type: "number",  description: "Total value locked in USD." },
            stablecoin:         { type: "boolean", description: "True if stablecoin pool." },
            allocated_usd:      { type: "number",  description: "Recommended allocation in USD." },
            weekly_yield_usd:   { type: "number",  description: "Estimated weekly yield in USD." },
            allocation_pct:     { type: "number",  description: "Allocation as percent of total portfolio." },
          },
        },
      },
      summary: {
        type: "object",
        properties: {
          total_allocated_usd:        { type: "number",  description: "Total portfolio amount allocated." },
          positions:                  { type: "integer", description: "Number of positions in strategy." },
          estimated_weekly_yield_usd: { type: "number",  description: "Expected weekly yield across all positions." },
          estimated_annual_yield_usd: { type: "number",  description: "Expected annual yield (weekly × 52)." },
          weighted_avg_apy:           { type: "number",  description: "Allocation-weighted average APY %." },
          risk_tier:                  { type: "string",  description: "Risk tier used." },
          chains_included:            { type: "string",  description: "Chains included in strategy." },
        },
      },
      note: {
        type: "string",
        description: "Optional note if no pools matched filters.",
      },
    },
  },

  async handler({ amount_usd = 1000, risk_tolerance = "medium", chains, max_positions = 5 }) {
    if (amount_usd <= 0) {
      throw new Error("amount_usd must be a positive number.");
    }

    const allPools = await fetchPools();

    // Filter by chain
    let filtered = allPools;
    if (chains && chains.length > 0) {
      const chainSet = new Set(chains.map(c => c.toLowerCase()));
      filtered = filtered.filter(p => chainSet.has((p.chain || "").toLowerCase()));
    }

    // Apply risk filter
    filtered = filtered.filter(p => riskFilter(p, risk_tolerance));

    if (filtered.length === 0) {
      return {
        strategy: [],
        summary: {
          total_allocated_usd: 0,
          positions: 0,
          estimated_weekly_yield_usd: 0,
          estimated_annual_yield_usd: 0,
          weighted_avg_apy: 0,
          risk_tier: risk_tolerance,
        },
        note: "No pools matched the specified filters. Try relaxing chain restrictions or adjusting risk_tolerance.",
      };
    }

    // Score with diversity bonus
    const positions_so_far = [];
    const scored = filtered.map(p => {
      const score = scorePool(p, positions_so_far);
      return { pool: p, score };
    });

    // Greedy selection with diversity
    const selected = [];
    const remaining = [...scored].sort((a, b) => b.score - a.score);

    for (let i = 0; i < max_positions && remaining.length > 0; i++) {
      // Re-score top candidates with current selected set for diversity
      const topCandidates = remaining.slice(0, Math.min(50, remaining.length));
      topCandidates.forEach(c => {
        c.score = scorePool(c.pool, selected.map(s => s.pool));
      });
      topCandidates.sort((a, b) => b.score - a.score);

      const best = topCandidates[0];
      selected.push(best);
      const idx = remaining.indexOf(best);
      if (idx !== -1) remaining.splice(idx, 1);
    }

    const strategy = allocate(selected, amount_usd, max_positions);
    const totalWeekly = strategy.reduce((s, p) => s + p.weekly_yield_usd, 0);
    const weightedAPY = strategy.reduce((s, p) => s + (p.apy * p.allocation_pct / 100), 0);

    return {
      strategy,
      summary: {
        total_allocated_usd:        parseFloat(amount_usd.toFixed(2)),
        positions:                  strategy.length,
        estimated_weekly_yield_usd: parseFloat(totalWeekly.toFixed(4)),
        estimated_annual_yield_usd: parseFloat((totalWeekly * 52).toFixed(2)),
        weighted_avg_apy:           parseFloat(weightedAPY.toFixed(2)),
        risk_tier:                  risk_tolerance,
        chains_included:            chains ? chains.join(", ") : "all",
      },
    };
  },
};
