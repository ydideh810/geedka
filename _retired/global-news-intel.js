// global-news-intel.js
//
// Global news search via GDELT v2 Doc API.
// Searches the entire global media ecosystem — online, broadcast, and print —
// across 200+ languages and 100+ countries for articles matching a query.
// Returns article list with title, URL, publication date, source country,
// language, and domain. Timeline mode returns coverage volume over time.
//
// Use case: geopolitical risk monitoring, ESG event screening, crisis detection,
// international market intelligence, topic trend analysis, competitive
// media presence tracking, regulatory change early-warning.
//
// Upstream: GDELT Project (api.gdeltproject.org) — free, no auth required.
// Rolling window: ~3 days for artlist, ~3 months for timeline.
// Rate limit: 1 req/5 sec (GDELT enforced). 429 returned to caller if hit.

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const UA         = "Mozilla/5.0 (compatible; myriad/4.29; +https://synaptiic.org)";
const TIMEOUT    = 15000;

async function gdeltQuery(params) {
  const url  = `${GDELT_BASE}?${new URLSearchParams(params)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (resp.status === 429) {
    const e = new Error("GDELT rate limit — upstream allows one request per 5 seconds; retry shortly");
    e.status = 503;
    throw e;
  }
  if (!resp.ok) throw new Error(`GDELT HTTP ${resp.status}`);
  const text = await resp.text();
  if (!text || !text.trim()) throw new Error("GDELT returned empty response");
  if (text.includes("keyword that was too short")) {
    throw new Error("Query too short — each keyword must be 3+ characters");
  }
  if (text.startsWith("Please limit")) {
    const e = new Error("GDELT rate limit — upstream allows one request per 5 seconds; retry shortly");
    e.status = 503;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GDELT non-JSON response: ${text.slice(0, 200)}`);
  }
}

function shapeArticle(a) {
  return {
    title:          a.title   || null,
    url:            a.url     || null,
    seen_date:      a.seendate || null,
    domain:         a.domain  || null,
    language:       a.language || null,
    source_country: a.sourcecountry || null,
    social_image:   a.socialimage || null,
  };
}

function shapeTimeline(data) {
  const points = data.timeline || [];
  return points.map(p => ({
    date:  p.date  || null,
    value: p.value != null ? Number(p.value) : null,
  }));
}

export default {
  name:  "global-news-intel",
  price: "$0.039",

  description:
    "Searches global news coverage across 200+ languages and 100+ countries via GDELT. Returns recent articles with title, URL, publication date, source country, and language. Timeline mode returns coverage volume over time. Ideal for geopolitical risk monitoring, ESG screening, crisis detection, international market intelligence, and media trend analysis. Free upstream API, no auth required. Data window: ~3 days (artlist), ~3 months (timeline).",

  inputSchema: {
    type:     "object",
    required: [],
    properties: {
      query: {
        type:        "string",
        description: "Search query — supports quoted phrases (e.g. '\"climate change\"') and boolean operators (AND, OR, NOT). Defaults to 'world news' if omitted.",
        default:     "world news",
      },
      mode: {
        type:        "string",
        enum:        ["artlist", "timeline"],
        description: "artlist (default): returns matching articles. timeline: returns article count per 15-min interval over time.",
        default:     "artlist",
      },
      maxrecords: {
        type:        "integer",
        description: "Max articles to return (artlist mode only). 1–250, default 10.",
        default:     10,
        minimum:     1,
        maximum:     250,
      },
      sourcelang: {
        type:        "string",
        description: "Filter by source language (e.g. 'english', 'spanish', 'chinese'). Omit for all languages.",
      },
      sourcecountry: {
        type:        "string",
        description: "Filter by 2-letter ISO country code (e.g. 'US', 'GB', 'CN', 'DE'). Omit for all countries.",
      },
      startdatetime: {
        type:        "string",
        description: "Start of time range: YYYYMMDDHHMMSS (e.g. '20260601000000').",
      },
      enddatetime: {
        type:        "string",
        description: "End of time range: YYYYMMDDHHMMSS.",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      query:    { type: "string" },
      mode:     { type: "string" },
      articles: {
        type:  "array",
        items: {
          type: "object",
          properties: {
            title:          { type: ["string", "null"] },
            url:            { type: ["string", "null"] },
            seen_date:      { type: ["string", "null"], description: "ISO-like date string: 20260601T123000Z" },
            domain:         { type: ["string", "null"] },
            language:       { type: ["string", "null"] },
            source_country: { type: ["string", "null"] },
            social_image:   { type: ["string", "null"] },
          },
        },
      },
      timeline: {
        type:  "array",
        items: {
          type: "object",
          properties: {
            date:  { type: ["string", "null"] },
            value: { type: ["number", "null"], description: "Normalized article count per interval" },
          },
        },
      },
      total: { type: "integer" },
      ts:    { type: "string" },
    },
  },

  async handler(input) {
    const q = (input.query || "world news").trim();

    const mode = input.mode === "timeline" ? "timeline" : "artlist";

    const params = {
      query:  q,
      mode:   mode === "timeline" ? "timeline" : "artlist",
      format: "json",
    };

    if (mode === "artlist") {
      const n = Math.min(250, Math.max(1, parseInt(input.maxrecords ?? 10, 10) || 10));
      params.maxrecords = String(n);
    }

    if (input.sourcelang)     params.sourcelang     = input.sourcelang;
    if (input.sourcecountry)  params.sourcecountry  = input.sourcecountry;
    if (input.startdatetime)  params.startdatetime  = input.startdatetime;
    if (input.enddatetime)    params.enddatetime    = input.enddatetime;

    const data = await gdeltQuery(params);

    const articles = mode === "artlist"
      ? (data.articles || []).map(shapeArticle)
      : [];
    const timeline = mode === "timeline"
      ? shapeTimeline(data)
      : [];

    return {
      query:    q,
      mode,
      articles,
      timeline,
      total:    mode === "artlist" ? articles.length : timeline.length,
      ts:       new Date().toISOString(),
    };
  },
};
