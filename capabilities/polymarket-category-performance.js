// polymarket-category-performance.js
//
// Polymarket category activity breakdown: for each prediction-market category
// (crypto, politics, sports, ai, macro, equities, other), surfaces volume,
// liquidity, market count, most-active market, and avg confidence level.
// Useful for agents deciding which category of markets to trade or monitor.
//
// Seam: orbisapi.com/proxy/polymarket-category-performance-api-701ccb — 591 sett,
//   5 payers, $0.005/call (7d). STALL prices at $0.004 (20% below).
//   Distinct from polymarket-accuracy-score (which scores calibration quality)
//   and polymarket-sentiment-shift (which tracks weekly price changes).
//
// Upstream: gamma-api.polymarket.com (free, no key required).

const GAMMA_BASE = "https://gamma-api.polymarket.com/markets";
const UA         = "Mozilla/5.0 (compatible; myriad/3.86; +https://synaptiic.org)";
const TIMEOUT    = 15_000;
const PAGE_LIMIT = 200;
const MAX_PAGES  = 5;

function inferCategory(question) {
  const text = (question || "").toLowerCase();
  // Word-bounded short tokens (eth, sol, btc, etc.) to avoid false matches
  if (/bitcoin|\bbtc\b|ethereum|\beth\b|crypto|solana|\bsol\b|\bxrp\b|dogecoin|\bdoge\b|usd[ct]|stablecoin|\bdefi\b|\bnft\b|altcoin|\btoken\b/.test(text)) return "crypto";
  if (/president|election|senate|congress|trump|biden|harris|democrat|republican|parliament|vote|poll|candidate/.test(text)) return "politics";
  if (/soccer|\bfootball\b|\bnfl\b|\bnba\b|\bmlb\b|\bnhl\b|tennis|golf|\bf1\b|formula|cricket|rugby|championship|world cup|league|\bmatch\b|tournament|fifa|premier/.test(text)) return "sports";
  if (/openai|anthropic|\bgpt\b|claude|gemini|\bllm\b|ai model|artificial intelligence|chatgpt|deepmind|mistral/.test(text)) return "ai";
  if (/\bfed\b|interest rate|inflation|\bcpi\b|\bpce\b|\bgdp\b|unemployment|recession|fomc|\bbond\b|treasury|fiscal/.test(text)) return "macro";
  if (/nasdaq|nyse|s&p|\bdow\b|\bstock\b|\bipo\b|earnings|\bsec\b|\bequity\b|shares|market cap/.test(text)) return "equities";
  return "other";
}

async function fetchPage(pageNum) {
  const url = `${GAMMA_BASE}?limit=${PAGE_LIMIT}&offset=${pageNum * PAGE_LIMIT}&active=true&closed=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export default {
  name:  "polymarket-category-performance",
  price: "$0.034",

  description:
    "Polymarket category activity breakdown: volume, liquidity, market count, and top market per category (crypto, politics, sports, ai, macro, equities). Shows where trading activity is concentrated. Optionally filter to one category. $0.004/call — 20% below closest x402 competitor. Source: Polymarket public API (no key required).",

  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["crypto", "politics", "sports", "ai", "macro", "equities", "other"],
        description: "Filter to a single category. Omit to return all categories ranked by volume.",
      },
      min_liquidity: {
        type: "number",
        description: "Only include markets with at least this much liquidity (USD). Default: 1000.",
        minimum: 0,
        default: 1000,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      categories:    { type: "array", description: "Categories ranked by 7-day volume." },
      summary:       { type: "object", description: "Aggregate totals and top category." },
      note:          { type: "string" },
      source:        { type: "string" },
      timestamp:     { type: "string" },
    },
  },

  async handler({ category, min_liquidity = 1000 }) {
    const catFilter = category?.toLowerCase() || null;
    const stats = {};  // category → { volume7d, liquidity, count, topMarket, confidenceSum }

    for (let page = 0; page < MAX_PAGES; page++) {
      const markets = await fetchPage(page);
      if (!Array.isArray(markets) || markets.length === 0) break;

      for (const m of markets) {
        const vol7d = parseFloat(m.volume1wk || 0);
        const liq   = parseFloat(m.liquidityNum || m.liquidity || 0);
        if (liq < min_liquidity) continue;

        const cat = inferCategory(m.question || "");
        if (catFilter && cat !== catFilter) continue;

        if (!stats[cat]) stats[cat] = { volume7d: 0, liquidity: 0, count: 0, topMarket: null, topVol: -1, confidenceSum: 0 };

        stats[cat].volume7d   += vol7d;
        stats[cat].liquidity  += liq;
        stats[cat].count      += 1;

        // Confidence: how far the leading outcome is from 50/50 (0 = tossup, 100 = certain)
        try {
          const prices = JSON.parse(m.outcomePrices || "[]").map(Number);
          const max    = Math.max(...prices);
          stats[cat].confidenceSum += Math.abs(max - 0.5) * 200; // 0–100 scale
        } catch { /* ignore */ }

        if (vol7d > stats[cat].topVol) {
          stats[cat].topVol   = vol7d;
          stats[cat].topMarket = {
            question: m.question,
            slug:     m.slug,
            volume7d: Math.round(vol7d),
            liquidity: Math.round(liq),
          };
        }
      }

      if (markets.length < PAGE_LIMIT) break;
    }

    const categories = Object.entries(stats).map(([cat, s]) => ({
      category:        cat,
      market_count:    s.count,
      volume_7d_usd:   Math.round(s.volume7d),
      total_liquidity: Math.round(s.liquidity),
      avg_confidence:  s.count > 0 ? Math.round(s.confidenceSum / s.count) : 0,
      top_market:      s.topMarket,
    })).sort((a, b) => b.volume_7d_usd - a.volume_7d_usd);

    if (categories.length === 0) {
      throw new Error(`No active markets found${catFilter ? ` for category '${catFilter}'` : ""} with liquidity ≥ $${min_liquidity}`);
    }

    const totalVol = categories.reduce((s, c) => s + c.volume_7d_usd, 0);
    return {
      categories,
      summary: {
        total_markets:      categories.reduce((s, c) => s + c.market_count, 0),
        total_volume_7d:    totalVol,
        total_liquidity:    categories.reduce((s, c) => s + c.total_liquidity, 0),
        top_category:       categories[0]?.category,
        top_category_share: totalVol > 0 ? Math.round((categories[0]?.volume_7d_usd / totalVol) * 100) : 0,
      },
      note: catFilter ? `Filtered to category: ${catFilter}` : "All categories, ranked by 7-day volume",
      source: "Polymarket public API (gamma-api.polymarket.com)",
      timestamp: new Date().toISOString(),
    };
  },
};
