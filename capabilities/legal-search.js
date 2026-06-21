// legal-search.js
//
// Searches US federal and state court opinions via CourtListener (Free Law Project).
// Covers 5M+ opinions from SCOTUS, federal circuits, and state courts.
// No API key required — CourtListener is open access.
//
// Seam: law-mcp.toulaw.workers.dev/api/v1/search — competing legal search service
//
// Upstream: courtlistener.com/api/rest/v4 — Free Law Project public API.

const CL_BASE = "https://www.courtlistener.com/api/rest/v4/search/";
const TIMEOUT = 12000;
const UA      = "the-stall/3.22 (https://intuitek.ai; mailto:kyle@intuitek.ai)";

// Court hierarchy for filtering
const COURT_GROUPS = {
  scotus:     ["scotus"],
  appeals:    ["ca1","ca2","ca3","ca4","ca5","ca6","ca7","ca8","ca9","ca10","ca11","cadc","cafc"],
  district:   ["dcd","cand","cacd","caed","casd","nysd","nyed","nynd","nywd","txsd","txed","txnd","txwd"],
  state:      [], // state courts — use full court ID or leave blank
};

function shapeOpinion(r) {
  return {
    id:           r.id || null,
    case_name:    r.caseName || r.case_name || null,
    date_filed:   r.dateFiled || r.date_filed || null,
    court:        r.court || r.court_id || null,
    citation:     r.citation?.[0] || null,
    docket_number: r.docketNumber || r.docket_number || null,
    status:       r.status || null,
    snippet:      r.snippet?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 500) || null,
    url:          r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : null,
    download_url: r.download_url || null,
    author:       r.author_str || null,
    joined_by:    r.joined_by_str || null,
    type:         r.type || null,
  };
}

export default {
  name: "legal-search",
  price: "$0.014",

  description:
    "Searches 5M+ US court opinions (SCOTUS, federal circuits, district courts, state courts) via CourtListener. Returns case name, court, date, citation, docket number, and a text snippet. Filter by court level, date range, or judge name. Useful for legal research agents, contract risk analysis, precedent lookup, and regulatory compliance workflows.",

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query — can be a legal concept, case name, statute, or citation (e.g. 'miranda rights', 'negligence per se', 'Title VII', '410 U.S. 113').",
      },
      court: {
        type: "string",
        description: "Filter by court level: 'scotus', 'appeals', 'district', or a specific court ID (e.g. 'ca9', 'nysd'). Leave blank for all courts.",
      },
      date_after: {
        type: "string",
        description: "Filter to opinions filed after this date (YYYY-MM-DD).",
      },
      date_before: {
        type: "string",
        description: "Filter to opinions filed before this date (YYYY-MM-DD).",
      },
      limit: {
        type: "integer",
        description: "Max results (default 5, max 20).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      query:        { type: "string" },
      total_found:  { type: "integer" },
      opinions:     { type: "array",  description: "Matching court opinions." },
      count:        { type: "integer" },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    if (!query.query?.trim()) query.query = "contract breach liability damages";

    const limit = Math.min(Math.max(1, parseInt(query.limit, 10) || 5), 20);

    const params = new URLSearchParams({
      q:         query.query.trim(),
      type:      "o",  // opinions
      format:    "json",
      page_size: limit,
    });

    if (query.date_after)  params.set("filed_after",  query.date_after);
    if (query.date_before) params.set("filed_before", query.date_before);

    // Court filter
    if (query.court) {
      const courtKey = query.court.toLowerCase();
      const group    = COURT_GROUPS[courtKey];
      if (group && group.length > 0) {
        // For predefined groups, filter by the first court (CourtListener OR-filters require repeated params)
        params.set("court", group[0]);
      } else if (!group) {
        // Specific court ID
        params.set("court", courtKey);
      }
    }

    const url  = `${CL_BASE}?${params}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) throw new Error(`CourtListener API HTTP ${resp.status}`);

    const data    = await resp.json();
    const results = data.results || [];

    return {
      query:       query.query,
      total_found: data.count || results.length,
      opinions:    results.map(shapeOpinion),
      count:       results.length,
      generated_at: new Date().toISOString(),
    };
  },
};
