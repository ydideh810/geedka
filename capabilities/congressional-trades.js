// congressional-trades.js
//
// Returns US Congressional stock trades filed under the STOCK Act (Stop
// Trading on Congressional Knowledge Act). Members of Congress must disclose
// stock purchases and sales within 45 days of the transaction.
//
// Source: Quiver Quant public API (quiverquant.com) — aggregates STOCK Act
// disclosures from clerk.house.gov and senate.gov. No API key required.
// Returns up to 1,000 trades spanning ~12 months across 400+ tickers.
//
// Supports optional filtering by ticker, transaction type, or chamber.
//
// Includes performance data: excess return vs. SPY since the transaction date,
// enabling agents to assess whether congress members have persistent edge.
//
// Seam: Congressional trading data typically requires a Quiver Quant ($25/mo)
// or Capitol Trades ($49/mo) subscription. This delivers the same STOCK Act
// feed on-demand for $0.022/call.

const QQ_BASE  = "https://api.quiverquant.com/beta";
const UA       = "Mozilla/5.0 (compatible; the-stall/4.14; +https://intuitek.ai)";
const TIMEOUT  = 12_000;

async function fetchJSON(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
  return r.json();
}

function normalize(row) {
  return {
    representative:      row.Representative ?? null,
    ticker:              row.Ticker ?? null,
    transaction:         row.Transaction ?? null,
    range_usd:           row.Range ?? null,
    transaction_date:    row.TransactionDate ?? null,
    report_date:         row.ReportDate ?? null,
    chamber:             row.House ?? null,
    party:               row.Party ?? null,
    description:         row.Description ?? null,
    performance_vs_spy:  typeof row.ExcessReturn === "number"
                           ? Math.round(row.ExcessReturn * 100) / 100
                           : null,
    price_change_pct:    typeof row.PriceChange === "number"
                           ? Math.round(row.PriceChange * 100) / 100
                           : null,
    spy_change_pct:      typeof row.SPYChange === "number"
                           ? Math.round(row.SPYChange * 100) / 100
                           : null,
  };
}

function buildSummary(trades, filterType, filterChamber) {
  const purchases  = trades.filter(t => t.transaction?.toLowerCase().includes("purchase")).length;
  const sales      = trades.filter(t => t.transaction?.toLowerCase().includes("sale")).length;
  const reps       = new Set(trades.map(t => t.representative).filter(Boolean));
  const tickers    = [...new Set(trades.map(t => t.ticker).filter(Boolean))];
  const dates      = trades.map(t => t.transaction_date).filter(Boolean).sort();
  const perf       = trades.map(t => t.performance_vs_spy).filter(n => n !== null);
  const avgExcess  = perf.length
    ? Math.round((perf.reduce((a, b) => a + b, 0) / perf.length) * 100) / 100
    : null;

  return {
    total_trades:            trades.length,
    purchases,
    sales,
    unique_representatives:  reps.size,
    tickers_mentioned:       tickers.slice(0, 30),
    date_range:              dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    avg_excess_return_pct:   avgExcess,
    filter_applied:          { transaction_type: filterType, chamber: filterChamber },
  };
}

