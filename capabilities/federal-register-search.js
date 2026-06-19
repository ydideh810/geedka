// federal-register-search.js
//
// Search the Federal Register for recent regulatory documents: Rules,
// Proposed Rules, Notices, and Presidential Documents. Returns title,
// abstract, document type, issuing agencies, significance flag,
// effective dates, and direct HTML/PDF links.
//
// Seam: compliance agents, legal agents, and policy trackers need a
// clean, fast regulatory feed — "what rules touched my industry this
// month?" A direct FR.gov API call works but requires raw URL-encoding
// juggling and produces nested agency objects that agents can't easily
// reason over. This cap normalizes the output and applies relevance
// sorting (final rules > proposed rules > notices, significant docs
// first within each tier).
//
// Free upstream: federalregister.gov/api/v1 — no API key, no auth.
// Priced at $0.002 — inline with other government-data caps.

const FR_BASE = "https://www.federalregister.gov/api/v1/articles.json";
const UA      = "Mozilla/5.0 (compatible; the-stall/4.5; +https://intuitek.ai)";
const TIMEOUT = 12_000;

// Type relevance tier for sorting — lower = higher priority
const TYPE_TIER = {
  "Rule":                   0,
  "Proposed Rule":          1,
  "Notice":                 2,
  "Presidential Document":  3,
};

export default {
  name:  "federal-register-search",
  price: "$0.002",

  description:
    "Search the Federal Register for Rules, Proposed Rules, and Notices matching a keyword — returns title, abstract, document type, agencies, significance, effective date, and links. No API key. $0.002/call.",

  inputSchema: {
    type:       "object",
    properties: {
      q: {
        type:        "string",
        description: "Search term or phrase (e.g. 'artificial intelligence', 'PFAS', 'cybersecurity').",
      },
      type: {
        type:        "string",
        enum:        ["Rule", "Proposed Rule", "Notice", "Presidential Document"],
        description: "Filter to a single document type (optional).",
      },
      days: {
        type:        "integer",
        minimum:     1,
        maximum:     730,
        description: "How many calendar days back to search (default 90). Max 730.",
      },
      limit: {
        type:        "integer",
        minimum:     1,
        maximum:     20,
        description: "Max documents to return (default 10, max 20).",
      },
      significant_only: {
        type:        "boolean",
        description: "If true, return only documents flagged as significant by the issuing agency.",
      },
    },
    required: [],
  },

  outputSchema: {
    type:       "object",
    properties: {
      documents: {
        type:  "array",
        items: {
          type:       "object",
          properties: {
            title:            { type: "string" },
            doc_type:         { type: "string", description: "Rule | Proposed Rule | Notice | Presidential Document" },
            agencies:         { type: "array",  items: { type: "string" }, description: "Short agency name list" },
            abstract:         { type: "string" },
            publication_date: { type: "string", description: "ISO date the document was published in the FR" },
            effective_on:     { type: ["string", "null"], description: "Date the rule becomes effective (null if not applicable)" },
            significant:      { type: ["boolean", "null"], description: "Agency-designated significant rulemaking flag" },
            document_number:  { type: "string" },
            url:              { type: "string" },
            pdf_url:          { type: "string" },
          },
        },
      },
      total_count:  { type: "integer",  description: "Total FR documents matching query in the date window" },
      query_term:   { type: "string" },
      date_range:   { type: "string",   description: "ISO date range searched (YYYY-MM-DD to YYYY-MM-DD)" },
      fetched_at:   { type: "string" },
    },
  },

  async handler(query) {
    const q             = String(query.q ?? "artificial intelligence").trim();

    const limit         = Math.min(Math.max(parseInt(query.limit ?? "10", 10), 1), 20);
    const days          = Math.min(Math.max(parseInt(query.days  ?? "90",  10), 1), 730);
    const significantOnly = query.significant_only === true || query.significant_only === "true";
    const typeFilter    = query.type ?? null;

    // Compute date range
    const now  = new Date();
    const from = new Date(now.getTime() - days * 86_400_000);
    const fmt  = (d) => d.toISOString().slice(0, 10);
    const fromStr = fmt(from);
    const toStr   = fmt(now);

    // Build query string manually — URLSearchParams doesn't handle FR's
    // bracketed param convention well across Node versions.
    const params = [
      `per_page=${Math.min(limit * 2, 20)}`,        // fetch extra to survive sig filter
      `order=newest`,
      `conditions%5Bterm%5D=${encodeURIComponent(q)}`,
      `conditions%5Bpublication_date%5D%5Bgte%5D=${fromStr}`,
      `conditions%5Bpublication_date%5D%5Blte%5D=${toStr}`,
      "fields%5B%5D=title",
      "fields%5B%5D=abstract",
      "fields%5B%5D=document_number",
      "fields%5B%5D=publication_date",
      "fields%5B%5D=effective_on",
      "fields%5B%5D=significant",
      "fields%5B%5D=type",
      "fields%5B%5D=agencies",
      "fields%5B%5D=html_url",
      "fields%5B%5D=pdf_url",
    ];
    if (typeFilter) {
      params.push(`conditions%5Btype%5D%5B%5D=${encodeURIComponent(typeFilter)}`);
    }

    const url = `${FR_BASE}?${params.join("&")}`;

    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      signal:  AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) throw new Error(`Federal Register API HTTP ${r.status}`);

    const data = await r.json();
    const raw  = Array.isArray(data.results) ? data.results : [];

    // Optional significance filter
    let filtered = significantOnly
      ? raw.filter(d => d.significant === true)
      : raw;

    // Sort: final rules → proposed rules → notices, significant within tier
    filtered.sort((a, b) => {
      const tierA = TYPE_TIER[a.type] ?? 99;
      const tierB = TYPE_TIER[b.type] ?? 99;
      if (tierA !== tierB) return tierA - tierB;
      // Within tier, significant docs first
      if (a.significant && !b.significant) return -1;
      if (!a.significant && b.significant) return  1;
      return 0;
    });

    const documents = filtered.slice(0, limit).map(d => ({
      title:            d.title ?? "",
      doc_type:         d.type  ?? "Unknown",
      agencies:         Array.isArray(d.agencies)
                          ? d.agencies.map(a => a.name ?? a.raw_name ?? "").filter(Boolean)
                          : [],
      abstract:         (d.abstract ?? "").slice(0, 600),
      publication_date: d.publication_date ?? null,
      effective_on:     d.effective_on ?? null,
      significant:      d.significant  ?? null,
      document_number:  d.document_number ?? "",
      url:              d.html_url ?? "",
      pdf_url:          d.pdf_url  ?? "",
    }));

    return {
      documents,
      total_count: data.count ?? 0,
      query_term:  q,
      date_range:  `${fromStr} to ${toStr}`,
      fetched_at:  now.toISOString(),
    };
  },
};
