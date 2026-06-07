// economic-calendar.js
//
// Upcoming US macro economic data release schedule: when is the next CPI,
// NFP, FOMC, GDP, PCE, PPI, JOLTS, and 20+ more — dates, times (ET), periods,
// and market-impact priority in a single structured call.
//
// Sources:
//   - BLS live HTML calendar (bls.gov/schedule/YYYY/MM_sched.htm) — no API key,
//     authoritative for all BLS releases including NFP, CPI, PPI, JOLTS, etc.
//   - Static 2026 FOMC schedule from federalreserve.gov
//   - Static 2026 BEA schedule (GDP advance/revised/final, PCE/Personal Income)
//   - Static 2026 Census Bureau schedule (Retail Sales, Housing Starts, Durable Goods)
//
// Seam: macro-indicators returns current values; fomc-tracker returns the next
// Fed decision. Neither tells an agent WHEN the next CPI or NFP drops. This
// cap closes that gap — agents timing trades, hedging around announcements, or
// building macro-regime triggers need the release schedule, not just the data.
//
// Priced at $0.010 — aggregates 4 authoritative sources into one sorted calendar.

const BLS_BASE = "https://www.bls.gov/schedule";
const UA       = "Mozilla/5.0 (compatible; the-stall/4.12; +https://intuitek.ai)";
const TIMEOUT  = 14_000;

// ── Priority classification ────────────────────────────────────────────────
const PRIORITY_MAP = {
  high: [
    "Employment Situation",
    "Consumer Price Index",
    "Producer Price Index",
    "Job Openings and Labor Turnover Survey",
    "Gross Domestic Product",
    "Personal Income and Outlays",
    "Retail Sales",
    "Advance Retail Trade",
    "Durable Goods",
    "Advance Report on Durable Goods",
    "FOMC Meeting",
  ],
  medium: [
    "U.S. Import and Export Price Indexes",
    "Employment Cost Index",
    "Productivity and Costs",
    "Real Earnings",
    "Housing Starts",
    "New Residential Construction",
    "Consumer Credit",
    "Trade in Goods and Services",
    "U.S. International Trade",
    "Existing Home Sales",
    "Industrial Production and Capacity Utilization",
  ],
};

function getPriority(name) {
  const n = name.toLowerCase();
  for (const h of PRIORITY_MAP.high) {
    if (n.includes(h.toLowerCase())) return "high";
  }
  for (const m of PRIORITY_MAP.medium) {
    if (n.includes(m.toLowerCase())) return "medium";
  }
  return "low";
}

function getCategory(name) {
  const n = name.toLowerCase();
  if (n.includes("employment") || n.includes("job") || n.includes("labor") ||
      n.includes("earnings") || n.includes("unemployment") || n.includes("payroll"))
    return "employment";
  if (n.includes("price index") || n.includes("cpi") || n.includes("ppi") ||
      n.includes("import and export price") || n.includes("personal income"))
    return "inflation";
  if (n.includes("gdp") || n.includes("gross domestic") || n.includes("retail") ||
      n.includes("durable goods") || n.includes("productivity") || n.includes("industrial production"))
    return "growth";
  if (n.includes("fomc") || n.includes("federal open"))
    return "monetary_policy";
  if (n.includes("housing") || n.includes("residential") || n.includes("home sales"))
    return "housing";
  if (n.includes("trade") || n.includes("import") || n.includes("export"))
    return "trade";
  return "other";
}

// ── BLS HTML parser ────────────────────────────────────────────────────────
async function fetchBLSMonth(year, month) {
  const mm  = String(month).padStart(2, "0");
  const url = `${BLS_BASE}/${year}/${mm}_sched.htm`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) return []; // non-200 = month not published yet
  const html = await resp.text();
  return parseBLSHtml(html, year, month);
}

