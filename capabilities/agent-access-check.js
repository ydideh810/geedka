// agent-access-check.js
//
// Checks whether a website is accessible and agent-friendly.
// Fetches robots.txt, .well-known/ai.txt, sitemap.xml, and HTTP headers to
// determine what an AI agent can and cannot do at a given domain.
//
// Seam: orbisapi.com/proxy/website-agent-access-readiness-api — 2,184 sett/wk, 14 payers, $0.005/call
//
// Upstream: native fetch against the target domain — no auth, free.

const TIMEOUT = 10000;

async function tryFetch(url) {
  try {
    const resp = await fetch(url, {
      method:  "GET",
      headers: { "User-Agent": "the-stall-agent/1.0 (https://intuitek.ai)" },
      signal:  AbortSignal.timeout(TIMEOUT),
      redirect: "follow",
    });
    const text = await resp.text().catch(() => "");
    return { ok: resp.ok, status: resp.status, text: text.slice(0, 2000), headers: Object.fromEntries(resp.headers) };
  } catch (e) {
    return { ok: false, status: null, text: null, headers: {}, error: e.message };
  }
}

function parseRobotsTxt(text, userAgent = "*") {
  if (!text) return { allowed: null, disallowed: [], crawl_delay: null };
  const lines    = text.split("\n").map(l => l.trim());
  let inBlock    = false;
  const disallowed = [];
  let crawl_delay  = null;
  let hasAiBlock   = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("user-agent:")) {
      const ua = line.split(":")[1]?.trim().toLowerCase();
      inBlock = (ua === "*" || ua === userAgent.toLowerCase());
      if (ua === "gptbot" || ua === "claudebot" || ua === "anthropic-ai" || ua === "chatgpt-user") {
        hasAiBlock = true;
      }
    } else if (inBlock && lower.startsWith("disallow:")) {
      const path = line.split(":")[1]?.trim();
      if (path) disallowed.push(path);
    } else if (inBlock && lower.startsWith("crawl-delay:")) {
      crawl_delay = parseFloat(line.split(":")[1]) || null;
    }
  }
  return {
    blocks_all:     disallowed.includes("/"),
    disallowed_paths: disallowed.slice(0, 20),
    crawl_delay,
    has_ai_specific_rules: hasAiBlock,
  };
}

function parseAiTxt(text) {
  if (!text) return null;
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const result = {};
  for (const line of lines) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) result[key.trim().toLowerCase()] = rest.join(":").trim();
  }
  return result;
}

export default {
  name: "agent-access-check",
  price: "$0.014",

  description:
    "Checks whether a website is accessible and agent-friendly. Fetches robots.txt, .well-known/ai.txt, and sitemap.xml; inspects HTTP headers (CORS, CSP, rate-limit); and returns a readiness verdict. Useful for agents that need to decide whether to scrape, crawl, or interact with a domain before committing to a workflow. Returns allowed/blocked status, disallowed paths, crawl delay, AI-specific rules, and sitemap URL if present.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Domain or URL to check. Can be a bare domain (example.com) or full URL (https://example.com/path).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      domain:           { type: "string" },
      reachable:        { type: "boolean" },
      http_status:      { type: "integer" },
      robots_txt:       { type: "object",  description: "Parsed robots.txt summary." },
      ai_txt:           { type: "object",  description: "Parsed .well-known/ai.txt if present." },
      has_sitemap:      { type: "boolean" },
      sitemap_url:      { type: "string"  },
      headers_intel:    { type: "object",  description: "Key HTTP headers relevant to agents." },
      agent_verdict:    { type: "string",  description: "'OPEN' | 'RESTRICTED' | 'BLOCKED' | 'UNREACHABLE'" },
      generated_at:     { type: "string" },
    },
  },

  async handler(query) {
    let rawUrl = (query.url || "https://intuitek.ai").trim();
    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
      rawUrl = "https://" + rawUrl;
    }

    const parsed = new URL(rawUrl);
    const base   = `${parsed.protocol}//${parsed.hostname}`;

    const [rootResp, robotsResp, aiTxtResp, sitemapResp] = await Promise.allSettled([
      tryFetch(base + "/"),
      tryFetch(base + "/robots.txt"),
      tryFetch(base + "/.well-known/ai.txt"),
      tryFetch(base + "/sitemap.xml"),
    ]);

    const root    = rootResp.status    === "fulfilled" ? rootResp.value    : { ok: false, status: null };
    const robots  = robotsResp.status  === "fulfilled" ? robotsResp.value  : { ok: false, text: null };
    const aiTxt   = aiTxtResp.status   === "fulfilled" ? aiTxtResp.value   : { ok: false, text: null };
    const sitemap = sitemapResp.status === "fulfilled" ? sitemapResp.value : { ok: false };

    const robotsParsed = parseRobotsTxt(robots.ok ? robots.text : null);
    const aiParsed     = aiTxt.ok ? parseAiTxt(aiTxt.text) : null;

    const headers = root.headers || {};
    const headersIntel = {
      cors_origin:         headers["access-control-allow-origin"] || null,
      content_security:    headers["content-security-policy"]?.slice(0, 200) || null,
      x_robots_tag:        headers["x-robots-tag"] || null,
      rate_limit_limit:    headers["x-ratelimit-limit"] || headers["ratelimit-limit"] || null,
      rate_limit_remaining: headers["x-ratelimit-remaining"] || headers["ratelimit-remaining"] || null,
      server:              headers["server"] || null,
    };

    let verdict = "OPEN";
    if (!root.ok && root.status === null) verdict = "UNREACHABLE";
    else if (robotsParsed.blocks_all)     verdict = "BLOCKED";
    else if (robotsParsed.disallowed_paths.length > 5 || robotsParsed.has_ai_specific_rules) verdict = "RESTRICTED";

    return {
      domain:        parsed.hostname,
      reachable:     root.ok,
      http_status:   root.status,
      robots_txt:    robots.ok ? robotsParsed : { available: false },
      ai_txt:        aiTxt.ok ? aiParsed : null,
      has_sitemap:   sitemap.ok,
      sitemap_url:   sitemap.ok ? base + "/sitemap.xml" : null,
      headers_intel: headersIntel,
      agent_verdict: verdict,
      generated_at:  new Date().toISOString(),
    };
  },
};
