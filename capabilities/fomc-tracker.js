// fomc-tracker.js
//
// Returns the current US Federal Funds Rate, next FOMC meeting date with
// countdown, rate trend (hiking / holding / cutting), and the full 2026
// FOMC schedule.
//
// Fills the monetary-policy context layer missing from treasury-yields and
// macro-brief: when is the next policy decision, what is the current rate,
// and are we in a hiking or cutting cycle?
//
// Data sources:
//   - FEDFUNDS: FRED public CSV (no API key, monthly effective rate)
//     Effective rate closely tracks the target range midpoint.
//   - 2026 FOMC calendar: static schedule from federalreserve.gov
//     Meetings with * include Summary of Economic Projections + press conference.
//
// Seam: fills the FOMC-timing gap that treasury-yields + credit-spreads leave open.
// Agents pricing rates, running bond strategies, or building macro-regime signals
// need to know when the next decision is and what cycle the Fed is in.
//
// Priced at $0.008 — same data-only tier as treasury-yields.

const FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const UA        = "Mozilla/5.0 (compatible; the-stall/3.99; +https://intuitek.ai)";
const FRED_TMO  = 14_000;

// 2026 FOMC meeting end-dates from federalreserve.gov/monetarypolicy/fomccalendars.htm
// Scraped 2026-06-07. pressConf = true → meeting includes SEP / dot plot / press conference.
const FOMC_2026 = [
  { end: "2026-01-28", pressConf: false },
  { end: "2026-03-18", pressConf: true  },
  { end: "2026-04-29", pressConf: false },
  { end: "2026-06-17", pressConf: true  },
  { end: "2026-07-29", pressConf: false },
  { end: "2026-09-16", pressConf: true  },
  { end: "2026-10-28", pressConf: false },
  { end: "2026-12-09", pressConf: true  },
];

async function fetchFedfunds() {
  const resp = await fetch(`${FRED_BASE}?id=FEDFUNDS`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FRED_TMO),
  });
  if (!resp.ok) throw new Error(`FRED FEDFUNDS HTTP ${resp.status}`);
  const text = await resp.text();
  if (text.includes("<html") || text.includes("<!DOCTYPE"))
    throw new Error("FRED FEDFUNDS returned HTML — series may be unavailable");

  const lines = text.trim().split("\n")
    .filter(l => !l.startsWith("DATE") && l.includes(","));

  const recent = [];
  for (let i = lines.length - 1; i >= 0 && recent.length < 13; i--) {
    const [date, val] = lines[i].split(",");
    if (val && val.trim() !== "." && val.trim() !== "") {
      recent.unshift({ date: date.trim(), value: parseFloat(val.trim()) });
    }
  }
  return recent;
}

function classifyTrend(recent) {
  if (recent.length < 3) return "unknown";
  const last       = recent[recent.length - 1].value;
  const refIdx     = Math.max(0, recent.length - 7); // ~6 months back
  const sixMonthAgo = recent[refIdx].value;
  const diff = last - sixMonthAgo;
  if (Math.abs(diff) < 0.06) return "holding";
  return diff > 0 ? "hiking" : "cutting";
}

const r2 = n => Math.round(n * 100) / 100;

export default {
  name: "fomc-tracker",
  price: "$0.008",

  description:
    "US Federal Funds Rate, next FOMC meeting date + countdown, rate trend (hiking/holding/cutting), and full 2026 schedule. FRED public CSV + static calendar. Pairs with treasury-yields and credit-spreads.",

  inputSchema: {
    type: "object",
    properties: {},
  },

  outputSchema: {
    type: "object",
    properties: {
      current_rate_pct: {
        type: "number",
        description: "FEDFUNDS monthly effective rate, latest available (%). Tracks target range midpoint.",
      },
      rate_date: {
        type: "string",
        description: "Date of the latest FEDFUNDS observation (YYYY-MM-01, monthly series).",
      },
      rate_trend: {
        type: "string",
        description: "Rate direction over last 6 months: 'hiking', 'holding', or 'cutting'.",
      },
      rate_change_6m_pct: {
        type: "number",
        description: "Rate change over last 6 months in percentage points (negative = cuts).",
      },
      next_meeting_date: {
        type: "string",
        description: "End date of the next FOMC meeting (YYYY-MM-DD). Policy decision announced this day.",
      },
      next_meeting_days_away: {
        type: "integer",
        description: "Calendar days until the next FOMC meeting end date.",
      },
      next_is_press_conf: {
        type: "boolean",
        description: "True if the next meeting includes a press conference and SEP (dot plot).",
      },
      meetings_remaining_year: {
        type: "integer",
        description: "FOMC meetings remaining in 2026, including the next one.",
      },
      all_2026_meetings: {
        type: "array",
        description: "Full 2026 FOMC schedule.",
        items: {
          type: "object",
          properties: {
            date:       { type: "string",  description: "Meeting end date (YYYY-MM-DD)." },
            press_conf: { type: "boolean", description: "Includes SEP/press conference." },
            status:     { type: "string",  description: "'past' or 'upcoming'." },
          },
        },
      },
      ts: { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(_query) {
    const now      = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    const rateData = await fetchFedfunds();
    if (!rateData.length) throw new Error("No FEDFUNDS data returned from FRED");

    const latest     = rateData[rateData.length - 1];
    const refIdx     = Math.max(0, rateData.length - 7);
    const change6m   = r2(latest.value - rateData[refIdx].value);
    const trend      = classifyTrend(rateData);

    const annotated = FOMC_2026.map(m => ({
      date:       m.end,
      press_conf: m.pressConf,
      status:     m.end <= todayStr ? "past" : "upcoming",
    }));

    const upcoming = annotated.filter(m => m.status === "upcoming");
    const next     = upcoming[0] ?? null;

    let daysAway = null;
    if (next) {
      const nextMs = new Date(next.date + "T23:59:59Z").getTime();
      daysAway = Math.ceil((nextMs - now.getTime()) / 86_400_000);
    }

    return {
      current_rate_pct:        latest.value,
      rate_date:               latest.date,
      rate_trend:              trend,
      rate_change_6m_pct:      change6m,
      next_meeting_date:       next?.date ?? null,
      next_meeting_days_away:  daysAway,
      next_is_press_conf:      next?.press_conf ?? null,
      meetings_remaining_year: upcoming.length,
      all_2026_meetings:       annotated,
      ts:                      now.toISOString(),
    };
  },
};