export default {
  name:  "congressional-trades",
  price: "$0.022",

  description:
    "US Congressional stock trades (STOCK Act disclosures). Two modes: supply a ticker to get all congress member trades in that stock (with excess-return-vs-SPY performance), or omit ticker for recent market-wide congressional activity. Returns representative, party, chamber, transaction type, dollar range, dates, and historical performance vs. SPY. Sourced from Quiver Quant's STOCK Act aggregator — no API key required. $0.022/call.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description:
          "Stock ticker to filter by (e.g. AAPL, NVDA). Case-insensitive. Omit for market-wide recent trades.",
      },
      limit: {
        type: "integer",
        description: "Maximum trades to return. Default 25, max 100.",
        default: 25,
        minimum: 1,
        maximum: 100,
      },
      transaction_type: {
        type: "string",
        enum: ["all", "purchase", "sale"],
        description: "Filter by transaction direction. Default: all.",
        default: "all",
      },
      chamber: {
        type: "string",
        enum: ["all", "house", "senate"],
        description: "Filter by congressional chamber. Default: all.",
        default: "all",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        description: "'ticker' (historical for a specific stock) or 'market_wide' (recent all-congress).",
      },
      trades: {
        type: "array",
        description: "List of congressional stock trades matching filters.",
        items: {
          type: "object",
          properties: {
            representative:   { type: "string" },
            ticker:           { type: "string" },
            transaction:      { type: "string", description: "Purchase | Sale | Sale (Partial)" },
            range_usd:        { type: "string", description: "STOCK Act dollar range, e.g. '$1,001 - $15,000'." },
            transaction_date: { type: "string", description: "YYYY-MM-DD date of the actual trade." },
            report_date:      { type: "string", description: "YYYY-MM-DD date filed with clerk." },
            chamber:          { type: "string", description: "Representatives | Senate" },
            party:            { type: "string", description: "Republican | Democratic | Independent" },
            description:      { type: ["string", "null"], description: "Filer's description note (often null)." },
            performance_vs_spy:  { type: ["number", "null"], description: "Excess return (%) vs. SPY since transaction date." },
            price_change_pct:    { type: ["number", "null"], description: "Stock price change (%) since transaction date." },
            spy_change_pct:      { type: ["number", "null"], description: "SPY price change (%) over same period." },
          },
        },
      },
      summary: {
        type: "object",
        properties: {
          total_trades:            { type: "integer" },
          purchases:               { type: "integer" },
          sales:                   { type: "integer" },
          unique_representatives:  { type: "integer" },
          tickers_mentioned:       { type: "array", items: { type: "string" } },
          date_range:              { type: ["object", "null"] },
          avg_excess_return_pct:   { type: ["number", "null"], description: "Average performance vs. SPY across all returned trades." },
          filter_applied:          { type: "object" },
        },
      },
      source: { type: "string" },
      ts:     { type: "string", description: "ISO-8601 response timestamp." },
    },
  },

  async call({ ticker, limit = 25, transaction_type = "all", chamber = "all" }) {
    const effectiveLimit = Math.min(Math.max(1, limit), 100);
    const txFilter   = (transaction_type ?? "all").toLowerCase();
    const chamFilter = (chamber ?? "all").toLowerCase();

    // Fetch full live feed (up to 1,000 records, ~12-month span, no auth required).
    // Ticker filtering is applied client-side — the historical per-ticker endpoint
    // requires paid auth, the live feed is free and covers 400+ tickers.
    const raw  = await fetchJSON(`${QQ_BASE}/live/congresstrading`);
    const mode = ticker ? "ticker" : "market_wide";

    if (!Array.isArray(raw)) {
      throw new Error("Unexpected response shape from Quiver Quant API");
    }

    let trades = raw.map(normalize);

    // apply ticker filter
    if (ticker) {
      const sym = ticker.trim().toUpperCase();
      trades = trades.filter(t => t.ticker?.toUpperCase() === sym);
    }

    // apply transaction_type filter
    if (txFilter !== "all") {
      trades = trades.filter(t =>
        t.transaction?.toLowerCase().includes(txFilter)
      );
    }

    // apply chamber filter
    if (chamFilter !== "all") {
      const chamKey = chamFilter === "house" ? "representatives" : "senate";
      trades = trades.filter(t =>
        t.chamber?.toLowerCase().includes(chamKey)
      );
    }

    // sort: most recent transaction date first
    trades.sort((a, b) => {
      const da = a.transaction_date ?? "";
      const db = b.transaction_date ?? "";
      return db.localeCompare(da);
    });

    // deduplicate: same rep + ticker + date + transaction can appear multiple times
    const seen    = new Set();
    const deduped = [];
    for (const t of trades) {
      const key = `${t.representative}|${t.ticker}|${t.transaction_date}|${t.transaction}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(t);
      }
    }

    const limited = deduped.slice(0, effectiveLimit);

    return {
      mode,
      trades:  limited,
      summary: buildSummary(limited, txFilter, chamFilter),
      source:  "quiverquant.com — STOCK Act (clerk.house.gov + senate.gov) disclosures",
      ts:      new Date().toISOString(),
    };
  },
};
