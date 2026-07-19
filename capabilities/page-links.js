// page-links.js
//
// Extracts all hyperlinks from a webpage. Fetches the URL, parses every
// <a href> tag, resolves relative URLs to absolute, classifies each link
// as internal (same domain) or external, and returns structured results.
//
// Seam: orbisapi.com/proxy/web-scrape-links-api-4e3ed0 — $0.005/call,
//       signal_id 57541, strength 80%, 6 wallets × 5 days persistence.
// MYRIAD prices at $0.004 — 20% below competitor.
// Upstream: direct HTTP fetch — no API key, no cost.
//
// Distinct from web-scrape-links: adds filter (internal/external/all),
// is_external boolean per link, and per-link domain field.

const UA        = "Mozilla/5.0 (compatible; myriad/3.78; +https://synaptiic.org)";
const TIMEOUT   = 15_000;
const HARD_CAP  = 500;

// Handles quoted attributes (e.g. href="foo>bar") correctly.
const A_TAG_RE  = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a>/gi;
const HREF_RE   = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*))/i;
const TITLE_RE  = /<title[^>]*>([^<]*)<\/title>/i;

function stripTags(s) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function resolveHref(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function parseLinks(html, pageUrl) {
  const base    = new URL(pageUrl);
  const results = [];
  const seen    = new Set();

  let m;
  A_TAG_RE.lastIndex = 0;
  while ((m = A_TAG_RE.exec(html)) !== null && results.length < HARD_CAP) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const hm    = HREF_RE.exec(attrs);
    if (!hm) continue;

    const raw = (hm[1] ?? hm[2] ?? hm[3] ?? "").trim();
    if (!raw || raw === "#") continue;
    if (/^(javascript|tel):/i.test(raw)) continue;

    // mailto links pass through without resolution
    let href, domain, isExternal;
    if (/^mailto:/i.test(raw)) {
      href = raw;
      domain = null;
      isExternal = true;
    } else {
      href = resolveHref(raw, pageUrl);
      if (!href) continue;
      try {
        const u = new URL(href);
        if (u.protocol !== "http:" && u.protocol !== "https:") continue;
        domain     = u.hostname;
        isExternal = u.hostname !== base.hostname;
      } catch {
        continue;
      }
    }

    if (seen.has(href)) continue;
    seen.add(href);

    const text = stripTags(inner).slice(0, 200) || null;
    results.push({ href, text, is_external: isExternal, domain });
  }

  return results;
}

export default {
  name:  "page-links",
  price: "$0.034",

  description:
    "Extracts all hyperlinks from a webpage. Fetches the target URL, resolves relative links to absolute URLs, and classifies each as internal (same domain) or external. Filter by all/external/internal, cap results with limit. Returns page title, total link count before filtering, and a structured array of {href, text, is_external, domain}. Priced at $0.004 — 20% below orbisapi web-scrape-links ($0.005/call). Upstream: direct HTTP fetch, no API key.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Webpage URL to extract links from (http or https).",
      },
      filter: {
        type: "string",
        enum: ["all", "external", "internal"],
        description: "Which links to return: all (default), external-only (different domain), or internal-only (same domain).",
      },
      limit: {
        type: "integer",
        description: "Max links to return (1–200). Default: 100.",
        minimum: 1,
        maximum: 200,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      url:         { type: "string",          description: "Resolved URL that was fetched (after redirects)." },
      title:       { type: ["string", "null"], description: "Page <title> text." },
      total_found: { type: "integer",         description: "Total unique links found before filter/limit." },
      returned:    { type: "integer",         description: "Links in the links array." },
      filter:      { type: "string",          description: "Filter applied: all, external, or internal." },
      links: {
        type: "array",
        description: "Extracted hyperlinks.",
        items: {
          type: "object",
          properties: {
            href:        { type: "string",          description: "Absolute URL." },
            text:        { type: ["string", "null"], description: "Visible anchor text (HTML stripped, max 200 chars)." },
            is_external: { type: "boolean",         description: "True if the link points to a different domain." },
            domain:      { type: ["string", "null"], description: "Hostname of the link target." },
          },
        },
      },
      ts: { type: "string", description: "ISO-8601 response timestamp." },
    },
  },

  async handler(query) {
    const rawUrl = (query.url || "https://example.com").trim();

    let target;
    try {
      target = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    } catch {
      throw new Error(`invalid URL: ${rawUrl}`);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("only http and https URLs are supported");
    }

    const filter = (query.filter || "all").toLowerCase();
    if (!["all", "external", "internal"].includes(filter)) {
      throw new Error("filter must be all, external, or internal");
    }
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? 100, 10) || 100));

    const resp = await fetch(target.href, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "follow",
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${target.href}`);

    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("html") && !ct.includes("text")) {
      throw new Error(`URL returned ${ct} — expected HTML`);
    }

    const html     = await resp.text();
    const finalUrl = resp.url || target.href;
    const titleM   = TITLE_RE.exec(html);
    const title    = titleM ? titleM[1].trim() : null;

    const allLinks = parseLinks(html, finalUrl);

    const filtered =
      filter === "all"      ? allLinks :
      filter === "external" ? allLinks.filter(l => l.is_external) :
                              allLinks.filter(l => !l.is_external);

    const limited = filtered.slice(0, limit);

    return {
      url:         finalUrl,
      title,
      total_found: allLinks.length,
      returned:    limited.length,
      filter,
      links:       limited,
      ts:          new Date().toISOString(),
    };
  },
};
