// ipo-calendar.js
//
// Returns IPO calendar data from Nasdaq's public feed — upcoming IPOs with
// expected pricing dates, recently priced offerings, new S-1 registrations,
// and withdrawn deals.
//
// Source: Nasdaq public API (api.nasdaq.com) — aggregates EDGAR® Online filings.
// No API key required. Returns current week's calendar and recent activity.
// Covers all major US exchanges: NYSE, NASDAQ Global Select, NASDAQ Global, NYSE American.
//
// Seam: Bloomberg Terminal ($24K/yr), IPO Edge ($1,200/yr), and Renaissance Capital
// IPO Pro ($199/mo) all sell structured IPO calendar access. This delivers the same
// Nasdaq IPO data on-demand for $0.020/call.
//
// Supports sections: upcoming | priced | filed | withdrawn | all
// Use section='upcoming' for near-term deal flow; section='priced' for post-IPO
// watchlist setup; section='all' for the full current week calendar.

const NASDAQ_IPO = "https://api.nasdaq.com/api/ipo/calendar";
const UA         = "Mozilla/5.0 (compatible; the-stall/4.15; +https://intuitek.ai)";
const TIMEOUT    = 30_000;

async function fetchIPO() {
  const r = await fetch(NASDAQ_IPO, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} — Nasdaq IPO API`);
  const body = await r.json();
  if (!body?.data) throw new Error("Unexpected response shape from Nasdaq IPO API");
  return body.data;
}

function normalizeUpcoming(row) {
  return {
    symbol:        row.proposedTickerSymbol ?? null,
    company:       row.companyName ?? null,
    exchange:      row.proposedExchange ?? null,
    price_range:   row.proposedSharePrice ?? null,
    shares:        row.sharesOffered ?? null,
    offer_amount:  row.dollarValueOfSharesOffered ?? null,
    expected_date: row.expectedPriceDate ?? null,
    deal_id:       row.dealID ?? null,
  };
}

function normalizePriced(row) {
  return {
    symbol:       row.proposedTickerSymbol ?? null,
    company:      row.companyName ?? null,
    exchange:     row.proposedExchange ?? null,
    price:        row.proposedSharePrice ?? null,
    shares:       row.sharesOffered ?? null,
    offer_amount: row.dollarValueOfSharesOffered ?? null,
    priced_date:  row.pricedDate ?? null,
    status:       row.dealStatus ?? null,
    deal_id:      row.dealID ?? null,
  };
}

function normalizeFiled(row) {
  return {
    symbol:       row.proposedTickerSymbol ?? null,
    company:      row.companyName ?? null,
    filed_date:   row.filedDate ?? null,
    offer_amount: row.dollarValueOfSharesOffered ?? null,
    deal_id:      row.dealID ?? null,
  };
}

function normalizeWithdrawn(row) {
  return {
    symbol:         row.proposedTickerSymbol ?? null,
    company:        row.companyName ?? null,
    exchange:       row.proposedExchange ?? null,
    shares:         row.sharesOffered ?? null,
    offer_amount:   row.dollarValueOfSharesOffered ?? null,
    filed_date:     row.filedDate ?? null,
    withdrawn_date: row.withdrawDate ?? null,
    deal_id:        row.dealID ?? null,
  };
}

function parseAmount(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

function buildSummary(upcoming, priced, filed, withdrawn, month, year) {
  const allDeals = [...upcoming, ...priced, ...filed, ...withdrawn];
  const amounts  = allDeals.map(d => parseAmount(d.offer_amount)).filter(n => n !== null);
  const total    = amounts.reduce((a, b) => a + b, 0);

  const largestUpcoming = upcoming.reduce((best, d) => {
    const amt = parseAmount(d.offer_amount);
    if (amt === null) return best;
    if (!best || amt > (parseAmount(best.offer_amount) ?? 0)) return d;
    return best;
  }, null);

  return {
    upcoming_count:           upcoming.length,
    priced_count:             priced.length,
    filed_count:              filed.length,
    withdrawn_count:          withdrawn.length,
    calendar_month:           month ?? null,
    calendar_year:            year ?? null,
    total_capital_usd:        Math.round(total),
    largest_upcoming: largestUpcoming
      ? { symbol: largestUpcoming.symbol, company: largestUpcoming.company, offer_amount: largestUpcoming.offer_amount }
      : null,
  };
}

export default {
  name: "ipo-calendar",
  description:
    "Returns live IPO calendar from Nasdaq — upcoming deals with expected pricing dates, " +
    "recently priced offerings, new S-1 filings, and withdrawn deals. Covers all major US " +
    "exchanges. Includes company name, ticker, exchange, price range, share count, and total " +
    "offer amount. Structured extraction WITH summary analytics AND deal counts — richer than " +
    "raw scraped calendars. Use section='upcoming' for near-term deal flow, section='priced' " +
    "for post-IPO watchlist setup, section='all' for complete week view.",
  price: "$0.020",
  inputSchema: {
    type: "object",
    properties: {
      section: {
        type: "string",
        enum: ["all", "upcoming", "priced", "filed", "withdrawn"],
        default: "upcoming",
        description:
          "Calendar section to return. 'upcoming' = deals pricing this week; " +
          "'priced' = recently priced IPOs; 'filed' = new S-1 registrations; " +
          "'withdrawn' = cancelled deals; 'all' = all sections.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 20,
        description: "Maximum results per section.",
      },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      section: { type: "string" },
      upcoming: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol:        { type: ["string", "null"] },
            company:       { type: ["string", "null"] },
            exchange:      { type: ["string", "null"] },
            price_range:   { type: ["string", "null"], description: "Expected price range or fixed price." },
            shares:        { type: ["string", "null"] },
            offer_amount:  { type: ["string", "null"] },
            expected_date: { type: ["string", "null"], description: "Expected IPO pricing date (M/D/YYYY)." },
            deal_id:       { type: ["string", "null"] },
          },
        },
      },
      priced: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol:       { type: ["string", "null"] },
            company:      { type: ["string", "null"] },
            exchange:     { type: ["string", "null"] },
            price:        { type: ["string", "null"] },
            shares:       { type: ["string", "null"] },
            offer_amount: { type: ["string", "null"] },
            priced_date:  { type: ["string", "null"] },
            status:       { type: ["string", "null"] },
            deal_id:      { type: ["string", "null"] },
          },
        },
      },
      filed: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol:       { type: ["string", "null"] },
            company:      { type: ["string", "null"] },
            filed_date:   { type: ["string", "null"] },
            offer_amount: { type: ["string", "null"] },
            deal_id:      { type: ["string", "null"] },
          },
        },
      },
      withdrawn: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol:         { type: ["string", "null"] },
            company:        { type: ["string", "null"] },
            exchange:       { type: ["string", "null"] },
            shares:         { type: ["string", "null"] },
            offer_amount:   { type: ["string", "null"] },
            filed_date:     { type: ["string", "null"] },
            withdrawn_date: { type: ["string", "null"] },
            deal_id:        { type: ["string", "null"] },
          },
        },
      },
      summary: {
        type: "object",
        properties: {
          upcoming_count:    { type: "integer" },
          priced_count:      { type: "integer" },
          filed_count:       { type: "integer" },
          withdrawn_count:   { type: "integer" },
          calendar_month:    { type: ["integer", "null"] },
          calendar_year:     { type: ["integer", "null"] },
          total_capital_usd: { type: ["integer", "null"], description: "Total USD across all sections." },
          largest_upcoming:  { type: ["object", "null"] },
        },
      },
      source: { type: "string" },
      ts:     { type: "string", description: "ISO-8601 response timestamp." },
    },
  },

  async handler({ section = "upcoming", limit = 20 }) {
    const effectiveLimit    = Math.min(Math.max(1, limit), 50);
    const requestedSection  = (section ?? "upcoming").toLowerCase();

    const data = await fetchIPO();

    const upcomingRows  = data.upcoming?.upcomingTable?.rows ?? [];
    const pricedRows    = data.priced?.rows ?? [];
    const filedRows     = data.filed?.rows ?? [];
    const withdrawnRows = data.withdrawn?.rows ?? [];

    const upcoming  = upcomingRows.map(normalizeUpcoming).slice(0, effectiveLimit);
    const priced    = pricedRows.map(normalizePriced).slice(0, effectiveLimit);
    const filed     = filedRows.map(normalizeFiled).slice(0, effectiveLimit);
    const withdrawn = withdrawnRows.map(normalizeWithdrawn).slice(0, effectiveLimit);

    const summary = buildSummary(upcoming, priced, filed, withdrawn, data.month, data.year);

    let sectionData;
    if (requestedSection === "all") {
      sectionData = { upcoming, priced, filed, withdrawn };
    } else if (requestedSection === "priced") {
      sectionData = { upcoming: [], priced, filed: [], withdrawn: [] };
    } else if (requestedSection === "filed") {
      sectionData = { upcoming: [], priced: [], filed, withdrawn: [] };
    } else if (requestedSection === "withdrawn") {
      sectionData = { upcoming: [], priced: [], filed: [], withdrawn };
    } else {
      sectionData = { upcoming, priced: [], filed: [], withdrawn: [] };
    }

    return {
      section: requestedSection,
      ...sectionData,
      summary,
      source: "api.nasdaq.com — EDGAR® Online — Nasdaq IPO Calendar",
      ts: new Date().toISOString(),
    };
  },
};
