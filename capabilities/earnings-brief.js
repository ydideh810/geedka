// earnings-brief.js
//
// AI-synthesized earnings catalyst briefing for the next 7 days.
//
// Fetches the full 3-month Alpha Vantage earnings calendar (same free endpoint
// as earnings-calendar.js), filters to the next 7 days, selects the 15 most
// significant events by recognizing S&P 500 bellwethers, then uses gpt-4o-mini
// to produce a forward-looking earnings intelligence brief.
//
// One call replaces: manual calendar review + assessment of which events carry
// macro signal + synthesis of what it means for agent decision context.
//
// Seam: the agent hitting earnings-calendar 13 times/48h from a single wallet
// is running an automated earnings research pipeline. That pipeline needs a
// "what matters and why" synthesis layer — not just the raw upcoming events.
//
// Price: $0.35 — brief-family pattern.
// Upstreams: Alpha Vantage demo calendar (free) + gpt-4o-mini (OPENAI_API_KEY).

const AV_URL      = "https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=demo";
const OPENAI_URL  = "https://api.openai.com/v1/chat/completions";
const MODEL       = "gpt-4o-mini";
const UA          = "Mozilla/5.0 (compatible; myriad/4.65; +https://synaptiic.org)";
const CACHE_TTL   = 2 * 60 * 60 * 1000; // 2h
const GPT_TMO     = 38_000;

// Well-known bellwethers agents care about most
const BELLWETHERS = new Set([
  "AAPL","MSFT","GOOGL","GOOG","AMZN","META","NVDA","TSLA","AVGO","ORCL",
  "CRM","ADBE","QCOM","AMD","INTC","IBM","MU","AMAT","LRCX","KLAC",
  "JPM","BAC","GS","MS","WFC","C","BLK","AXP","V","MA","PYPL",
  "JNJ","UNH","PFE","ABBV","MRK","LLY","BMY","AMGN","GILD","CVS",
  "XOM","CVX","COP","SLB","OXY","EOG","VLO","PSX","MPC","HAL",
  "WMT","COST","TGT","HD","LOW","NKE","MCD","SBUX","YUM","DPZ",
  "DIS","NFLX","CMCSA","T","VZ","TMUS",
  "GE","BA","CAT","DE","HON","MMM","RTX","LMT","NOC",
  "BRK","BRK.B","WM","UPS","FDX","DAL","UAL","AAL",
  "COIN","HOOD","MSTR","MARA","RIOT",
]);

let _cache = null;

