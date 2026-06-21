// web-scrape-links.js
//
// Extracts all hyperlinks from any public webpage. Returns href URLs normalized
// to absolute URLs and visible link text. Useful for crawlers, sitemap
// builders, link graph analysis, and content auditing.
//
// Seam: orbisapi.com/proxy/web-scrape-links-api (1,532 calls/wk, 26 payers,
// avg $0.005/call). [REDACTED]5, 2026-06-06.
//
// Upstream: native fetch + regex — zero external cost, no API key.
// 20% undercut vs. seam.

const UA       = "Mozilla/5.0 (compatible; the-stall/3.45; +https://intuitek.ai)";
const MAX_BYTES = 512 * 1024; // 512 KB cap
const TIMEOUT   = 15_000;

function normalizeHref(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}

function innerText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default {
  name: "web-scrape-links",
  price: "$0.039",

  description:
    "Extracts all hyperlinks from any public webpage. Returns href URLs normalized to absolute URLs with visible link text. Filters out javascript:, mailto:, data: schemes. Optionally restrict to same-domain links, deduplicate, or include #anchor links. Useful for crawlers, sitemap builders, link graph analysis, and content audits.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "URL of the webpage to extract links from (http or https).",
      },
      same_domain_only: {
        type: "string",
        description: "Pass \"true\" to return only links pointing to the same domain as the input URL. Default: false.",
      },
      include_anchors: {
        type: "string",
        description: "Pass \"true\" to include anchor-only links (#section). Default: false.",
      },
      deduplicate: {
        type: "string",
        description: "Pass \"false\" to allow duplicate hrefs. Default: true (each unique URL returned once).",
      },
      limit: {
        type: "integer",
        description: "Maximum links to return (default 200, max 500).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      url:         { type: "string",  description: "Input URL." },
      final_url:   { type: "string",  description: "URL after redirects." },
      domain:      { type: "string",  description: "Hostname of the input URL." },
      total_found: { type: "integer", description: "Total distinct links extracted before limit." },
      returned:    { type: "integer", description: "Links returned in this response." },
      truncated:   { type: "boolean", description: "True if page body was capped at 512 KB." },
      links: {
        type: "array",
        description: "Extracted links.",
        items: {
          type: "object",
          properties: {
            href:   { type: "string", description: "Absolute URL." },
            text:   { type: "string", description: "Visible link text (stripped of HTML tags)." },
            scheme: { type: "string", description: "URL scheme: http or https." },
          },
        },
      },
      ts: { type: "string", description: "ISO-8601 timestamp." },
    },
  },

  async handler(query) {
    const raw = (query.url || "https://example.com").trim();

    let base;
    try { base = new URL(raw); } catch { throw new Error(`invalid URL: ${raw}`); }
    if (!["http:", "https:"].includes(base.protocol)) {
      throw new Error("only http:// and https:// URLs are supported");
    }

    const sameDomainOnly = query.same_domain_only === "true" || query.same_domain_only === true;
    const includeAnchors = query.include_anchors   === "true" || query.include_anchors   === true;
    const deduplicate    = query.deduplicate !== "false" && query.deduplicate !== false;
    const limit          = Math.min(Math.max(1, parseInt(query.limit) || 200), 500);

    // --- fetch ---
    let resp;
    try {
      resp = await fetch(raw, {
        method:  "GET",
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        redirect: "follow",
        signal:  AbortSignal.timeout(TIMEOUT),
      });
    } catch (err) {
      throw new Error(`fetch failed: ${err.message}`);
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${raw}`);

    const finalUrl = resp.url || raw;

    // --- stream body, cap at MAX_BYTES ---
    const reader = resp.body.getReader();
    const chunks = [];
    let total = 0;
    let bodyTruncated = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total >= MAX_BYTES) { reader.cancel(); bodyTruncated = true; break; }
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);

    // --- extract anchor tags ---
    // Two-step: (1) match <a ...> blocks, (2) pull href + inner content from each
    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    const hrefRe   = /\bhref\s*=\s*(?:"([^"]*?)"|'([^']*?)'|([^\s>]*))/i;

    const results = [];
    const seen    = new Set();
    let match;

    while ((match = anchorRe.exec(html)) !== null) {
      const attrs   = match[1] || "";
      const inner   = match[2] || "";
      const hrefM   = hrefRe.exec(attrs);
      if (!hrefM) continue;

      const rawHref = (hrefM[1] ?? hrefM[2] ?? hrefM[3] ?? "").trim();
      if (!rawHref) continue;

      // Skip non-navigational schemes
      if (/^(mailto:|tel:|javascript:|data:|ftp:)/i.test(rawHref)) continue;

      // Anchor-only
      if (rawHref.startsWith("#")) {
        if (!includeAnchors) continue;
        const text = innerText(inner).slice(0, 200);
        if (deduplicate && seen.has(rawHref)) continue;
        seen.add(rawHref);
        results.push({ href: rawHref, text, scheme: "anchor" });
        continue;
      }

      const absolute = normalizeHref(rawHref, finalUrl);
      if (!absolute) continue;

      let parsed;
      try { parsed = new URL(absolute); } catch { continue; }
      if (!["http:", "https:"].includes(parsed.protocol)) continue;
      if (sameDomainOnly && parsed.hostname !== base.hostname) continue;

      if (deduplicate && seen.has(absolute)) continue;
      seen.add(absolute);

      results.push({
        href:   absolute,
        text:   innerText(inner).slice(0, 200),
        scheme: parsed.protocol.replace(":", ""),
      });
    }

    const sliced = results.slice(0, limit);

    return {
      url:         raw,
      final_url:   finalUrl,
      domain:      base.hostname,
      total_found: results.length,
      returned:    sliced.length,
      truncated:   bodyTruncated,
      links:       sliced,
      ts:          new Date().toISOString(),
    };
  },
};
