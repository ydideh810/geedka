// social-intel.js
//
// Public social media profile intelligence — returns name, bio, follower counts,
// and activity stats for profiles on GitHub, Reddit, Hacker News, and Twitter/X.
//
// Seam: orbisapi.com/proxy/web-scrape-social-api-eeb761 — 4,502 sett/wk,
// ~26 payers, $0.005/call. STALL prices at $0.004 (20% undercut).
// All upstreams are free public APIs — zero per-call cost.
//
// Input: provide a profile URL (platform auto-detected) OR platform + username.
// Supported platforms: github, reddit, hackernews, twitter, npm

const UA      = "Mozilla/5.0 (compatible; myriad/3.75; +https://synaptiic.org)";
const TIMEOUT = 12_000;

// ── URL-based platform detection ─────────────────────────────────────────────

function detectPlatform(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "github.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      return parts[0] ? { platform: "github", username: parts[0] } : null;
    }
    if (host === "reddit.com" || host === "old.reddit.com") {
      const m = u.pathname.match(/^\/(?:u|user)\/([^/]+)/);
      return m ? { platform: "reddit", username: m[1] } : null;
    }
    if (host === "news.ycombinator.com") {
      const id = u.searchParams.get("id");
      return id ? { platform: "hackernews", username: id } : null;
    }
    if (host === "twitter.com" || host === "x.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      return parts[0] && !parts[0].startsWith("@") ? { platform: "twitter", username: parts[0] } : null;
    }
    if (host === "npmjs.com") {
      const m = u.pathname.match(/^\/~([^/]+)/);
      return m ? { platform: "npm", username: m[1] } : null;
    }
    return { platform: "opengraph", url };
  } catch {
    return null;
  }
}

// ── Platform fetchers ─────────────────────────────────────────────────────────

async function fetchGitHub(username) {
  const r = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers: { "User-Agent": UA, Accept: "application/vnd.github.v3+json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (r.status === 404) throw new Error(`GitHub user '${username}' not found`);
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  const d = await r.json();
  return {
    platform: "github",
    username:   d.login,
    name:       d.name || null,
    bio:        d.bio  || null,
    location:   d.location || null,
    company:    d.company  || null,
    blog:       d.blog     || null,
    avatar_url: d.avatar_url,
    profile_url: d.html_url,
    followers:  d.followers,
    following:  d.following,
    public_repos: d.public_repos,
    public_gists: d.public_gists,
    hireable:   d.hireable || false,
    account_type: d.type,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

async function fetchReddit(username) {
  // Reddit's public JSON API (about.json) blocks anonymous requests (403) since 2023.
  // Return Open Graph metadata from the profile page as a best-effort fallback.
  const url = `https://www.reddit.com/user/${encodeURIComponent(username)}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: "follow",
  });
  if (r.status === 404) throw new Error(`Reddit user '${username}' not found`);
  const html = await r.text();
  const title = parseMetaTag(html, "og:title") || parseMetaTag(html, "twitter:title");
  const desc  = parseMetaTag(html, "og:description") || parseMetaTag(html, "twitter:description");
  const img   = parseMetaTag(html, "og:image") || parseMetaTag(html, "twitter:image");
  // Attempt to parse karma from description if Reddit surfaces it
  let karma = null;
  if (desc) {
    const m = desc.match(/([\d,]+)\s+karma/i);
    if (m) karma = parseInt(m[1].replace(/,/g, ""), 10);
  }
  return {
    platform:    "reddit",
    username,
    profile_url: url,
    name:        title || null,
    bio:         desc  || null,
    avatar_url:  img   || null,
    karma,
    note: "Reddit JSON API requires OAuth; data scraped from public profile page metadata.",
  };
}

async function fetchHackerNews(username) {
  const r = await fetch(`https://hn.algolia.com/api/v1/users/${encodeURIComponent(username)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (r.status === 404) throw new Error(`HackerNews user '${username}' not found`);
  if (!r.ok) throw new Error(`HN Algolia API ${r.status}`);
  const d = await r.json();
  const about = (d.about || "").replace(/<[^>]+>/g, "").trim();
  return {
    platform:    "hackernews",
    username:    d.username,
    bio:         about || null,
    profile_url: `https://news.ycombinator.com/user?id=${d.username}`,
    karma:       d.karma,
    created_at:  d.created_at,
    avg_words_per_comment: d.avg_words_per_comment ?? null,
  };
}

async function fetchNpm(username) {
  // npm registry user endpoint requires auth; fall back to package search for maintainer stats
  const r = await fetch(`https://registry.npmjs.org/-/v1/search?text=maintainer:${encodeURIComponent(username)}&size=1`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`npm search API ${r.status}`);
  const d = await r.json();
  const total = d.total ?? 0;
  const latest = d.objects?.[0]?.package ?? null;
  return {
    platform:    "npm",
    username,
    profile_url: `https://www.npmjs.com/~${username}`,
    public_packages: total,
    latest_package:  latest ? latest.name    : null,
    latest_version:  latest ? latest.version : null,
    latest_date:     latest ? latest.date    : null,
    note: "Profile data limited to public package count — npm user API requires authentication.",
  };
}

function parseMetaTag(html, name) {
  // og:X or name=X or property=X
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim();
  }
  return null;
}

async function fetchTwitter(username) {
  // Twitter's og:description sometimes includes follower/following counts.
  // Direct page fetches are often blocked or JS-rendered; treat as best-effort.
  const url = `https://twitter.com/${encodeURIComponent(username)}`;
  let html = "";
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(8_000),
      redirect: "follow",
    });
    html = await r.text();
  } catch {
    // Timeout or block — return partial object
    return { platform: "twitter", username, profile_url: `https://x.com/${username}`, note: "Twitter page unavailable or bot-blocked; no metadata returned." };
  }

  const name    = parseMetaTag(html, "og:title") || parseMetaTag(html, "twitter:title");
  const desc    = parseMetaTag(html, "og:description") || parseMetaTag(html, "twitter:description");
  const avatar  = parseMetaTag(html, "og:image") || parseMetaTag(html, "twitter:image");

  // Twitter's og:description often has: "X Followers, Y Following, Z Likes. Joined ..."
  let followers = null, following = null, tweets = null;
  if (desc) {
    const fm = desc.match(/([\d,]+)\s+Followers/i);
    const gm = desc.match(/([\d,]+)\s+Following/i);
    const tm = desc.match(/([\d,]+)\s+(?:Tweets|Posts)/i);
    if (fm) followers = parseInt(fm[1].replace(/,/g, ""), 10);
    if (gm) following = parseInt(gm[1].replace(/,/g, ""), 10);
    if (tm) tweets    = parseInt(tm[1].replace(/,/g, ""), 10);
  }

  return {
    platform:    "twitter",
    username,
    name:        name || null,
    bio:         desc || null,
    avatar_url:  avatar || null,
    profile_url: `https://x.com/${username}`,
    followers,
    following,
    tweet_count: tweets,
    note: "Stats scraped from public page metadata; some values may be absent if Twitter obfuscates them.",
  };
}

