// protocol-revenue-leaders.js
//
// Returns DeFi protocols ranked by daily fees, with 7d/30d trend context.
// Seams against x402.ottoai.services /protocol-revenue-leaders ($0.001) and
// dataendpoints-production.up.railway.app /protocol-revenue-leaders.
// Free upstream: DefiLlama /overview/fees (no auth, updated continuously).
// Priced at $0.001 — matching seam price, differentiating on MCP-native access.

const FEES_URL = "https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true";
const UA       = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";
const TIMEOUT  = 15_000;

export default {
  name: "protocol-revenue-leaders",
  price: "$0.039",

  description:
    "Returns DeFi protocols ranked by daily fees (revenue generated). Covers 1000+ protocols across chains — DEXes, lending markets, derivatives, stablecoins. Includes 1d/7d/30d trend context, category breakdown, and chain presence. Use to identify which protocols are capturing the most economic activity, screen for fundamental DeFi strength, or compare protocol revenue trajectories.",

  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Number of protocols to return. Default 20, max 100.",
        default: 20,
      },
      sort_by: {
        type: "string",
        enum: ["daily_fees", "7d_fees", "30d_fees", "1d_change"],
        description: "Ranking metric. 'daily_fees' = 24h fees (default). '7d_fees' = 7-day total. '30d_fees' = 30-day total. '1d_change' = biggest 1-day fee growth (%).",
        default: "daily_fees",
      },
      category: {
        type: "string",
        description: "Filter by protocol category (e.g. 'Dexes', 'Lending', 'Derivatives', 'CDP', 'Liquid Staking', 'Bridge'). Case-insensitive partial match.",
      },
      min_daily_fees: {
        type: "number",
        description: "Minimum 24h fees in USD to include a protocol (e.g. 10000 for $10K+). Filters out noise.",
        default: 1000,
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      timestamp:          { type: "string" },
      total_protocols:    { type: "integer" },
      ranked_by:          { type: "string" },
      leaders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            rank:           { type: "integer" },
            name:           { type: "string" },
            slug:           { type: "string" },
            category:       { type: "string" },
            chains:         { type: "array", items: { type: "string" } },
            daily_fees_usd: { type: "number" },
            fees_7d_usd:    { type: "number" },
            fees_30d_usd:   { type: "number" },
            change_1d_pct:  { type: "number" },
            change_7d_pct:  { type: "number" },
          },
        },
      },
      category_summary: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category:       { type: "string" },
            protocol_count: { type: "integer" },
            daily_fees_usd: { type: "number" },
          },
        },
      },
    },
  },

  async handler(query) {
    const limit       = Math.min(parseInt(query.limit ?? 20, 10) || 20, 100);
    const sortBy      = query.sort_by ?? "daily_fees";
    const catFilter   = (query.category ?? "").toLowerCase().trim();
    const minFees     = parseFloat(query.min_daily_fees ?? 1000) || 0;

    const resp = await fetch(FEES_URL, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) throw new Error(`DefiLlama HTTP ${resp.status}`);
    const data = await resp.json();

    let protocols = (data.protocols ?? []).filter(p => {
      if (!p || typeof p.total24h !== "number" || p.total24h <= 0) return false;
      if (p.total24h < minFees) return false;
      if (catFilter && !(p.category ?? "").toLowerCase().includes(catFilter)) return false;
      return true;
    });

    const sortField = {
      daily_fees:  (p) => -(p.total24h   ?? 0),
      "7d_fees":   (p) => -(p.total7d    ?? 0),
      "30d_fees":  (p) => -(p.total30d   ?? 0),
      "1d_change": (p) => -(p.change_1d  ?? -Infinity),
    }[sortBy] ?? ((p) => -(p.total24h ?? 0));

    protocols.sort((a, b) => sortField(a) - sortField(b));

    const leaders = protocols.slice(0, limit).map((p, i) => ({
      rank:           i + 1,
      name:           p.displayName ?? p.name ?? p.slug ?? "",
      slug:           p.slug ?? "",
      category:       p.category ?? "Unknown",
      chains:         Array.isArray(p.chains) ? p.chains.slice(0, 5) : [],
      daily_fees_usd: p.total24h   ?? 0,
      fees_7d_usd:    p.total7d    ?? null,
      fees_30d_usd:   p.total30d   ?? null,
      change_1d_pct:  typeof p.change_1d        === "number" ? +p.change_1d.toFixed(2)         : null,
      change_7d_pct:  typeof p.change_7dover7d  === "number" ? +p.change_7dover7d.toFixed(2)   : null,
    }));

    // Category rollup (top 10 by daily fees)
    const catMap = new Map();
    for (const p of protocols) {
      const cat = p.category ?? "Unknown";
      const cur = catMap.get(cat) ?? { count: 0, fees: 0 };
      catMap.set(cat, { count: cur.count + 1, fees: cur.fees + (p.total24h ?? 0) });
    }
    const category_summary = [...catMap.entries()]
      .sort((a, b) => b[1].fees - a[1].fees)
      .slice(0, 10)
      .map(([cat, v]) => ({
        category:       cat,
        protocol_count: v.count,
        daily_fees_usd: +v.fees.toFixed(0),
      }));

    return {
      timestamp:       new Date().toISOString(),
      total_protocols: protocols.length,
      ranked_by:       sortBy,
      leaders,
      category_summary,
    };
  },
};
