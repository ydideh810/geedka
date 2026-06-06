// gov-votes.js
//
// US Congressional vote records via GovTrack's free public API.
// Search votes by chamber, congress, category, keyword, or date range.
// Returns vote question, result, chamber, date, and vote breakdown.
//
// Seam: 2s.io/api/gov/house-votes — 340 sett/wk, 2 payers, $0.004/call
//
// Upstream: govtrack.us/api/v2 — open government data, no auth.

const GT_BASE = "https://www.govtrack.us/api/v2/vote";
const TIMEOUT = 12000;
const UA      = "the-stall/3.24 (https://intuitek.ai; mailto:kyle@intuitek.ai)";

// Vote categories
const CATEGORIES = {
  "passage":           "Bill passage",
  "amendment":         "Amendment",
  "cloture":           "Cloture (Senate)",
  "procedural":        "Procedural",
  "nomination":        "Nomination",
  "treaty":            "Treaty",
  "impeachment":       "Impeachment",
  "veto-override":     "Veto override",
  "other":             "Other",
};

async function fetchVotes(params) {
  const url  = `${GT_BASE}?${new URLSearchParams(params)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`GovTrack API HTTP ${resp.status}`);
  return resp.json();
}

async function fetchVoteDetail(voteId) {
  const url  = `${GT_BASE}_voter?vote=${voteId}&order_by=voter&limit=5`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.summary || null;
  } catch (_) {
    return null;
  }
}

function shapeVote(v) {
  return {
    id:               v.id,
    vote_number:      v.number,
    congress:         v.congress,
    chamber:          v.chamber_label || v.chamber,
    session:          v.session,
    date:             v.created,
    question:         v.question,
    question_details: v.question_details || null,
    category:         v.category_label || v.category,
    result:           v.result,
    result_text:      v.result_text || null,
    required:         v.required || null,
    total_plus:       v.total_plus,
    total_minus:      v.total_minus,
    total_other:      v.total_other,
    missing:          v.missing_data || false,
    related_bill:     v.related_bill ? {
      title:   v.related_bill.title,
      number:  v.related_bill.number,
      type:    v.related_bill.bill_type,
      url:     `https://www.govtrack.us${v.related_bill.link || ""}`,
    } : null,
    url: `https://www.govtrack.us${v.link || `/congress/votes/${v.congress || ""}${v.session || ""}/${v.chamber === "s" ? "s" : "h"}${v.number || ""}`}`,
  };
}

export default {
  name: "gov-votes",
  price: "$0.004",

  description:
    "US Congressional vote records from GovTrack (113th Congress onward). Search by chamber (house/senate), category (passage, amendment, cloture, nomination, etc.), date range, or keyword. Returns vote question, result (Passed/Failed), vote breakdown (yeas/nays), related bill title, and GovTrack URL. Useful for legislative intelligence, policy tracking, and compliance monitoring agents.",

  inputSchema: {
    type: "object",
    properties: {
      chamber: {
        type: "string",
        enum: ["house", "senate", "both"],
        description: "Chamber to search. Default: 'house'.",
      },
      congress: {
        type: "integer",
        description: "Congress number (e.g. 118 for current). Default: 118.",
      },
      category: {
        type: "string",
        enum: ["passage", "amendment", "cloture", "procedural", "nomination", "treaty", "impeachment", "veto-override", "other"],
        description: "Vote category filter.",
      },
      date_after: {
        type: "string",
        description: "Filter to votes after this date (YYYY-MM-DD).",
      },
      date_before: {
        type: "string",
        description: "Filter to votes before this date (YYYY-MM-DD).",
      },
      keyword: {
        type: "string",
        description: "Keyword to search in vote question (e.g. 'infrastructure', 'healthcare', 'defense').",
      },
      result: {
        type: "string",
        enum: ["passed", "failed", "agreed", "rejected"],
        description: "Filter by vote result.",
      },
      limit: {
        type: "integer",
        description: "Max results (default 10, max 50).",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      votes:        { type: "array",   description: "Congressional vote records." },
      count:        { type: "integer" },
      total_found:  { type: "integer" },
      chamber:      { type: "string"  },
      congress:     { type: "integer" },
      generated_at: { type: "string"  },
    },
  },

  async handler(query) {
    const chamber  = (query.chamber || "house").toLowerCase();
    const congress = parseInt(query.congress, 10) || 118;
    const limit    = Math.min(Math.max(1, parseInt(query.limit, 10) || 10), 50);

    const params = {
      congress,
      limit,
      order_by: "-created",
      format: "json",
    };

    if (chamber !== "both") params.chamber = chamber === "house" ? "h" : "s";
    if (query.category)     params.category = query.category;
    if (query.date_after)   params.created__gt  = query.date_after;
    if (query.date_before)  params.created__lt  = query.date_before;
    if (query.keyword)      params.question__icontains = query.keyword;
    if (query.result) {
      const rm = { passed: "Passed", failed: "Failed", agreed: "Agreed to", rejected: "Rejected" };
      if (rm[query.result]) params.result = rm[query.result];
    }

    const data  = await fetchVotes(params);
    const votes = data.objects || [];
    const total = data.meta?.total_count || votes.length;

    return {
      votes:        votes.map(shapeVote),
      count:        votes.length,
      total_found:  total,
      chamber:      chamber,
      congress,
      generated_at: new Date().toISOString(),
    };
  },
};
