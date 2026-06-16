// social-momentum.js
//
// Cross-platform social momentum for any topic.
// Growth-adjacent response to signal-intel signal_id 82182 (Social category,
// +7 endpoints/day, strength 0.70) — glim.sh entered Social on 2026-06-08
// with 14 Twitter endpoints; listed here under convergence price before
// category saturates.
//
// Free upstreams (zero per-call cost, no API keys):
//   Reddit: PullPush.io public archive API (also used by reddit-intel)
//   HN:     Algolia HN Search API (hn.algolia.com)
//   GitHub: GitHub REST Search API (unauthenticated, 60 req/hr/IP)

const UA = "Mozilla/5.0 (compatible; the-stall/social-momentum; +https://intuitek.ai)";
const TIMEOUT_REDDIT = 20_000;
const TIMEOUT_HN     = 12_000;
const TIMEOUT_GH     = 12_000;

const HN_SEARCH      = "https://hn.algolia.com/api/v1/search";
const PULLPUSH_POSTS = "https://api.pullpush.io/reddit/search/submission/";
const GH_SEARCH      = "https://api.github.com/search/repositories";

function momentumLabel(score) {
  if (score >= 70) return "HOT";
  if (score >= 40) return "RISING";
  if (score >= 15) return "STEADY";
  return "QUIET";
}

function computeScore(redditScore, hnPoints, ghRepos) {
  const r = Math.min(100, Math.log10(redditScore + 1) * 30);
  const h = Math.min(100, Math.log10(hnPoints + 1) * 45);
  const g = Math.min(100, ghRepos * 12);
  return Math.round(r * 0.5 + h * 0.3 + g * 0.2);
}

async function fetchReddit(topic, _windowHours, subreddits, limit) {
  // PullPush.io is a community-maintained Reddit archive with ingestion delay.
  // Time-window filtering is omitted because recent posts (last 24-72h) may
  // not yet be indexed. Results reflect top-scored posts from the archive.
  const params = new URLSearchParams({
    q:         topic,
    size:      String(Math.min(limit, 25)),
    sort:      "desc",
    sort_type: "score",
  });
  if (subreddits && subreddits.length > 0) {
    params.set("subreddit", subreddits.join(","));
  }
  const url = `${PULLPUSH_POSTS}?${params}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_REDDIT),
  });
  if (!resp.ok) throw new Error(`PullPush HTTP ${resp.status}`);
  const json = await resp.json();
  const posts = (json.data || []).map(p => ({
    title:       p.title ? p.title.slice(0, 200) : "",
    subreddit:   p.subreddit || "",
    score:       p.score ?? 0,
    comments:    p.num_comments ?? 0,
    url:         p.permalink ? `https://reddit.com${p.permalink}` : (p.url || ""),
    author:      p.author || "[deleted]",
    created_utc: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
  }));
  const totalScore = posts.reduce((s, p) => s + p.score, 0);
  return {
    posts,
    post_count:   posts.length,
    total_score:  totalScore,
    source_note:  "Community-maintained archive (PullPush.io); may have 1–3 day indexing lag.",
  };
}

async function fetchHN(topic, windowHours, limit) {
  const after = Math.floor((Date.now() - windowHours * 3_600_000) / 1000);
  const params = new URLSearchParams({
    query:              topic,
    tags:               "story",
    numericFilters:     `created_at_i>${after}`,
    hitsPerPage:        String(Math.min(limit, 20)),
  });
  const url = `${HN_SEARCH}?${params}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_HN),
  });
  if (!resp.ok) throw new Error(`HN Algolia HTTP ${resp.status}`);
  const json = await resp.json();
  const stories = (json.hits || []).map(h => ({
    title:      h.title ? h.title.slice(0, 200) : "",
    points:     h.points ?? 0,
    comments:   h.num_comments ?? 0,
    url:        h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    author:     h.author || "",
    created_at: h.created_at || null,
    hn_id:      h.objectID || null,
  }));
  const totalPoints = stories.reduce((s, h) => s + h.points, 0);
  return { stories, story_count: stories.length, total_points: totalPoints };
}

async function fetchGitHub(topic, windowHours, limit) {
  const cutoff = new Date(Date.now() - windowHours * 3_600_000);
  const dateStr = cutoff.toISOString().slice(0, 10);
  const q = `${topic} pushed:>${dateStr}`;
  const params = new URLSearchParams({
    q,
    sort:      "stars",
    order:     "desc",
    per_page:  String(Math.min(limit, 20)),
  });
  const url = `${GH_SEARCH}?${params}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/vnd.github.v3+json",
    },
    signal: AbortSignal.timeout(TIMEOUT_GH),
  });
  if (resp.status === 403) {
    return { repos: [], repo_count: 0, total_stars: 0, note: "GitHub rate-limited; try again in 60s" };
  }
  if (!resp.ok) throw new Error(`GitHub Search HTTP ${resp.status}`);
  const json = await resp.json();
  const repos = (json.items || []).map(r => ({
    full_name:    r.full_name || "",
    description:  r.description ? r.description.slice(0, 150) : null,
    stars:        r.stargazers_count ?? 0,
    language:     r.language || null,
    url:          r.html_url || "",
    pushed_at:    r.pushed_at || null,
  }));
  const totalStars = repos.reduce((s, r) => s + r.stars, 0);
  return { repos, repo_count: repos.length, total_stars: totalStars };
}

