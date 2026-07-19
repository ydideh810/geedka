// weather-alerts.js
//
// Active US weather alerts and warnings from NOAA National Weather Service.
// Covers tornado warnings, flash flood watches, hurricane warnings,
// blizzard advisories, heat advisories, and 80+ other event types.
//
// Source: api.weather.gov/alerts — NOAA NWS public API, no key, no auth.
// Data is real-time; alerts are issued, updated, and cancelled within minutes.
// Filterable by state, event type, and severity.
//
// Returns: event type, severity, certainty, urgency, affected areas,
// onset/expiry times, headline, protective instructions, and issuing office.
//
// Use cases: logistics/supply chain agents routing around severe weather,
// event planning agents checking venue safety, real estate risk agents,
// insurance underwriting agents, emergency preparedness workflows.
//
// Seam: weather.js provides forecasts; this cap provides active emergency
// alerts — complementary, not overlapping. AlertMedia ($50+/mo),
// AccuWeather Enterprise alerts ($200+/mo). NWS public data is $0.003/call.
//
// [REDACTED]3, 2026-06-07.

const ALERTS_BASE = "https://api.weather.gov/alerts/active";
const TIMEOUT     = 12_000;
const UA          = "myriad/1.0 (+https://synaptiic.org; kyle@synaptiic.org)";

const SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

function shapeAlert(f) {
  const p = f.properties ?? {};
  return {
    id:          p.id ?? null,
    event:       p.event ?? null,
    severity:    p.severity ?? null,
    certainty:   p.certainty ?? null,
    urgency:     p.urgency ?? null,
    status:      p.status ?? null,
    area:        p.areaDesc ?? null,
    sender:      p.senderName ?? null,
    sent:        p.sent ?? null,
    effective:   p.effective ?? null,
    onset:       p.onset ?? null,
    expires:     p.expires ?? null,
    ends:        p.ends ?? null,
    headline:    p.headline ?? null,
    description: (p.description ?? "").trim().slice(0, 1000) || null,
    instruction: (p.instruction ?? "").trim().slice(0, 500) || null,
    response:    p.response ?? null,
  };
}

export default {
  name: "weather-alerts",
  price: "$0.059",

  description:
    "Active NOAA weather alerts for any US state — tornado warnings, flash flood watches, hurricane warnings, blizzard advisories, heat alerts, and 80+ other NWS event types. Real-time data from api.weather.gov; no API key. Filterable by state, event type, or severity. Returns event, severity, certainty, urgency, affected areas, onset/expiry, headline, and protective action instructions. Complements weather.js (forecasts) — this cap covers active emergencies.",

  inputSchema: {
    type: "object",
    properties: {
      state: {
        type: "string",
        description:
          "2-letter US state code to filter by (e.g. 'TX', 'FL'). Omit to get all active US alerts.",
      },
      event: {
        type: "string",
        description:
          "Filter by event type (e.g. 'Tornado Warning', 'Flash Flood Watch', 'Hurricane Warning'). Partial matches not supported — use exact NWS event names.",
      },
      severity: {
        type: "string",
        description:
          "Minimum severity level to return: Extreme, Severe, Moderate, Minor. Default: no filter (all severities).",
        enum: ["Extreme", "Severe", "Moderate", "Minor"],
      },
      limit: {
        type: "integer",
        description: "Max alerts to return (1–100, default 25). Sorted by severity descending.",
        minimum: 1,
        maximum: 100,
        default: 25,
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      total_active: { type: "integer" },
      returned:     { type: "integer" },
      filters:      { type: "object" },
      alerts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:          { type: "string" },
            event:       { type: "string" },
            severity:    { type: "string" },
            certainty:   { type: "string" },
            urgency:     { type: "string" },
            status:      { type: "string" },
            area:        { type: "string" },
            sender:      { type: "string" },
            sent:        { type: "string" },
            onset:       { type: "string", nullable: true },
            expires:     { type: "string", nullable: true },
            ends:        { type: "string", nullable: true },
            headline:    { type: "string", nullable: true },
            description: { type: "string", nullable: true },
            instruction: { type: "string", nullable: true },
            response:    { type: "string", nullable: true },
          },
        },
      },
    },
  },

  async handler(query) {
    const url = new URL(ALERTS_BASE);
    url.searchParams.set("status", "actual");
    url.searchParams.set("message_type", "alert,update");

    const stateFilter    = query.state    ? query.state.trim().toUpperCase() : null;
    const eventFilter    = query.event    ? query.event.trim() : null;
    const severityFilter = query.severity ? query.severity.trim() : null;
    const limit          = Math.min(100, Math.max(1, parseInt(query.limit) || 25));

    if (stateFilter) url.searchParams.set("area", stateFilter);
    if (eventFilter) url.searchParams.set("event", eventFilter);

    const r = await fetch(url.toString(), {
      headers: { "User-Agent": UA, Accept: "application/geo+json" },
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) throw new Error(`NWS API HTTP ${r.status}`);

    const data     = await r.json();
    let   features = data.features ?? [];
    const total    = features.length;

    // Client-side severity filter
    if (severityFilter) {
      const minRank = SEVERITY_RANK[severityFilter] ?? 0;
      features = features.filter(f => (SEVERITY_RANK[f.properties?.severity] ?? 0) >= minRank);
    }

    // Sort by severity descending, then by onset ascending
    features.sort((a, b) => {
      const sa = SEVERITY_RANK[a.properties?.severity] ?? 0;
      const sb = SEVERITY_RANK[b.properties?.severity] ?? 0;
      if (sb !== sa) return sb - sa;
      const ta = a.properties?.onset ?? a.properties?.sent ?? "";
      const tb = b.properties?.onset ?? b.properties?.sent ?? "";
      return ta.localeCompare(tb);
    });

    const alerts = features.slice(0, limit).map(shapeAlert);

    return {
      total_active: total,
      returned:     alerts.length,
      filters: {
        state:    stateFilter,
        event:    eventFilter,
        severity: severityFilter,
      },
      alerts,
    };
  },
};
