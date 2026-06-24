// stock-screener.js
//
// Yahoo Finance predefined equity screens — top 25 results for 8 built-in
// screens (day gainers/losers, most actives, undervalued growth, large-cap
// value, tech growth, small-cap gainers, aggressive small caps).
//
// Seam: agents searching for investment candidates without knowing which
// specific ticker to analyze. Typical pattern: screener → equity-fundamentals
// or peer-benchmarking → analyst-ratings → earnings-estimates for a full
// investment dossier. Single call replaces a manual scan across market sites.
//
// Upstream: Yahoo Finance screener predefined/saved (no-auth, standard UA).
// Price: $0.025 — top-of-funnel discovery utility for equity-research pipelines.

const UA          = "Mozilla/5.0 (compatible; the-stall/4.10; +https://intuitek.ai)";
const YF_SCREENER = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
const TMO         = 14_000;

const VALID_SCREENS = [
  "day_gainers",
  "day_losers",
  "most_actives",
  "undervalued_growth_stocks",
  "undervalued_large_caps",
  "growth_technology_stocks",
  "aggressive_small_caps",
  "small_cap_gainers",
];

function r2(n) { return n != null && isFinite(n) ? Math.round(n * 100) / 100 : null; }
function pct(n) { return r2((n ?? null) * 100); }

function parseQuote(q) {
  if (!q || !q.symbol) return null;
  const price       = q.regularMarketPrice ?? null;
  const prev_close  = q.regularMarketPreviousClose ?? null;
  const high52      = q.fiftyTwoWeekHigh ?? null;
  const low52       = q.fiftyTwoWeekLow  ?? null;
  const mktcap      = q.marketCap ?? null;
  return {
    ticker:            q.symbol,
    name:              q.longName || q.shortName || null,
    price:             r2(price),
    change_pct:        r2(q.regularMarketChangePercent ?? null),
    volume:            q.regularMarketVolume ?? null,
    avg_volume:        q.averageDailyVolume3Month ?? null,
    market_cap_b:      mktcap != null ? r2(mktcap / 1e9) : null,
    pe_trailing:       r2(q.trailingPE ?? null),
    pe_forward:        r2(q.forwardPE  ?? null),
    eps_trailing:      r2(q.epsTrailingTwelveMonths ?? null),
    week52_high:       r2(high52),
    week52_low:        r2(low52),
    pct_from_52w_high: (price != null && high52 != null && high52 > 0)
                         ? r2(((price - high52) / high52) * 100) : null,
    sector:            q.sector   || null,
    industry:          q.industry || null,
  };
}

export default {
  name:  "stock-screener",
  price: "$0.025",

  description:
    "Run a Yahoo Finance predefined equity screen (day_gainers, day_losers, most_actives, undervalued_growth_stocks, undervalued_large_caps, growth_technology_stocks, aggressive_small_caps, small_cap_gainers). Returns up to 50 stocks with price, % change, volume, market cap, P/E (trailing + forward), 52-week high/low, sector, and industry. Top-of-funnel discovery for equity-research pipelines — pair with peer-benchmarking, analyst-ratings, or earnings-estimates for full analysis.",

  inputSchema: {
    type: "object",
    properties: {
      screen: {
        type: "string",
        enum: VALID_SCREENS,
        description: "Which predefined screen to run. Options: day_gainers, day_losers, most_actives, undervalued_growth_stocks, undervalued_large_caps, growth_technology_stocks, aggressive_small_caps, small_cap_gainers.",
        default: "most_actives",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 25,
        description: "Number of results to return (1–50, default 25).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      screen:        { type: "string", description: "Screen ID used." },
      count:         { type: "number", description: "Number of results returned." },
      total_found:   { type: ["number","null"], description: "Total matching stocks in the screen." },
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ticker:              { type: "string" },
            name:                { type: ["string","null"] },
            price:               { type: ["number","null"], description: "Current price USD." },
            change_pct:          { type: ["number","null"], description: "Day % change." },
            volume:              { type: ["number","null"], description: "Today's volume." },
            avg_volume:          { type: ["number","null"], description: "3-month avg daily volume." },
            market_cap_b:        { type: ["number","null"], description: "Market cap in billions USD." },
            pe_trailing:         { type: ["number","null"] },
            pe_forward:          { type: ["number","null"] },
            eps_trailing:        { type: ["number","null"] },
            week52_high:         { type: ["number","null"] },
            week52_low:          { type: ["number","null"] },
            pct_from_52w_high:   { type: ["number","null"], description: "% below (negative) or above 52-week high." },
            sector:              { type: ["string","null"] },
            industry:            { type: ["string","null"] },
          },
        },
      },
      ts: { type: "string", description: "ISO-8601 response timestamp." },
    },
  },

  async handler({ screen = "most_actives", count = 25 }) {
    if (!VALID_SCREENS.includes(screen)) {
      throw new Error(`Invalid screen '${screen}'. Valid options: ${VALID_SCREENS.join(", ")}`);
    }
    const n = Math.min(Math.max(1, Math.floor(count)), 50);

    const url = `${YF_SCREENER}?formatted=false&scrIds=${encodeURIComponent(screen)}&count=${n}&offset=0&region=US&lang=en-US`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept":     "application/json",
      },
      signal: AbortSignal.timeout(TMO),
    });

    if (!resp.ok) throw new Error(`Yahoo Finance screener returned HTTP ${resp.status}`);

    const data  = await resp.json();
    const found = data?.finance?.result?.[0];
    if (!found) throw new Error("No screener result returned from Yahoo Finance");

    const quotes      = found.quotes ?? [];
    const total_found = found.total  ?? null;

    const results = quotes.map(parseQuote).filter(Boolean);

    return {
      screen,
      count:       results.length,
      total_found,
      results,
      ts: new Date().toISOString(),
    };
  },
};