async function fetchOpenGraph(targetUrl) {
  const r = await fetch(targetUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT),
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`Fetch ${r.status} from ${targetUrl}`);
  const html = await r.text();
  return {
    platform:    "opengraph",
    profile_url: targetUrl,
    title:       parseMetaTag(html, "og:title")       || parseMetaTag(html, "twitter:title"),
    description: parseMetaTag(html, "og:description") || parseMetaTag(html, "twitter:description"),
    image:       parseMetaTag(html, "og:image")       || parseMetaTag(html, "twitter:image"),
    site_name:   parseMetaTag(html, "og:site_name"),
    og_type:     parseMetaTag(html, "og:type"),
    canonical:   parseMetaTag(html, "canonical") || parseMetaTag(html, "og:url") || targetUrl,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export default {
  name: "social-intel",
  price: "$0.059",

  description:
    "Returns public profile data for any social platform account. Pass a profile URL (platform auto-detected) or platform + username. Supports GitHub, Reddit, HackerNews, Twitter/X, npm, and Open Graph fallback for any URL. Returns name, bio, follower/karma counts, creation date, and platform-specific metrics. Priced at $0.004 — 20% below comparable endpoints.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Full profile URL. Platform auto-detected from hostname. Use this OR platform+username.",
      },
      platform: {
        type: "string",
        enum: ["github", "reddit", "hackernews", "twitter", "npm", "opengraph"],
        description: "Platform to query. Required when username is provided without a URL.",
      },
      username: {
        type: "string",
        description: "Username on the target platform (no @ prefix needed).",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      platform:    { type: "string",  description: "Resolved platform name." },
      username:    { type: "string",  description: "Canonical username." },
      name:        { type: "string",  description: "Display name." },
      bio:         { type: "string",  description: "Profile bio or description." },
      avatar_url:  { type: "string",  description: "Profile image URL." },
      profile_url: { type: "string",  description: "Canonical URL of the profile." },
      followers:   { type: "integer", description: "Follower count (platform-dependent)." },
      created_at:  { type: "string",  description: "ISO-8601 account creation timestamp." },
    },
  },

  async handler(query) {
    let platform = (query.platform || "").toLowerCase().trim();
    let username  = (query.username || "").trim().replace(/^@/, "");
    let targetUrl = (query.url     || "").trim();

    // Resolve from URL if provided
    if (targetUrl && !platform) {
      const detected = detectPlatform(targetUrl);
      if (!detected) throw new Error("Could not detect platform from URL; pass platform+username explicitly");
      platform  = detected.platform;
      username  = detected.username || "";
      targetUrl = detected.url || targetUrl;
    }

    if (!platform) throw new Error("Provide 'url' or 'platform' + 'username'");

    switch (platform) {
      case "github":      return await fetchGitHub(username);
      case "reddit":      return await fetchReddit(username);
      case "hackernews":  return await fetchHackerNews(username);
      case "twitter":     return await fetchTwitter(username);
      case "npm":         return await fetchNpm(username);
      case "opengraph":   return await fetchOpenGraph(targetUrl || query.url);
      default:            throw new Error(`Unknown platform '${platform}'. Use github, reddit, hackernews, twitter, npm, or opengraph`);
    }
  },
};
