// commodity-futures.js
//
// Returns current price and intraday metrics for major commodity futures.
// Covers energy (crude oil, natural gas), metals (gold, silver, copper,
// platinum), and agricultural contracts (wheat, corn, soybeans, coffee).
//
// Free upstream: Yahoo Finance public JSON API — no key, no auth.
// Seam: orbisapi.com/proxy/commodity-futures-api charges $0.005/call with
// ~2,935 observed settlements/week (6 payers). Priced at $0.010/call —
// direct endpoint, no proxy overhead, better latency.
//
// signal-intel source: x402 archive settlement analysis, 2026-06-05.

const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0 (compatible; the-stall/2.5; +https://the-stall.intuitek.ai)";

const COMMODITIES = {
  // Energy
  crude_oil:   { symbol: "CL=F", name: "Crude Oil (WTI)",    category: "energy",         unit: "USD/bbl" },
  natural_gas: { symbol: "NG=F", name: "Natural Gas",         category: "energy",         unit: "USD/MMBtu" },
  // Precious metals
  gold:        { symbol: "GC=F", name: "Gold",                category: "metals",         unit: "USD/troy oz" },
  silver:      { symbol: "SI=F", name: "Silver",              category: "metals",         unit: "USD/troy oz" },
  copper:      { symbol: "HG=F", name: "Copper",              category: "metals",         unit: "USD/lb" },
  platinum:    { symbol: "PL=F", name: "Platinum",            category: "metals",         unit: "USD/troy oz" },
  // Agricultural
  wheat:       { symbol: "ZW=F", name: "Wheat (Chicago SRW)", category: "agricultural",   unit: "USX/bu" },
  corn:        { symbol: "ZC=F", name: "Corn",                category: "agricultural",   unit: "USX/bu" },
  soybeans:    { symbol: "ZS=F", name: "Soybeans",            category: "agricultural",   unit: "USX/bu" },
  coffee:      { symbol: "KC=F", name: "Coffee (Arabica)",    category: "agricultural",   unit: "USX/lb" },
};

const ALL_KEYS = Object.keys(COMMODITIES);
const CATEGORIES = ["energy", "metals", "agricultural", "all"];

async function fetchQuote(symbol) {
  const url = `${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Yahoo Finance ${symbol}: HTTP ${resp.status}`);
  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);
  const meta = result.meta;
  return {
    price:        meta.regularMarketPrice ?? null,
    prev_close:   meta.chartPreviousClose ?? meta.previousClose ?? null,
    day_high:     meta.regularMarketDayHigh ?? null,
    day_low:      meta.regularMarketDayLow ?? null,
    week_52_high: meta.fiftyTwoWeekHigh ?? null,
    week_52_low:  meta.fiftyTwoWeekLow ?? null,
    exchange:     meta.exchangeName ?? null,
    currency:     meta.currency ?? null,
    market_time:  meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : null,
    contract:     meta.instrumentType === "FUTURE"
      ? (meta.shortName || null)
      : null,
  };
}

export default {
  name: "commodity-futures",
  price: "$0.039",

  description:
    "Returns live price and intraday metrics for major commodity futures: crude oil, natural gas, gold, silver, copper, platinum, wheat, corn, soybeans, and coffee. Includes price, day high/low, 52-week range, previous close, exchange, and contract name. Filter by commodity name or category (energy/metals/agricultural). $0.010/call — Yahoo Finance free API, no key required.",

  inputSchema: {
    type: "object",
    properties: {
      commodities: {
        type: "array",
        items: {
          type: "string",
          enum: ALL_KEYS,
        },
        description:
          `Specific commodities to fetch. One or more of: ${ALL_KEYS.join(", ")}. ` +
          "Omit to get all commodities (limited by category if provided).",
      },
      category: {
        type: "string",
        enum: CATEGORIES,
        description:
          "Filter by category: energy (crude_oil, natural_gas), metals (gold, silver, copper, platinum), " +
          "agricultural (wheat, corn, soybeans, coffee), or all. Default: all. Ignored if commodities list is provided.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      quotes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            commodity:    { type: "string",  description: "Commodity key (e.g. 'gold')." },
            name:         { type: "string",  description: "Full contract name." },
            symbol:       { type: "string",  description: "Yahoo Finance ticker symbol (e.g. 'GC=F')." },
            category:     { type: "string",  description: "Asset category." },
            unit:         { type: "string",  description: "Price unit (e.g. 'USD/troy oz', 'USX/bu')." },
            price:        { type: ["number", "null"], description: "Current market price." },
            prev_close:   { type: ["number", "null"], description: "Previous close price." },
            change_usd:   { type: ["number", "null"], description: "Change from prev close." },
            change_pct:   { type: ["number", "null"], description: "Percentage change from prev close." },
            day_high:     { type: ["number", "null"], description: "Intraday high." },
            day_low:      { type: ["number", "null"], description: "Intraday low." },
            week_52_high: { type: ["number", "null"], description: "52-week high." },
            week_52_low:  { type: ["number", "null"], description: "52-week low." },
            exchange:     { type: ["string", "null"], description: "Exchange name." },
            currency:     { type: ["string", "null"], description: "Quote currency (USD or USX for grains)." },
            contract:     { type: ["string", "null"], description: "Active contract label (e.g. 'Gold Jul 26')." },
            market_time:  { type: ["string", "null"], description: "ISO-8601 timestamp of last price." },
          },
        },
      },
      ts: { type: "string", description: "ISO-8601 response timestamp." },
    },
  },

  async handler(query) {
    // Determine which commodities to fetch
    let keys;
    if (Array.isArray(query.commodities) && query.commodities.length > 0) {
      keys = query.commodities.filter(k => ALL_KEYS.includes(k));
      if (keys.length === 0) throw new Error(`No valid commodities in list. Valid: ${ALL_KEYS.join(", ")}`);
    } else {
      const cat = query.category || "all";
      keys = cat === "all"
        ? ALL_KEYS
        : ALL_KEYS.filter(k => COMMODITIES[k].category === cat);
      if (keys.length === 0) throw new Error(`Unknown category: ${cat}. Valid: ${CATEGORIES.join(", ")}`);
    }

    // Fetch all requested quotes in parallel
    const results = await Promise.allSettled(
      keys.map(async k => {
        const meta = COMMODITIES[k];
        const q = await fetchQuote(meta.symbol);
        const changeUsd = q.price != null && q.prev_close != null
          ? parseFloat((q.price - q.prev_close).toFixed(4))
          : null;
        const changePct = changeUsd != null && q.prev_close
          ? parseFloat(((changeUsd / q.prev_close) * 100).toFixed(2))
          : null;
        return {
          commodity: k,
          name:      meta.name,
          symbol:    meta.symbol,
          category:  meta.category,
          unit:      meta.unit,
          price:     q.price,
          prev_close: q.prev_close,
          change_usd: changeUsd,
          change_pct: changePct,
          day_high:   q.day_high,
          day_low:    q.day_low,
          week_52_high: q.week_52_high,
          week_52_low:  q.week_52_low,
          exchange:   q.exchange,
          currency:   q.currency,
          contract:   q.contract,
          market_time: q.market_time,
        };
      })
    );

    const quotes = results
      .filter(r => r.status === "fulfilled")
      .map(r => r.value);

    const failed = results
      .filter(r => r.status === "rejected")
      .map((r, i) => keys[i]);

    if (quotes.length === 0) {
      throw new Error(`All commodity lookups failed: ${failed.join(", ")}`);
    }

    return { quotes, ts: new Date().toISOString() };
  },
};