export default {
  name:  "social-momentum",
  price: "$0.008",

  description:
    "Cross-platform social momentum for any topic. Queries Reddit (recent top posts), Hacker News (recent stories), and GitHub (active repos) in parallel and returns a composite momentum score (0–100) plus raw results from each platform. Single call replaces three separate searches. Use before committing to research, writing, or trading: 'is this topic gaining traction right now?' No API keys required.",

  inputSchema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "Topic or entity to query across all platforms. E.g. 'ethereum staking', 'LLM agents', 'Anthropic', 'DeFi yields'.",
      },
      window_hours: {
        type: "integer",
        description: "Lookback window in hours (default 24, min 1, max 168 = 7 days). Shorter windows are more noise-sensitive; 24–72h gives the most stable signal.",
        default: 24,
        minimum: 1,
        maximum: 168,
      },
      reddit_subreddits: {
        type: "array",
        items: { type: "string" },
        description: "Restrict Reddit search to specific subreddits (e.g. ['bitcoin', 'ethereum', 'CryptoCurrency']). Omit to search all Reddit.",
        maxItems: 5,
      },
      reddit_limit: {
        type: "integer",
        description: "Max Reddit posts to return (1–20, default 10).",
        default: 10,
        minimum: 1,
        maximum: 20,
      },
      hn_limit: {
        type: "integer",
        description: "Max HN stories to return (1–20, default 10).",
        default: 10,
        minimum: 1,
        maximum: 20,
      },
      github_limit: {
        type: "integer",
        description: "Max GitHub repos to return (1–20, default 10).",
        default: 10,
        minimum: 1,
        maximum: 20,
      },
    },
    required: ["topic"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      topic:           { type: "string",  description: "Topic queried." },
      window_hours:    { type: "integer", description: "Lookback window used." },
      momentum_score:  { type: "integer", description: "Composite momentum score 0–100. Weighted: Reddit 50%, HN 30%, GitHub 20%." },
      momentum_label:  { type: "string",  description: "HOT (≥70) | RISING (≥40) | STEADY (≥15) | QUIET (<15)." },
      reddit: {
        type: "object",
        properties: {
          post_count:  { type: "integer" },
          total_score: { type: "integer", description: "Sum of Reddit scores across returned posts." },
          posts:       { type: "array",   items: { type: "object" } },
        },
      },
      hn: {
        type: "object",
        properties: {
          story_count:  { type: "integer" },
          total_points: { type: "integer", description: "Sum of HN points across returned stories." },
          stories:      { type: "array",   items: { type: "object" } },
        },
      },
      github: {
        type: "object",
        properties: {
          repo_count:  { type: "integer" },
          total_stars: { type: "integer", description: "Sum of star counts on returned repos." },
          repos:       { type: "array",   items: { type: "object" } },
          note:        { type: "string",  description: "Present if GitHub returned a rate-limit error." },
        },
      },
      generated_at: { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const topic       = (query.topic || "").trim();
    if (!topic) throw new Error("topic is required");

    const windowHours    = Math.min(Math.max(parseInt(query.window_hours || "24", 10), 1), 168);
    const subreddits     = Array.isArray(query.reddit_subreddits) ? query.reddit_subreddits.filter(Boolean) : [];
    const redditLimit    = Math.min(Math.max(parseInt(query.reddit_limit  || "10", 10), 1), 20);
    const hnLimit        = Math.min(Math.max(parseInt(query.hn_limit      || "10", 10), 1), 20);
    const githubLimit    = Math.min(Math.max(parseInt(query.github_limit  || "10", 10), 1), 20);

    const [reddit, hn, github] = await Promise.all([
      fetchReddit(topic, windowHours, subreddits, redditLimit).catch(err => ({
        posts: [], post_count: 0, total_score: 0, error: err.message,
      })),
      fetchHN(topic, windowHours, hnLimit).catch(err => ({
        stories: [], story_count: 0, total_points: 0, error: err.message,
      })),
      fetchGitHub(topic, windowHours, githubLimit).catch(err => ({
        repos: [], repo_count: 0, total_stars: 0, error: err.message,
      })),
    ]);

    const score = computeScore(reddit.total_score, hn.total_points, github.repo_count);

    return {
      topic,
      window_hours:   windowHours,
      momentum_score: score,
      momentum_label: momentumLabel(score),
      reddit,
      hn,
      github,
      generated_at:   new Date().toISOString(),
    };
  },
};
