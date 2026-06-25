// limitless-markets.js
//
// Returns active prediction markets from Limitless Exchange (limitless.exchange).
// For each market: title, current Yes/No implied probabilities, trading volume,
// expiration, categories, and slug for direct lookups.
//
// Limitless runs a CLOB (central limit order book) for conditional-token markets,
// primarily focused on crypto price direction and recurring short-duration markets.
//
// Free upstream: api.limitless.exchange — no API key required.
// Collapses the blockrun.ai/pm/limitless seam from x402 archive (4,151 settlements/wk,
// 60 payers).

export default {
  name: "limitless-markets",
  price: "$0.034",

  description:
    "Returns active prediction markets from Limitless Exchange with current Yes/No probabilities. Covers short-duration crypto markets (5-min, 15-min BTC/ETH direction), plus longer-term markets. Returns title, implied yes/no prices, expiration, volume, categories, and slug. $0.006/call — free upstream, no API key.",

  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        description: "Number of markets to return (1–20, default 10).",
        default: 10,
        minimum: 1,
        maximum: 20,
      },
      page: {
        type: "integer",
        description: "Page number for pagination (default 1).",
        default: 1,
        minimum: 1,
      },
      query: {
        type: "string",
        description:
          "Optional keyword filter applied to market titles (case-insensitive). E.g. 'btc', 'eth', 'sol'.",
      },
      trade_type: {
        type: "string",
        description: "Filter by trade mechanism: 'clob' (order book) or 'amm' (automated market maker). Default returns all.",
        enum: ["clob", "amm"],
      },
      slug: {
        type: "string",
        description:
          "If provided, fetch a specific market by its Limitless slug (e.g. 'btc-up-or-down-5-min-1780703750051'). Overrides other filters.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      markets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title:        { type: "string",  description: "Market title / question." },
            slug:         { type: "string",  description: "Unique slug for direct API lookup." },
            stable_slug:  { type: "string",  description: "Stable recurring market identifier (e.g. btc-5min-price)." },
            yes_price:    { type: "number",  description: "Implied Yes probability (0–1)." },
            no_price:     { type: "number",  description: "Implied No probability (0–1)." },
            status:       { type: "string",  description: "Market status: FUNDED, RESOLVED, EXPIRED, etc." },
            trade_type:   { type: "string",  description: "'clob' or 'amm'." },
            categories:   { type: "array",   items: { type: "string" }, description: "Market category tags." },
            volume:       { type: "string",  description: "Trading volume in USDC (raw string from API)." },
            expiration:   { type: "string",  description: "Expiration date string." },
            expiration_ts:{ type: "number",  description: "Expiration as Unix ms timestamp." },
            collateral:   { type: "string",  description: "Settlement token symbol (usually USDC)." },
          },
        },
      },
      total_returned: { type: "integer" },
      total_available: { type: "integer", description: "Total active markets on Limitless Exchange." },
      filters_applied:  { type: "object" },
      generated_at:     { type: "string" },
    },
  },

  async handler(query) {
    const limit     = Math.min(Math.max(parseInt(query.limit  ?? 10, 10), 1), 20);
    const page      = Math.max(parseInt(query.page ?? 1, 10), 1);
    const keyword   = (query.query      || "").trim().toLowerCase();
    const tradeType = query.trade_type  || null;
    const slug      = (query.slug       || "").trim();

    // Single-market lookup by slug
    if (slug) {
      const resp = await fetch(`https://api.limitless.exchange/markets/${encodeURIComponent(slug)}`, {
        headers: { "User-Agent": "the-stall/3.4.0 (x402 capability chassis)" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`Limitless API error: HTTP ${resp.status}`);
      const m = await resp.json();
      return {
        markets: [formatMarket(m)],
        total_returned: 1,
        total_available: null,
        filters_applied: { slug },
        generated_at: new Date().toISOString(),
      };
    }

    // Build query params
    const params = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (tradeType) params.set("tradeType", tradeType);

    const resp = await fetch(`https://api.limitless.exchange/markets/active?${params}`, {
      headers: { "User-Agent": "the-stall/3.4.0 (x402 capability chassis)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Limitless API error: HTTP ${resp.status}`);

    const body = await resp.json();
    const raw  = body.data ?? (Array.isArray(body) ? body : []);
    const totalAvailable = body.totalMarketsCount ?? null;

    let markets = raw.map(formatMarket);

    // Client-side keyword filter
    if (keyword) {
      markets = markets.filter((m) =>
        m.title.toLowerCase().includes(keyword) ||
        (m.stable_slug || "").toLowerCase().includes(keyword)
      );
    }

    return {
      markets,
      total_returned:  markets.length,
      total_available: totalAvailable,
      filters_applied: {
        limit,
        page,
        keyword: keyword || null,
        trade_type: tradeType || null,
      },
      generated_at: new Date().toISOString(),
    };
  },
};

function formatMarket(m) {
  const prices = m.prices ?? [];
  return {
    title:         m.title         || m.proxyTitle || "",
    slug:          m.slug          || "",
    stable_slug:   m.stableSlug    || null,
    yes_price:     prices[0]       ?? null,
    no_price:      prices[1]       ?? null,
    status:        m.status        || "",
    trade_type:    m.tradeType     || "",
    categories:    m.categories    || [],
    volume:        m.volumeFormatted || m.volume || "0",
    expiration:    m.expirationDate || null,
    expiration_ts: m.expirationTimestamp || null,
    collateral:    m.collateralToken?.symbol || "USDC",
  };
}