async function fetchCalendar() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.rows;

  const resp = await fetch(AV_URL, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Alpha Vantage HTTP ${resp.status}`);

  const text  = await resp.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error("empty calendar from Alpha Vantage");

  const rows = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    if (parts.length < 4) continue;
    const [symbol, name, reportDate, fiscalDateEnding, estimate, currency, timeOfDay] = parts;
    if (!symbol || !reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate.trim())) continue;
    rows.push({
      symbol:     symbol.trim(),
      name:       name ? name.trim() : null,
      date:       reportDate.trim(),
      eps_est:    estimate && estimate.trim() !== "" ? parseFloat(estimate.trim()) : null,
      timing:     timeOfDay ? timeOfDay.trim() || null : null,
    });
  }

  _cache = { rows, ts: Date.now() };
  return rows;
}

function getWindowDates(days = 7) {
  const now   = new Date();
  const start = now.toISOString().slice(0, 10);
  const end   = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);
  return { start, end };
}

async function synthesize(events, windowDays) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const eventLines = events.slice(0, 20).map(e => {
    const eps = e.eps_est != null ? ` (EPS est: ${e.eps_est})` : "";
    const tag = BELLWETHERS.has(e.symbol) ? " ★" : "";
    return `${e.date} ${e.timing || "?"} — ${e.symbol} (${e.name || "?"})${eps}${tag}`;
  }).join("\n");

  const prompt = `You are a senior earnings intelligence analyst writing a forward-looking brief for AI agents running financial research pipelines.

UPCOMING EARNINGS (next ${windowDays} days, ★ = major bellwether):
${eventLines}

Write a concise earnings intelligence brief of 150-200 words covering:
1. The most important earnings event(s) this week and what macro signal they carry
2. Key sectors with concentrated reporting
3. What agents relying on earnings data should watch for (guidance revisions, macro read-through, sector rotation signals)

Write in plain professional prose. No bullet points. Do not repeat all event dates. Focus on decision-relevant synthesis.

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "headline": "one sentence: the single most important earnings catalyst this week",
  "sector_focus": "one sentence: which sectors have the most reporting concentration",
  "agent_watch": "one sentence: what AI agents should monitor",
  "narrative": "the full 150-200 word briefing paragraph",
  "bellwether_count": <integer: number of major bellwethers reporting>,
  "confidence": <0.0 to 1.0>
}`;

  const resp = await fetch(OPENAI_URL, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model:       MODEL,
      max_tokens:  500,
      temperature: 0.2,
      messages:    [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(GPT_TMO),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err.slice(0, 120)}`);
  }

  const data  = await resp.json();
  const raw   = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  name:  "earnings-brief",
  price: "$0.35",

  description:
    "AI-synthesized earnings catalyst brief for the next 7 days (configurable 1–14). Fetches the Alpha Vantage earnings calendar, identifies S&P 500 bellwether events, and uses gpt-4o-mini to produce a 150-200 word forward-looking assessment: most important event, sector concentration, and agent decision implications. One call replaces manual calendar review + synthesis.",

  inputSchema: {
    type: "object",
    properties: {
      days: {
        type:        "integer",
        minimum:     1,
        maximum:     14,
        description: "Look-ahead window in days (default 7).",
      },
      style: {
        type:        "string",
        enum:        ["standard", "concise"],
        description: "'standard' = 150-200 word narrative (default). 'concise' = 80-100 words.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      headline:          { type: "string",  description: "Single most important earnings catalyst." },
      sector_focus:      { type: "string",  description: "Sector concentration this reporting period." },
      agent_watch:       { type: "string",  description: "What agents should monitor." },
      narrative:         { type: "string",  description: "Full briefing paragraph." },
      bellwether_count:  { type: "integer", description: "Number of major bellwethers reporting." },
      total_events:      { type: "integer", description: "Total earnings events in the window." },
      window_days:       { type: "integer", description: "Requested look-ahead window." },
      window_start:      { type: "string",  description: "Window start date (YYYY-MM-DD)." },
      window_end:        { type: "string",  description: "Window end date (YYYY-MM-DD)." },
      confidence:        { type: "number",  description: "Synthesis confidence 0–1." },
      events_sample: {
        type:  "array",
        items: { type: "object" },
        description: "Top 10 events in the window (bellwethers first).",
      },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const days  = Math.min(14, Math.max(1, (query.days ?? 7)));
    const { start, end } = getWindowDates(days);

    const all    = await fetchCalendar();
    const window = all.filter(r => r.date >= start && r.date <= end);

    // Sort: bellwethers first, then by date
    window.sort((a, b) => {
      const aB = BELLWETHERS.has(a.symbol) ? 0 : 1;
      const bB = BELLWETHERS.has(b.symbol) ? 0 : 1;
      if (aB !== bB) return aB - bB;
      return a.date.localeCompare(b.date);
    });

    if (window.length === 0) {
      throw Object.assign(
        new Error(`No earnings events found in the next ${days} days from Alpha Vantage calendar.`),
        { status: 404 }
      );
    }

    const synth = await synthesize(window, days);

    return {
      ...synth,
      total_events:  window.length,
      window_days:   days,
      window_start:  start,
      window_end:    end,
      events_sample: window.slice(0, 10).map(e => ({
        symbol:      e.symbol,
        name:        e.name,
        date:        e.date,
        timing:      e.timing,
        eps_est:     e.eps_est,
        bellwether:  BELLWETHERS.has(e.symbol),
      })),
      generated_at: new Date().toISOString(),
    };
  },
};
