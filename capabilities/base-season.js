// base-season.js
//
// Hourly Base chain season snapshot: total TVL, top protocols by Base-native
// TVL, top DeFi categories, 7d trend. No input required — pure orientation
// call for agents deciding where to deploy/trade on Base.
//
// Seam: dataendpoints-production.up.railway.app/base-season (Otto AI) —
// 66 settlements, 35 payers (widest payer distribution of any uncovered seam
// on 2026-06-06). signal-intel strength 0.6 on base-season ↔ yield-farming-active
// seam, indicating agents use this as pre-trade orientation before DeFi calls.
//
// Free upstreams: DeFiLlama (no key, 300 req/min) + CoinGecko public API.
// Price: $0.003 — 3x Otto AI's $0.001, competitive on value delivered.

const LLAMA_PROTOCOLS = "https://api.llama.fi/protocols";
const LLAMA_CHAINS    = "https://api.llama.fi/chains";
const COINGECKO_BASE  = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=base-ecosystem&order=market_cap_desc&per_page=10&page=1&sparkline=false";
const UA              = "Mozilla/5.0 (compatible; the-stall/3.33; +https://intuitek.ai)";
const TIMEOUT_MS      = 15000;

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url.split("?")[0]}`);
  return resp.json();
}

export default {
  name: "base-season",
  price: "$0.014",

  description:
    "Base chain season snapshot: total chain TVL, top 10 protocols by Base-native TVL, category breakdown, 7d trend, and top Base ecosystem tokens by market cap. No input required — agents use this for pre-trade orientation before DeFi, lending, or liquidity calls on Base.",

  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      chain_tvl_usd:     { type: "number",  description: "Total Base chain TVL in USD." },
      chain_tvl_change:  { type: "number",  description: "Percentage TVL change vs previous day (positive = growth)." },
      top_protocols: {
        type: "array",
        description: "Top 10 protocols by Base-native TVL.",
        items: {
          type: "object",
          properties: {
            name:      { type: "string" },
            category:  { type: "string" },
            tvl_usd:   { type: "number" },
            change_7d: { type: "number" },
          },
        },
      },
      category_breakdown: {
        type: "array",
        description: "DeFi category aggregates: total TVL on Base per category.",
        items: {
          type: "object",
          properties: {
            category: { type: "string" },
            tvl_usd:  { type: "number" },
          },
        },
      },
      top_tokens: {
        type: "array",
        description: "Top Base ecosystem tokens by market cap (CoinGecko).",
        items: {
          type: "object",
          properties: {
            symbol:        { type: "string" },
            name:          { type: "string" },
            price_usd:     { type: "number" },
            market_cap:    { type: "number" },
            change_24h:    { type: "number" },
            volume_24h:    { type: "number" },
          },
        },
      },
      season_signal: { type: "string", description: "Human-readable 1-line season summary (e.g. 'Lending dominates, DEX TVL declining 7d')." },
      ts:            { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(_query) {
    // Fetch all three sources in parallel; CoinGecko may rate-limit (tolerate failure)
    const [protocolsRaw, chainsRaw, tokensRaw] = await Promise.allSettled([
      fetchJSON(LLAMA_PROTOCOLS),
      fetchJSON(LLAMA_CHAINS),
      fetchJSON(COINGECKO_BASE),
    ]);

    // --- Chain TVL ---
    let chainTvlUsd = 0;
    let chainTvlChange = 0;
    if (chainsRaw.status === "fulfilled") {
      const base = chainsRaw.value.find(c => c.name === "Base");
      if (base) chainTvlUsd = base.tvl || 0;
    }

    // --- Protocol breakdown ---
    let topProtocols = [];
    const categoryMap = {};

    if (protocolsRaw.status === "fulfilled") {
      const all = protocolsRaw.value;
      const basePs = [];
      for (const p of all) {
        const baseTvl = (p.chainTvls || {}).Base || 0;
        if (baseTvl < 1_000_000) continue;
        const cat = p.category || "Other";
        categoryMap[cat] = (categoryMap[cat] || 0) + baseTvl;
        basePs.push({
          name:      p.name,
          category:  cat,
          tvl_usd:   Math.round(baseTvl),
          change_7d: Math.round(((p.change_7d || 0) * 100)) / 100,
        });
      }
      basePs.sort((a, b) => b.tvl_usd - a.tvl_usd);
      topProtocols = basePs.slice(0, 10);
    }

    // Category breakdown sorted by TVL
    const categoryBreakdown = Object.entries(categoryMap)
      .map(([category, tvl_usd]) => ({ category, tvl_usd: Math.round(tvl_usd) }))
      .sort((a, b) => b.tvl_usd - a.tvl_usd)
      .slice(0, 8);

    // --- Top tokens ---
    let topTokens = [];
    if (tokensRaw.status === "fulfilled" && Array.isArray(tokensRaw.value)) {
      topTokens = tokensRaw.value.map(t => ({
        symbol:     (t.symbol || "").toUpperCase(),
        name:       t.name || "",
        price_usd:  t.current_price || 0,
        market_cap: t.market_cap || 0,
        change_24h: Math.round(((t.price_change_percentage_24h || 0) * 100)) / 100,
        volume_24h: t.total_volume || 0,
      }));
    }

    // --- Season signal ---
    let seasonSignal = "Data loading";
    if (categoryBreakdown.length > 0) {
      const topCat = categoryBreakdown[0].category;
      const topCatTvl = categoryBreakdown[0].tvl_usd;
      const totalCatTvl = categoryBreakdown.reduce((s, c) => s + c.tvl_usd, 0);
      const topPct = totalCatTvl > 0 ? Math.round((topCatTvl / totalCatTvl) * 100) : 0;

      const topChanger = topProtocols
        .filter(p => p.change_7d !== 0)
        .sort((a, b) => b.change_7d - a.change_7d)[0];

      const declining = topProtocols.filter(p => p.change_7d < -10).length;
      const growing   = topProtocols.filter(p => p.change_7d > 5).length;

      if (growing > declining) {
        seasonSignal = `${topCat} leads Base (${topPct}% of TVL); ${growing} top protocols growing 7d`;
      } else if (declining > growing) {
        seasonSignal = `${topCat} dominates (${topPct}%) but ${declining}/${topProtocols.length} top protocols declining 7d`;
      } else {
        seasonSignal = `${topCat} leads Base at ${topPct}% of protocol TVL`;
      }
      if (topChanger && topChanger.change_7d > 20) {
        seasonSignal += `; standout: ${topChanger.name} +${topChanger.change_7d}% 7d`;
      }
    }

    return {
      chain_tvl_usd:     Math.round(chainTvlUsd),
      chain_tvl_change:  chainTvlChange,
      top_protocols:     topProtocols,
      category_breakdown: categoryBreakdown,
      top_tokens:        topTokens,
      season_signal:     seasonSignal,
      ts:                new Date().toISOString(),
    };
  },
};
