// page-intel.js
//
// Web page content intelligence: extracts title, meta description, headings,
// links, and a text preview from any public URL. Useful for research agents
// that need to understand page structure before parsing, or that follow link
// chains discovered in on-chain data (NFT metadata URIs, IPFS gateways, etc.).
//
// Seam origin: orbisapi.com/proxy/web-scrape-links-api-4e3ed0, observed in
// agent chains: onesource.io/chain/block → web-scrape-links → text-generation
// (6-7 distinct wallets, 5-6 days, [REDACTED]4, 2026-06-06).
//
// Free upstream: native Node.js fetch. No auth, no rate limit from our side.

const UA         = "Mozilla/5.0 (compatible; the-stall/3.9; +https://intuitek.ai)";
const TIMEOUT_MS = 12000;
const MAX_BYTES  = 256 * 1024; // read at most 256 KB of the page

async function fetchPage(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);

  const ct = resp.headers.get("content-type") || "";
  if (!ct.includes("html") && !ct.includes("text") && !ct.includes("xml")) {
    throw new Error(`non-HTML content-type: ${ct}`);
  }

  // Read limited bytes to avoid huge pages
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= MAX_BYTES) { reader.cancel(); break; }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { buf.set(c, offset); offset += c.length; }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

function extract(html, url, limit) {
  // Strip script/style blocks to reduce noise
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  // Title
  const titleM = clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title  = titleM ? titleM[1].replace(/\s+/g, " ").trim() : null;

  // Meta description
  const metaM = clean.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i)
             || clean.match(/<meta[^>]+content=["']([^"']{0,500})["'][^>]+name=["']description["']/i);
  const description = metaM ? metaM[1].trim() : null;

  // Headings h1-h3
  const headings = [];
  const headRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let hm;
  while ((hm = headRe.exec(clean)) !== null && headings.length < 10) {
    const text = hm[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) headings.push({ level: parseInt(hm[1], 10), text });
  }

  // Links
  const base = (() => { try { return new URL(url); } catch { return null; } })();
  const links = [];
  const linkRe = /<a[^>]+href=["']([^"'#\s]{1,2048})["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seen   = new Set();
  let lm;
  while ((lm = linkRe.exec(clean)) !== null && links.length < limit) {
    const rawHref = lm[1].trim();
    const text    = lm[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!rawHref || rawHref.startsWith("javascript:") || rawHref.startsWith("mailto:")) continue;
    let href;
    try {
      href = new URL(rawHref, base || undefined).href;
    } catch {
      href = rawHref;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    const internal = base ? href.startsWith(base.origin) : false;
    links.push({ href, text: text || null, internal });
  }

  // Text preview (first ~500 chars of visible text)
  const stripped = clean.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const preview  = stripped.slice(0, 500) || null;

  return { title, description, headings, links, text_preview: preview };
}

export default {
  name: "page-intel",
  price: "$0.039",

  description:
    "Extracts structured content from any public URL: page title, meta description, H1-H3 headings, all links (with text and internal/external flag), and a 500-character text preview. Useful for research agents following link chains from on-chain data, auditing page structure, or seeding downstream text-generation calls.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public HTTP/HTTPS URL to fetch. Redirects are followed. Max 256 KB of response read.",
      },
      link_limit: {
        type: "integer",
        description: "Maximum number of links to return (default 50, max 200).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      url:          { type: "string",              description: "Canonical URL fetched (after redirects)." },
      title:        { type: ["string", "null"],    description: "Page <title> text." },
      description:  { type: ["string", "null"],    description: "Meta description content." },
      headings:     { type: "array",               description: "H1-H3 headings found on the page, in order." },
      links:        { type: "array",               description: "Links extracted from <a href> elements." },
      text_preview: { type: ["string", "null"],    description: "First 500 chars of visible page text." },
      link_count:   { type: "integer",             description: "Total links returned (capped at link_limit)." },
      truncated:    { type: "boolean",             description: "True if the page body was truncated at 256 KB before link extraction completed." },
      ts:           { type: "string",              description: "ISO-8601 timestamp of this fetch." },
    },
  },

  async handler(query) {
    const raw = (query.url || "https://example.com").trim();
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error("invalid URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("only http:// and https:// URLs are supported");
    }

    const limit = Math.min(Math.max(1, parseInt(query.link_limit, 10) || 50), 200);

    const html = await fetchPage(parsed.href);
    const truncated = html.length >= MAX_BYTES;

    const result = extract(html, parsed.href, limit);

    return {
      url:          parsed.href,
      title:        result.title,
      description:  result.description,
      headings:     result.headings,
      links:        result.links,
      text_preview: result.text_preview,
      link_count:   result.links.length,
      truncated,
      ts:           new Date().toISOString(),
    };
  },
};