function parseBLSHtml(html, year, month) {
  const events = [];

  // Extract <td> cells — each is one calendar day
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tdMatch;
  while ((tdMatch = tdRegex.exec(html)) !== null) {
    const cell = tdMatch[1];

    // Get day number
    const dayMatch = cell.match(/<p class="day">(\d+)<\/p>/i);
    if (!dayMatch) continue;
    const day = parseInt(dayMatch[1], 10);

    // Each release is a <p> with <strong>Name<br></strong>Period<br>Time
    const releaseRegex = /<strong>([\s\S]*?)<br[\s/]*><\/strong>([\s\S]*?)<br[\s/]*>([\s\S]*?)(?=<\/p>)/gi;
    let rMatch;
    while ((rMatch = releaseRegex.exec(cell)) !== null) {
      const name   = rMatch[1].replace(/<[^>]+>/g, "").trim();
      const period = rMatch[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
      const time   = rMatch[3].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();

      if (!name || name.length < 3) continue;
      if (period === "Holiday") continue; // skip federal holidays

      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      events.push({
        date,
        report_name: name,
        period:      period || null,
        time_et:     time   || null,
        source:      "BLS",
        priority:    getPriority(name),
        category:    getCategory(name),
      });
    }
  }
  return events;
}

// ── Static supplemental calendar (FOMC + BEA + Census) ────────────────────
// Updated: 2026-06-07. Source: federalreserve.gov, bea.gov, census.gov
const STATIC_EVENTS_2026 = [
  // FOMC meeting end-dates (decision announced ~2pm ET same day)
  { date: "2026-01-28", report_name: "FOMC Meeting",     period: "January 2026",   time_et: "2:00 PM", source: "Fed", priority: "high", category: "monetary_policy" },
  { date: "2026-03-18", report_name: "FOMC Meeting (SEP)", period: "March 2026",   time_et: "2:00 PM", source: "Fed", priority: "high", category: "monetary_policy" },
  { date: "2026-04-29", report_name: "FOMC Meeting",     period: "April 2026",     time_et: "2:00 PM", source: "Fed", priority: "high", category: "monetary_policy" },
  { date: "2026-06-17", report_name: "FOMC Meeting (SEP)", period: "June 2026",    time_et: "2:00 PM", source: "Fed", priority: "high", category: "monetary_policy" },
  { date: "2026-07-29", report_name: "FOMC Meeting",     period: "July 2026",      time_et: "2:00 PM", source: "Fed", priority: "high", category: "monetary_policy" },
  { date: "2026-09-16", report_name: "FOMC Meeting (SEP)", period: "September 2026", time_et: "2:00 PM", source: "Fed", priority: "high", category: "monetary_policy" },
  { date: "2026-10-28", report_name: "FOMC Meeting",     period: "October 2026",   time_et: "2:00 PM", source: "Fed", priority: "high", category: "monetary_policy" },
  { date: "2026-12-09", report_name: "FOMC Meeting (SEP)", period: "December 2026", time_et: "2:00 PM", source: "Fed", priority: "high", category: "monetary_policy" },

  // BEA GDP advance/revised/final estimates (approx dates — BEA typically last week of month)
  { date: "2026-04-30", report_name: "Gross Domestic Product",  period: "Q1 2026 (Advance)",  time_et: "8:30 AM", source: "BEA", priority: "high", category: "growth" },
  { date: "2026-05-28", report_name: "Gross Domestic Product",  period: "Q1 2026 (Second)",   time_et: "8:30 AM", source: "BEA", priority: "high", category: "growth" },
  { date: "2026-06-25", report_name: "Gross Domestic Product",  period: "Q1 2026 (Third)",    time_et: "8:30 AM", source: "BEA", priority: "high", category: "growth" },
  { date: "2026-07-30", report_name: "Gross Domestic Product",  period: "Q2 2026 (Advance)",  time_et: "8:30 AM", source: "BEA", priority: "high", category: "growth" },
  { date: "2026-08-27", report_name: "Gross Domestic Product",  period: "Q2 2026 (Second)",   time_et: "8:30 AM", source: "BEA", priority: "high", category: "growth" },
  { date: "2026-09-24", report_name: "Gross Domestic Product",  period: "Q2 2026 (Third)",    time_et: "8:30 AM", source: "BEA", priority: "high", category: "growth" },
  { date: "2026-10-29", report_name: "Gross Domestic Product",  period: "Q3 2026 (Advance)",  time_et: "8:30 AM", source: "BEA", priority: "high", category: "growth" },

  // BEA Personal Income and Outlays (PCE — Fed's preferred inflation gauge)
  { date: "2026-05-29", report_name: "Personal Income and Outlays (PCE)", period: "April 2026",    time_et: "8:30 AM", source: "BEA", priority: "high", category: "inflation" },
  { date: "2026-06-27", report_name: "Personal Income and Outlays (PCE)", period: "May 2026",      time_et: "8:30 AM", source: "BEA", priority: "high", category: "inflation" },
  { date: "2026-07-31", report_name: "Personal Income and Outlays (PCE)", period: "June 2026",     time_et: "8:30 AM", source: "BEA", priority: "high", category: "inflation" },
  { date: "2026-08-28", report_name: "Personal Income and Outlays (PCE)", period: "July 2026",     time_et: "8:30 AM", source: "BEA", priority: "high", category: "inflation" },
  { date: "2026-09-25", report_name: "Personal Income and Outlays (PCE)", period: "August 2026",   time_et: "8:30 AM", source: "BEA", priority: "high", category: "inflation" },
  { date: "2026-10-30", report_name: "Personal Income and Outlays (PCE)", period: "September 2026", time_et: "8:30 AM", source: "BEA", priority: "high", category: "inflation" },
  { date: "2026-11-25", report_name: "Personal Income and Outlays (PCE)", period: "October 2026",  time_et: "8:30 AM", source: "BEA", priority: "high", category: "inflation" },
  { date: "2026-12-23", report_name: "Personal Income and Outlays (PCE)", period: "November 2026", time_et: "8:30 AM", source: "BEA", priority: "high", category: "inflation" },

  // Census Bureau — Advance Retail Trade (approx: ~15th of following month)
  { date: "2026-05-15", report_name: "Advance Retail Trade", period: "April 2026",    time_et: "8:30 AM", source: "Census", priority: "high", category: "growth" },
  { date: "2026-06-17", report_name: "Advance Retail Trade", period: "May 2026",      time_et: "8:30 AM", source: "Census", priority: "high", category: "growth" },
  { date: "2026-07-16", report_name: "Advance Retail Trade", period: "June 2026",     time_et: "8:30 AM", source: "Census", priority: "high", category: "growth" },
  { date: "2026-08-14", report_name: "Advance Retail Trade", period: "July 2026",     time_et: "8:30 AM", source: "Census", priority: "high", category: "growth" },
  { date: "2026-09-16", report_name: "Advance Retail Trade", period: "August 2026",   time_et: "8:30 AM", source: "Census", priority: "high", category: "growth" },
  { date: "2026-10-16", report_name: "Advance Retail Trade", period: "September 2026", time_et: "8:30 AM", source: "Census", priority: "high", category: "growth" },
  { date: "2026-11-17", report_name: "Advance Retail Trade", period: "October 2026",  time_et: "8:30 AM", source: "Census", priority: "high", category: "growth" },
  { date: "2026-12-16", report_name: "Advance Retail Trade", period: "November 2026", time_et: "8:30 AM", source: "Census", priority: "high", category: "growth" },

  // Census Bureau — Housing Starts (approx: ~18th of following month)
  { date: "2026-06-18", report_name: "New Residential Construction (Housing Starts)", period: "May 2026",      time_et: "8:30 AM", source: "Census", priority: "medium", category: "housing" },
  { date: "2026-07-17", report_name: "New Residential Construction (Housing Starts)", period: "June 2026",     time_et: "8:30 AM", source: "Census", priority: "medium", category: "housing" },
  { date: "2026-08-19", report_name: "New Residential Construction (Housing Starts)", period: "July 2026",     time_et: "8:30 AM", source: "Census", priority: "medium", category: "housing" },
  { date: "2026-09-17", report_name: "New Residential Construction (Housing Starts)", period: "August 2026",   time_et: "8:30 AM", source: "Census", priority: "medium", category: "housing" },
  { date: "2026-10-19", report_name: "New Residential Construction (Housing Starts)", period: "September 2026", time_et: "8:30 AM", source: "Census", priority: "medium", category: "housing" },

  // Census Bureau — Durable Goods Orders (approx: ~25th of following month)
  { date: "2026-06-24", report_name: "Advance Report on Durable Goods", period: "May 2026",      time_et: "8:30 AM", source: "Census", priority: "medium", category: "growth" },
  { date: "2026-07-24", report_name: "Advance Report on Durable Goods", period: "June 2026",     time_et: "8:30 AM", source: "Census", priority: "medium", category: "growth" },
  { date: "2026-08-26", report_name: "Advance Report on Durable Goods", period: "July 2026",     time_et: "8:30 AM", source: "Census", priority: "medium", category: "growth" },
  { date: "2026-09-25", report_name: "Advance Report on Durable Goods", period: "August 2026",   time_et: "8:30 AM", source: "Census", priority: "medium", category: "growth" },
  { date: "2026-10-28", report_name: "Advance Report on Durable Goods", period: "September 2026", time_et: "8:30 AM", source: "Census", priority: "medium", category: "growth" },
];

// ── Main ───────────────────────────────────────────────────────────────────
export default {
  name:  "economic-calendar",
  price: "$0.010",

  description:
    "Upcoming US macro data release schedule: CPI, NFP, FOMC, GDP, PCE, PPI, JOLTS, Retail Sales, Housing Starts, and 20+ more releases with exact dates, times (ET), and market-impact priority. BLS live calendar + Fed/BEA/Census static 2026 schedule. Essential for agents timing trades or building macro-regime signals.",

  inputSchema: {
    type: "object",
    properties: {
      days_ahead: {
        type:        "integer",
        description: "How many calendar days ahead to include (default: 30, max: 90).",
        default:     30,
        minimum:     1,
        maximum:     90,
      },
      priority_filter: {
        type:        "string",
        enum:        ["all", "high", "high_medium"],
        description: "Filter by priority level. 'high' returns only market-moving releases (CPI, NFP, FOMC, GDP, PCE, PPI, JOLTS). 'high_medium' adds Retail Sales, Housing Starts, Durable Goods. 'all' returns every release. Default: 'all'.",
        default:     "all",
      },
      category_filter: {
        type:        "string",
        enum:        ["all", "employment", "inflation", "growth", "monetary_policy", "housing", "trade"],
        description: "Filter by economic category. Default: 'all'.",
        default:     "all",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      events: {
        type:  "array",
        items: {
          type: "object",
          properties: {
            date:         { type: "string",  description: "ISO-8601 date (YYYY-MM-DD)." },
            days_until:   { type: "integer", description: "Calendar days from today until this release." },
            report_name:  { type: "string",  description: "Official name of the release." },
            period:       { type: "string",  description: "Reference period (e.g. 'May 2026', 'Q1 2026 (Advance)')." },
            time_et:      { type: "string",  description: "Release time in US Eastern Time." },
            source:       { type: "string",  description: "Source agency: BLS | Fed | BEA | Census." },
            priority:     { type: "string",  description: "Market-impact tier: high | medium | low." },
            category:     { type: "string",  description: "Economic category: employment | inflation | growth | monetary_policy | housing | trade | other." },
          },
        },
      },
      next_high_priority: {
        type:  "object",
        description: "The single next HIGH-priority release.",
      },
      total_count:    { type: "integer", description: "Total events returned." },
      days_ahead:     { type: "integer", description: "Horizon used." },
      bls_live:       { type: "boolean", description: "Whether BLS live data was successfully fetched." },
      ts:             { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const daysAhead      = Math.min(Math.max(parseInt(query.days_ahead || 30), 1), 90);
    const priorityFilter = query.priority_filter || "all";
    const categoryFilter = query.category_filter || "all";

    const today   = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + daysAhead);

    const todayStr   = today.toISOString().slice(0, 10);
    const horizonStr = horizon.toISOString().slice(0, 10);

    // ── Fetch BLS months needed ─────────────────────────────────────────
    let blsLive = false;
    const allBLSEvents = [];

    // Determine which months to fetch
    const monthsNeeded = new Set();
    const cur = new Date(today);
    while (cur <= horizon) {
      monthsNeeded.add(`${cur.getUTCFullYear()}-${cur.getUTCMonth() + 1}`);
      cur.setUTCDate(cur.getUTCDate() + 28);
    }
    // Ensure we always have the horizon month
    monthsNeeded.add(`${horizon.getUTCFullYear()}-${horizon.getUTCMonth() + 1}`);

    for (const ym of monthsNeeded) {
      const [yr, mo] = ym.split("-").map(Number);
      try {
        const evts = await fetchBLSMonth(yr, mo);
        allBLSEvents.push(...evts);
        if (evts.length > 0) blsLive = true;
      } catch (_) {
        // non-fatal — BLS might not have future months yet
      }
    }

    // ── Combine BLS + static ────────────────────────────────────────────
    // De-duplicate: BLS is authoritative; static supplements if BLS has no entry
    // for the same report+date. Build a set of BLS (date+name) keys.
    const blsKeys = new Set(allBLSEvents.map(e => `${e.date}||${e.report_name.toLowerCase()}`));

    const staticFiltered = STATIC_EVENTS_2026.filter(e => {
      // Skip if BLS already covers this report on this date
      const key = `${e.date}||${e.report_name.toLowerCase()}`;
      return !blsKeys.has(key);
    });

    let combined = [...allBLSEvents, ...staticFiltered];

    // ── Date-range filter ───────────────────────────────────────────────
    combined = combined.filter(e => e.date >= todayStr && e.date <= horizonStr);

    // ── Priority filter ─────────────────────────────────────────────────
    if (priorityFilter === "high") {
      combined = combined.filter(e => e.priority === "high");
    } else if (priorityFilter === "high_medium") {
      combined = combined.filter(e => e.priority === "high" || e.priority === "medium");
    }

    // ── Category filter ─────────────────────────────────────────────────
    if (categoryFilter !== "all") {
      combined = combined.filter(e => e.category === categoryFilter);
    }

    // ── Add days_until ─────────────────────────────────────────────────
    combined = combined.map(e => {
      const eventDate = new Date(e.date + "T00:00:00Z");
      const diffMs    = eventDate - today;
      const daysUntil = Math.max(0, Math.round(diffMs / 86400000));
      return { ...e, days_until: daysUntil };
    });

    // ── Sort by date ────────────────────────────────────────────────────
    combined.sort((a, b) => a.date.localeCompare(b.date));

    // ── Next high-priority event ────────────────────────────────────────
    const nextHigh = combined.find(e => e.priority === "high") || null;

    return {
      events:             combined,
      next_high_priority: nextHigh,
      total_count:        combined.length,
      days_ahead:         daysAhead,
      bls_live:           blsLive,
      ts:                 new Date().toISOString(),
    };
  },
};
