// reddit-intel.js
//
// Searches Reddit posts and comments via PullPush public API. Returns ranked
// results with score, comment count, author, subreddit, and direct URL.
//
// Use case: competitive intelligence, market sentiment, trend detection, topic
// research. An agent queries "bitcoin ETF regulation" and gets the top-scoring
// posts across r/investing, r/CryptoCurrency, r/finance in one call.
//
// Seam origin: stableenrich.dev/api/reddit/search (3,258 settlements/wk,
// 84 unique payers, avg $0.035/call). Surfaced by [REDACTED]4, 2026-06-06.
// PullPush.io is a community-maintained free alternative to Pushshift — no
// auth, no rate-limit headers on standard queries, stable endpoint.

const PULLPUSH_POST    = "https://api.pullpush.io/reddit/search/submission/";
const PULLPUSH_COMMENT = "https://api.pullpush.io/reddit/search/comment/";
const UA               = "Mozilla/5.0 (compatible; the-stall/3.6; +https://intuitek.ai)";

function epochToISO(ts) {
  if (!ts) return null;
  const n = typeof ts === "string" ? parseFloat(ts) : ts;
  return new Date(n * 1000).toISOString();
}

async function searchPosts(q, subreddit, sort, limit) {
  const params = new URLSearchParams({ q, size: String(limit), sort: "desc", sort_type: sort });
  if (subreddit) params.set("subreddit", subreddit);
  const url = `${PULLPUSH_POST}?${params}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`PullPush posts HTTP ${res.status}`);
  const json = await res.json();
  return (json.data || []).map(p => ({
    type:        "post",
    title:       p.title || "",
    body:        p.selftext ? p.selftext.slice(0, 300) : null,
    score:       p.score ?? 0,
    comments:    p.num_comments ?? 0,
    url:         p.url || `https://reddit.com${p.permalink || ""}`,
    author:      p.author || "[deleted]",
    subreddit:   p.subreddit || "",
    created_utc: epochToISO(p.created_utc),
    permalink:   p.permalink ? `https://reddit.com${p.permalink}` : null,
  }));
}

async function searchComments(q, subreddit, sort, limit) {
  const params = new URLSearchParams({ q, size: String(limit), sort: "desc", sort_type: sort });
  if (subreddit) params.set("subreddit", subreddit);
  const url = `${PULLPUSH_COMMENT}?${params}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`PullPush comments HTTP ${res.status}`);
  const json = await res.json();
  return (json.data || []).map(c => ({
    type:        "comment",
    title:       null,
    body:        c.body ? c.body.slice(0, 500) : "",
    score:       c.score ?? 0,
    comments:    null,
    url:         c.permalink ? `https://reddit.com${c.permalink}` : null,
    author:      c.author || "[deleted]",
    subreddit:   c.subreddit || "",
    created_utc: epochToISO(c.created_utc),
    permalink:   c.permalink ? `https://reddit.com${c.permalink}` : null,
  }));
}

export default {
  name: "reddit-intel",
  price: "$0.020",

  description:
    "Searches Reddit posts and/or comments by keyword. Returns top results with score, comment count, author, subreddit, URL, and timestamp. Filter by subreddit, sort by score or date. Supports separate post and comment search. Sourced from PullPush public API — no auth required. Ideal for competitive sentiment analysis, trend detection, and community research.",

  inputSchema: {
    type: "object",
    properties: {
      q: {
        type: "string",
        description: "Search query. Supports quoted phrases (e.g. \"AI agents\") and boolean operators.",
      },
      subreddit: {
        type: "string",
        description: "Restrict search to this subreddit (omit 'r/' prefix). Omit for all subreddits.",
      },
      mode: {
        type: "string",
        enum: ["posts", "comments", "both"],
        description: "What to search: 'posts' (default), 'comments', or 'both'.",
      },
      sort: {
        type: "string",
        enum: ["score", "created_utc", "num_comments"],
        description: "Sort field. Default: score.",
      },
      limit: {
        type: "integer",
        description: "Max results per mode (1–25). Default: 10.",
        minimum: 1,
        maximum: 25,
      },
    },
    required: ["q"],
  },

  outputSchema: {
    type: "object",
    properties: {
      query:   { type: "string" },
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type:        { type: "string",          description: "post or comment" },
            title:       { type: ["string", "null"] },
            body:        { type: ["string", "null"] },
            score:       { type: "integer" },
            comments:    { type: ["integer", "null"] },
            url:         { type: ["string", "null"] },
            author:      { type: "string" },
            subreddit:   { type: "string" },
            created_utc: { type: ["string", "null"] },
            permalink:   { type: ["string", "null"] },
          },
        },
      },
      total:   { type: "integer" },
      ts:      { type: "string" },
    },
  },

  async handler(query) {
    const q         = (query.q || "").trim();
    if (!q) throw new Error("q is required");
    const subreddit = (query.subreddit || "").trim();
    const mode      = query.mode || "posts";
    const sort      = query.sort || "score";
    const limit     = Math.min(25, Math.max(1, parseInt(query.limit ?? 10, 10) || 10));

    let results = [];

    if (mode === "posts" || mode === "both") {
      const posts = await searchPosts(q, subreddit, sort, limit);
      results = results.concat(posts);
    }
    if (mode === "comments" || mode === "both") {
      const comments = await searchComments(q, subreddit, sort, limit);
      results = results.concat(comments);
    }

    // If both, sort combined by score desc
    if (mode === "both") {
      results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    return {
      query:   q,
      results,
      total:   results.length,
      ts:      new Date().toISOString(),
    };
  },
};
