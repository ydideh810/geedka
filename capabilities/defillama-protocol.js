// defillama-protocol.js
//
// DefiLlama protocol TVL, chain breakdown, fees, and metadata for any DeFi protocol.
// Seam: blockrun.ai/api/v1/defillama/protocol/:slug — 28 payers, 33K calls, $724 in 14d
// at $0.022/call. STALL undercuts at $0.018 (18% discount), same DefiLlama upstream.
//
// Upstream: https://api.llama.fi/protocol/:slug (free, no auth)

const LLAMA_BASE = "https://api.llama.fi";
const UA         = "Mozilla/5.0 (compatible; the-stall/defillama-protocol; +https://intuitek.ai)";
const TIMEOUT    = 15_000;

// Chain TVL keys to exclude from "clean" TVL total
const EXCL = new Set(["staking", "pool2", "borrowed", "Plasma", "offers"]);

function cleanTvl(chainTvls) {
  return Object.entries(chainTvls || {})
    .filter(([k]) => !EXCL.has(k) && !k.includes("-"))
    .reduce((sum, [, v]) => sum + (v || 0), 0);
}

export default {
  name:  "defillama-protocol",
  price: "$0.039",

  description:
    "Returns current TVL, chain breakdown, 24h/7d TVL change, fees, and metadata for any DeFi protocol slug (aave, uniswap-v3, lido, etc.) via DefiLlama. Undercuts blockrun.ai's $0.022/call by 18%.",

  inputSchema: {
    type: "object",
    properties: {
      protocol: {
        type: "string",
        description:
          "DefiLlama protocol slug (e.g. 'aave', 'uniswap-v3', 'lido', 'compound', 'maker'). Use lowercase-hyphenated form as seen on defillama.com/protocol/...",
        minLength: 1,
      },
      include_tvl_history: {
        type: "boolean",
        description: "If true, include last 7 days of TVL history. Default false.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      protocol:        { type: "string",  description: "Protocol slug." },
      name:            { type: "string",  description: "Protocol display name." },
      url:             { type: "string",  description: "Official URL." },
      description:     { type: "string",  description: "Short protocol description." },
      category:        { type: "string",  description: "Protocol category (e.g. Lending, DEX, Yield)." },
      symbol:          { type: "string",  description: "Native token ticker." },
      gecko_id:        { type: "string",  description: "CoinGecko ID for the native token." },
      tvl_usd:         { type: "number",  description: "Current total TVL in USD (excludes borrowed, staking, pool2)." },
      tvl_change_1d:   { type: "number",  description: "TVL percentage change over last 24h." },
      tvl_change_7d:   { type: "number",  description: "TVL percentage change over last 7 days." },
      mcap_usd:        { type: "number",  description: "Market cap of native token in USD (if available)." },
      chains:          { type: "array",   description: "Top chains by TVL: [{chain, tvl_usd}]." },
      total_chains:    { type: "integer", description: "Number of chains the protocol is deployed on." },
      tvl_history:     { type: "array",   description: "Last 7 days TVL [{date, tvl_usd}] — only if include_tvl_history=true." },
      ts:              { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const slug = (query.protocol || "uniswap").trim().toLowerCase().replace(/\s+/g, "-");

    const resp = await fetch(`${LLAMA_BASE}/protocol/${encodeURIComponent(slug)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal:  AbortSignal.timeout(TIMEOUT),
    });

    if (resp.status === 404 || resp.status === 400) {
      throw new Error(
        `Protocol '${slug}' not found on DefiLlama. Use exact slug from defillama.com/protocol/... (e.g. 'aave', 'uniswap-v3').`
      );
    }
    if (!resp.ok) throw new Error(`DefiLlama HTTP ${resp.status}`);

    const d = await resp.json();

    // Clean TVL (exclude borrowed, staking, pool2)
    const tvlNow = cleanTvl(d.currentChainTvls);

    // TVL change from history array — deduplicated by date.
    // The API can return multiple entries per day; take the last entry per date.
    const tvlArr = d.tvl || [];
    const byDate = new Map();
    for (const p of tvlArr) {
      const day = new Date(p.date * 1000).toISOString().split("T")[0];
      byDate.set(day, p.totalLiquidityUSD);
    }
    const sortedDays = [...byDate.keys()].sort();
    let tvl1dPct = null;
    let tvl7dPct = null;
    if (sortedDays.length >= 2) {
      const prev1d = byDate.get(sortedDays[sortedDays.length - 2]);
      if (prev1d && prev1d > 0) tvl1dPct = ((tvlNow - prev1d) / prev1d) * 100;
    }
    if (sortedDays.length >= 8) {
      const prev7d = byDate.get(sortedDays[sortedDays.length - 8]);
      if (prev7d && prev7d > 0) tvl7dPct = ((tvlNow - prev7d) / prev7d) * 100;
    }

    // Top chains by TVL
    const chainTvlEntries = Object.entries(d.currentChainTvls || {})
      .filter(([k]) => !EXCL.has(k) && !k.includes("-"))
      .sort((a, b) => b[1] - a[1]);

    const chains = chainTvlEntries.slice(0, 10).map(([chain, tvl]) => ({
      chain,
      tvl_usd: tvl,
    }));

    const result = {
      protocol:      slug,
      name:          d.name || slug,
      url:           d.url || null,
      description:   d.description?.slice(0, 300) || null,
      category:      d.category || null,
      symbol:        d.symbol || null,
      gecko_id:      d.gecko_id || null,
      tvl_usd:       Math.round(tvlNow),
      tvl_change_1d: tvl1dPct !== null ? Math.round(tvl1dPct * 100) / 100 : null,
      tvl_change_7d: tvl7dPct !== null ? Math.round(tvl7dPct * 100) / 100 : null,
      mcap_usd:      d.mcap ? Math.round(d.mcap) : null,
      chains,
      total_chains:  chainTvlEntries.length,
      ts:            new Date().toISOString(),
    };

    if (query.include_tvl_history) {
      result.tvl_history = sortedDays.slice(-7).map(day => ({
        date:    day,
        tvl_usd: Math.round(byDate.get(day)),
      }));
    }

    return result;
  },
};
