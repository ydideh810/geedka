// stackoverflow-intel.js
//
// Stack Overflow question search via the official Stack Exchange API.
// No API key required (300 req/day unauthenticated). Returns top questions
// with scores, answer counts, accepted-answer status, tags, and body excerpts.
//
// Use case: developer agents debugging errors, finding code patterns, or
// researching library usage. "How do I use asyncio.timeout in Python 3.11?"
// → top scored SO results with accepted answers in one call.

const SE_BASE = "https://api.stackexchange.com/2.3";
const UA      = "Mozilla/5.0 (compatible; the-stall/4.57; +https://intuitek.ai)";

function stripHtml(html) {
  if (!html) return null;
  return html
    .replace(/<pre[^>]*>[\s\S]*?<\/pre>/gi, "[code block]")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim()
    .slice(0, 600) || null;
}

export default {
  name:  "stackoverflow-intel",
  price: "$0.014",

  description:
    "Stack Overflow question search. Returns top-scored questions matching the query with answer counts, accepted-answer status, tags, and body excerpts. Filter by tags (comma-separated). Sort by votes, relevance, activity, or creation date. Useful for developer agents debugging errors or researching library patterns.",

  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Search query (required). Use natural language or error messages.",
      },
      tags: {
        type: "string",
        description: "Semicolon-separated list of required tags (e.g. 'python;asyncio'). Optional.",
      },
      sort: {
        type: "string",
        enum: ["votes", "relevance", "activity", "creation"],
        description: "Sort order. Default: votes (highest score first).",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Number of results (1–10). Default: 5.",
      },
      accepted_only: {
        type: "boolean",
        description: "If true, return only questions with an accepted answer. Default: false.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question_id:    { type: "integer",              description: "SO question ID." },
            title:          { type: "string",               description: "Question title." },
            score:          { type: "integer",              description: "Net upvote score." },
            answer_count:   { type: "integer",              description: "Number of answers." },
            is_answered:    { type: "boolean",              description: "True if an accepted answer exists." },
            tags:           { type: "array", items: { type: "string" }, description: "Associated tags." },
            creation_date:  { type: "string",               description: "ISO-8601 creation timestamp." },
            last_activity:  { type: "string",               description: "ISO-8601 last activity timestamp." },
            link:           { type: "string",               description: "Direct URL to the question." },
            body_excerpt:   { type: ["string", "null"],     description: "First ~600 chars of question body (HTML stripped). Code blocks replaced with [code block]." },
          },
        },
      },
      total_found: { type: "integer",  description: "Total matching questions on SO (may exceed returned limit)." },
      quota_remaining: { type: "integer", description: "Remaining API calls in current quota window (300/day unauthenticated)." },
      ts:          { type: "string",   description: "ISO-8601 response timestamp." },
    },
  },

  async handler(query) {
    const q    = String(query.q || "artificial intelligence").trim();

    const limit       = Math.min(Math.max(1, query.limit || 5), 10);
    const sort        = ["votes", "relevance", "activity", "creation"].includes(query.sort) ? query.sort : "votes";
    const acceptedOnly = query.accepted_only === true || query.accepted_only === "true";

    const params = new URLSearchParams({
      order:    "desc",
      sort,
      q,
      site:     "stackoverflow",
      pagesize: String(limit),
      filter:   "withbody",
    });

    if (query.tags) {
      // semicolon-separated for SE API
      params.set("tagged", String(query.tags).replace(/,/g, ";"));
    }
    if (acceptedOnly) {
      params.set("accepted", "True");
    }

    const url = `${SE_BASE}/search/advanced?${params}`;

    let raw;
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip" },
        signal: AbortSignal.timeout(12000),
      });
      if (!resp.ok) throw new Error(`Stack Exchange API HTTP ${resp.status}`);
      raw = await resp.json();
    } catch (err) {
      throw new Error(`Stack Exchange fetch failed: ${err.message}`);
    }

    if (raw.error_id) {
      throw new Error(`Stack Exchange error ${raw.error_id}: ${raw.error_message}`);
    }

    const questions = (raw.items || []).map(q => ({
      question_id:   q.question_id,
      title:         q.title || "",
      score:         q.score ?? 0,
      answer_count:  q.answer_count ?? 0,
      is_answered:   q.is_answered ?? false,
      tags:          q.tags || [],
      creation_date: q.creation_date ? new Date(q.creation_date * 1000).toISOString() : null,
      last_activity: q.last_activity_date ? new Date(q.last_activity_date * 1000).toISOString() : null,
      link:          q.link || `https://stackoverflow.com/q/${q.question_id}`,
      body_excerpt:  stripHtml(q.body),
    }));

    return {
      questions,
      total_found:     raw.total ?? questions.length,
      quota_remaining: raw.quota_remaining ?? null,
      ts: new Date().toISOString(),
    };
  },
};
