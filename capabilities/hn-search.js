// hn-search.js
//
// Hacker News story/comment search via Algolia's free public API.
// No key required. Returns stories ranked by relevance or recency,
// with score, comment count, author, and URL.
//
// Priced at $0.020/call — Search category is growing 26+ new Bazaar
// endpoints/day (signal-intel growth signal, 2026-06-05).

const ALGOLIA_BASE = "https://hn.algolia.com/api/v1";
const UA           = "Mozilla/5.0 (compatible; the-stall/1.3; +https://intuitek.ai)";

// Map friendly date-range labels to Algolia numericFilters timestamps
function dateFilter(range) {
  const now = Math.floor(Date.now() / 1000);
  const DAY  = 86400;
  const map  = { day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };
  const secs = map[range];
  if (!secs) return null;
  return `created_at_i>${now - secs}`;
}

export default {
  name:  "hn-search",
  price: "$0.040",

  description:
    "Hacker News story and comment search via Algolia. Returns titles, scores, comment counts, authors, and URLs for posts matching the query. Filter by type (story/comment) and date range (day/week/month/year/all). Sorted by relevance by default; use sort=date for newest-first. Useful for tech news, community sentiment, or discovering discussion threads about a topic.",

  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Search query (required). Use quotes for exact phrases.",
      },
      type: {
        type: "string",
        enum: ["story", "comment", "all"],
        description: "Content type to search. Default: story.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        description: "Number of results (1–20). Default: 10.",
      },
      sort: {
        type: "string",
        enum: ["relevance", "date"],
        description: "Sort order — relevance (default) or date (newest first).",
      },
      date_range: {
        type: "string",
        enum: ["day", "week", "month", "year", "all"],
        description: "Filter results to a time window. Default: all.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      hits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id:           { type: "string",  description: "HN item ID." },
            type:         { type: "string",  description: "story or comment." },
            title:        { type: ["string", "null"], description: "Story title." },
            url:          { type: ["string", "null"], description: "External URL (null for Ask HN / text posts)." },
            hn_url:       { type: "string",  description: "Direct HN discussion link." },
            author:       { type: "string",  description: "Submitter username." },
            points:       { type: ["integer", "null"], description: "Upvote score." },
            num_comments: { type: ["integer", "null"], description: "Comment count." },
            created_at:   { type: "string",  description: "ISO-8601 post timestamp." },
            text:         { type: ["string", "null"], description: "Post body text (Ask HN or comments). Stripped of HTML." },
          },
        },
      },
      total_found: { type: "integer", description: "Total matching items in HN (can exceed returned hits)." },
      ts:          { type: "string",  description: "ISO-8601 response timestamp." },
    },
  },

  async handler(query) {
    const q         = String(query.q || "artificial intelligence").trim();

    const type      = query.type || "story";
    const limit     = Math.min(Math.max(1, query.limit || 10), 20);
    const sort      = query.sort === "date" ? "search_by_date" : "search";
    const dateRange = query.date_range || "all";

    const params = new URLSearchParams({ query: q, hitsPerPage: limit });

    if (type !== "all") params.set("tags", type);

    const df = dateFilter(dateRange);
    if (df) params.set("numericFilters", df);

    const url = `${ALGOLIA_BASE}/${sort}?${params}`;

    let raw;
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`Algolia HTTP ${resp.status}`);
      raw = await resp.json();
    } catch (err) {
      throw new Error(`HN Algolia fetch failed: ${err.message}`);
    }

    const hits = (raw.hits || []).map(h => {
      // Strip HTML from text
      const rawText = h.story_text || h.comment_text || null;
      const text    = rawText
        ? rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null
        : null;

      return {
        id:           String(h.objectID),
        type:         h._tags?.includes("comment") ? "comment" : "story",
        title:        h.title || null,
        url:          h.url || null,
        hn_url:       `https://news.ycombinator.com/item?id=${h.objectID}`,
        author:       h.author || "",
        points:       h.points ?? null,
        num_comments: h.num_comments ?? null,
        created_at:   h.created_at || "",
        text,
      };
    });

    return {
      hits,
      total_found: raw.nbHits || 0,
      ts: new Date().toISOString(),
    };
  },
};
