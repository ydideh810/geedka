// dividend-calendar.js
//
// Upcoming dividend ex-dates from NASDAQ's public calendar API.
// Returns all stocks with upcoming ex-dividend dates for a given date or
// date range — the screening layer agents need for dividend-capture strategies,
// income scheduling, and position management around corporate actions.
//
// Complements dividend-intel (per-ticker dividend history) with the inverse
// view: all stocks going ex-dividend on a given date or in the next N days.
//
// Free upstream: api.nasdaq.com/api/calendar/dividends — public, no API key.
// Covers all NASDAQ, NYSE, and AMEX listed stocks.
//
// Seam: dividend-capture agents need to know which stocks are going ex-div
// tomorrow. Currently requires scraping nasdaq.com manually. This closes that
// gap in a single structured call at $0.008.
//
// Priced at $0.008 — calendar-data tier.

const NASDAQ_CAL = "https://api.nasdaq.com/api/calendar/dividends";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT = 12_000;

function formatDate(d) {
  // Returns YYYY-MM-DD for a Date object
  return d.toISOString().slice(0, 10);
}

function parseDate(s) {
  // Accept YYYY-MM-DD
  return new Date(s + "T12:00:00Z");
}

async function fetchDay(dateStr) {
  const r = await fetch(`${NASDAQ_CAL}?date=${dateStr}`, {
    headers: {
      "User-Agent": UA,
      "Accept":     "application/json",
      "Referer":    "https://www.nasdaq.com/",
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`NASDAQ calendar HTTP ${r.status}`);
  const body = await r.json();
  const rows = body?.data?.calendar?.rows ?? [];
  return rows.map(row => ({
    symbol:            row.symbol,
    company:           row.companyName,
    ex_date:           row.dividend_Ex_Date,
    record_date:       row.record_Date,
    payment_date:      row.payment_Date,
    dividend_usd:      typeof row.dividend_Rate === "number" ? row.dividend_Rate : null,
    annual_yield_usd:  typeof row.indicated_Annual_Dividend === "number" ? row.indicated_Annual_Dividend : null,
    announced:         row.announcement_Date,
  }));
}

export default {
  name:  "dividend-calendar",
  price: "$0.039",

  description:
    "Upcoming dividend ex-dates from NASDAQ — all stocks going ex-dividend on a given date (default: today) or in the next 1–7 days. Returns symbol, company name, ex-date, record date, payment date, dividend amount, and annual indicated dividend. $0.008/call.",

  inputSchema: {
    type:       "object",
    properties: {
      date: {
        type:        "string",
        description: "Target date in YYYY-MM-DD format. Default: today (UTC).",
      },
      days_ahead: {
        type:        "integer",
        minimum:     1,
        maximum:     7,
        description: "Fetch dividends for this many calendar days starting from `date`. Default: 1 (single day). Max: 7.",
      },
      min_dividend: {
        type:        "number",
        description: "Filter: minimum dividend amount per share (USD). Default: no filter.",
      },
    },
    required: [],
  },

  outputSchema: {
    type:       "object",
    properties: {
      as_of:  { type: "string", description: "Date range queried" },
      count:  { type: "integer" },
      events: {
        type:  "array",
        items: {
          type:       "object",
          properties: {
            symbol:           { type: "string" },
            company:          { type: "string" },
            ex_date:          { type: "string" },
            record_date:      { type: "string" },
            payment_date:     { type: "string" },
            dividend_usd:     { type: "number" },
            annual_yield_usd: { type: "number" },
            announced:        { type: "string" },
          },
        },
      },
    },
  },

  async handler(query) {
    const today = formatDate(new Date());
    const startDate = query.date ?? today;
    const daysAhead = Math.min(Math.max(parseInt(query.days_ahead ?? "1", 10), 1), 7);
    const minDiv = query.min_dividend != null ? Number(query.min_dividend) : null;

    // Fetch all days in range
    const allEvents = [];
    const start = parseDate(startDate);
    const datesFetched = [];

    for (let i = 0; i < daysAhead; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const ds = formatDate(d);
      datesFetched.push(ds);
      try {
        const events = await fetchDay(ds);
        allEvents.push(...events);
      } catch (e) {
        // Skip days that fail (weekends, holidays may return empty)
      }
    }

    // Apply optional filter
    const filtered = minDiv != null
      ? allEvents.filter(e => e.dividend_usd != null && e.dividend_usd >= minDiv)
      : allEvents;

    // Sort by ex_date then dividend desc
    filtered.sort((a, b) => {
      const dateComp = (a.ex_date ?? "").localeCompare(b.ex_date ?? "");
      if (dateComp !== 0) return dateComp;
      return (b.dividend_usd ?? 0) - (a.dividend_usd ?? 0);
    });

    const range = daysAhead === 1 ? startDate : `${startDate} to ${datesFetched[datesFetched.length - 1]}`;

    return {
      as_of:  range,
      count:  filtered.length,
      events: filtered,
    };
  },
};
