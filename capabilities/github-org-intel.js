// github-org-intel.js
//
// Comprehensive GitHub organization intelligence — aggregates org profile,
// top repositories, tech stack, and recent activity in a single call.
//
// Complements github-repo-intel (single repo) with org-level views useful
// for due diligence, competitive analysis, and investment research.
//
// Input: org name or GitHub org URL.
// Output: metadata, top repos by stars, language distribution, activity signals.
//
// Upstream: GitHub public API (no auth, 60 req/hr anon, responses cached 1h).
// signal-intel gap: github-repo-intel has 0 org-level analog in MYRIAD.

const GH_API     = "https://api.github.com";
const UA         = "Mozilla/5.0 (compatible; myriad/4.41; +https://synaptiic.org)";
const TIMEOUT_MS = 12_000;
const CACHE_TTL  = 3_600_000; // 1 hour in ms

const cache = new Map(); // key → {ts, data}

function parseOrg(input) {
  const s = (input || "").trim();
  const m = s.match(/github\.com\/([^/\s]+)/i);
  if (m) return m[1].replace(/\/$/, "");
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(s)) return s;
  throw new Error(`Invalid GitHub org: "${input}" — provide org name or github.com URL`);
}

function cached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function store(key, data) {
  cache.set(key, { ts: Date.now(), data });
  return data;
}

async function gh(path) {
  const token = process.env.GITHUB_TOKEN;
  const headers = { "User-Agent": UA, Accept: "application/vnd.github+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(`${GH_API}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (r.status === 404) throw new Error(`GitHub: not found — ${path}`);
  if (r.status === 403) throw new Error("GitHub rate limit exceeded — retry in 1 hour");
  if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
  return r.json();
}

async function getOrgInfo(org) {
  const key = `org:${org}`;
  const hit = cached(key);
  if (hit) return hit;
  const d = await gh(`/orgs/${encodeURIComponent(org)}`);
  return store(key, d);
}

async function getTopRepos(org, limit = 10) {
  const key = `repos:${org}:${limit}`;
  const hit = cached(key);
  if (hit) return hit;
  // Use search API for accurate star-sorted results (org repos endpoint doesn't sort globally)
  const data = await gh(`/search/repositories?q=org:${encodeURIComponent(org)}&sort=stars&order=desc&per_page=${limit}`);
  return store(key, Array.isArray(data.items) ? data.items : []);
}

async function getMembers(org) {
  const key = `members:${org}`;
  const hit = cached(key);
  if (hit) return hit;
  try {
    const data = await gh(`/orgs/${encodeURIComponent(org)}/members?per_page=1`);
    // Just need the count — fetch actual count from org info link header
    return store(key, Array.isArray(data) ? data.length : 0);
  } catch {
    return store(key, null);
  }
}

function buildLangDist(repos) {
  const counts = {};
  for (const r of repos) {
    if (r.language) counts[r.language] = (counts[r.language] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([lang, n]) => ({ language: lang, repos: n }));
}

function activitySignal(repos) {
  const now = Date.now();
  const day = 86_400_000;
  let active30 = 0, active90 = 0, active365 = 0;
  let newestPush = null;
  for (const r of repos) {
    const ts = r.last_push || r.pushed_at;
    if (!ts) continue;
    const age = now - new Date(ts).getTime();
    if (age < 30 * day)  active30++;
    if (age < 90 * day)  active90++;
    if (age < 365 * day) active365++;
    if (!newestPush || ts > newestPush) newestPush = ts;
  }
  return { active_last_30d: active30, active_last_90d: active90, active_last_year: active365, latest_push: newestPush };
}

export default {
  name:  "github-org-intel",
  price: "$0.035",

  description:
    "Comprehensive GitHub organization intelligence. Returns org profile (members, followers, website, location), top public repositories by stars with activity and language data, tech stack distribution, and recent activity signals. Covers up to 25 top repos per call. Useful for due diligence, competitive analysis, investment research, and talent sourcing. Data cached 1 hour. Powered by GitHub public API.",

  inputSchema: {
    type: "object",
    properties: {
      org: {
        type: "string",
        description: "GitHub organization name (e.g. 'anthropics') or full org URL (e.g. 'https://github.com/anthropics').",
      },
      top_repos: {
        type: "integer",
        description: "Number of top repositories to include, sorted by stars. Default: 10, max: 25.",
        minimum: 1,
        maximum: 25,
        default: 10,
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      org:          { type: "string" },
      display_name: { type: ["string", "null"] },
      description:  { type: ["string", "null"] },
      website:      { type: ["string", "null"] },
      location:     { type: ["string", "null"] },
      email:        { type: ["string", "null"] },
      twitter:      { type: ["string", "null"] },
      public_repos: { type: "integer" },
      followers:    { type: "integer" },
      created:      { type: "string" },
      verified:     { type: "boolean" },
      top_repos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name:        { type: "string" },
            description: { type: ["string", "null"] },
            url:         { type: "string" },
            language:    { type: ["string", "null"] },
            stars:       { type: "integer" },
            forks:       { type: "integer" },
            open_issues: { type: "integer" },
            archived:    { type: "boolean" },
            topics:      { type: "array", items: { type: "string" } },
            last_push:   { type: ["string", "null"] },
            license:     { type: ["string", "null"] },
          },
        },
      },
      tech_stack:     { type: "array", items: { type: "object" } },
      activity:       { type: "object" },
      total_stars:    { type: "integer" },
      ts:             { type: "string" },
    },
  },

  async handler(query) {
    const orgRaw  = (query.org || "openai").trim();
    const org     = parseOrg(orgRaw);
    const topN    = Math.min(25, Math.max(1, parseInt(query.top_repos ?? 10, 10) || 10));

    const [info, repos] = await Promise.all([
      getOrgInfo(org),
      getTopRepos(org, topN),
    ]);

    const topRepos = (Array.isArray(repos) ? repos : []).map(r => ({
      name:        r.name,
      description: r.description || null,
      url:         r.html_url,
      language:    r.language || null,
      stars:       r.stargazers_count ?? 0,
      forks:       r.forks_count ?? 0,
      open_issues: r.open_issues_count ?? 0,
      archived:    Boolean(r.archived),
      topics:      Array.isArray(r.topics) ? r.topics : [],
      last_push:   r.pushed_at || null,
      license:     r.license?.spdx_id || null,
    }));

    const totalStars = topRepos.reduce((s, r) => s + r.stars, 0);

    return {
      org,
      display_name: info.name || null,
      description:  info.description || null,
      website:      info.blog || null,
      location:     info.location || null,
      email:        info.email || null,
      twitter:      info.twitter_username || null,
      public_repos: info.public_repos ?? 0,
      followers:    info.followers ?? 0,
      created:      info.created_at || null,
      verified:     Boolean(info.is_verified),
      top_repos:    topRepos,
      tech_stack:   buildLangDist(topRepos),
      activity:     activitySignal(topRepos),
      total_stars:  totalStars,
      ts:           new Date().toISOString(),
    };
  },
};
