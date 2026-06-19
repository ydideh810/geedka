// readable-content.js
//
// Extracts full readable text from any public URL as clean Markdown.
// Strips navigation, ads, footers, and boilerplate — returns the main article
// body ready for LLM ingestion, summarization, or analysis.
//
// Seam origin: api.exa.ai/contents (53 payers, 494 calls/14d, $0.0074/call),
// minifetch.com/api/v1/x402/extract/url-content ($0.0013/call),
// utilsforagents.com/v1/text/fetch-content ($0.003/call),
// win.oneshotagent.com/v1/tools/web-read ($0.016/call).
// Combined seam signal: agents paying 3–4 separate providers for the same
// full-text extraction primitive. [REDACTED]4, 2026-06-06.
//
// Upstream: jina.ai Reader API (r.jina.ai/{url}) — free, no auth, no key.
// Returns clean Markdown with title, published date, and full article body.
// Content is de-noised (nav, footer, ads stripped by Jina's Readability fork).
// Max response size capped at 128 KB to prevent oversized context windows.

const JINA_BASE  = "https://r.jina.ai";
const UA         = "Mozilla/5.0 (compatible; the-stall/3.41; +https://intuitek.ai)";
const TIMEOUT_MS = 20000;
const MAX_BYTES  = 128 * 1024;

async function fetchReadable(url, noCache) {
  const headers = {
    "User-Agent":  UA,
    Accept:        "text/markdown, text/plain",
    "X-Timeout":   "18",
  };
  if (noCache) headers["X-No-Cache"] = "true";

  const jinaUrl = `${JINA_BASE}/${url}`;
  const resp = await fetch(jinaUrl, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });

  if (!resp.ok) throw new Error(`Jina HTTP ${resp.status} for ${url}`);

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
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated: total >= MAX_BYTES };
}

function parseJinaResponse(raw) {
  // Jina prepends metadata lines: "Title: ...\n\nURL Source: ...\n\n..."
  const lines     = raw.split("\n");
  let title       = null;
  let urlSource   = null;
  let published   = null;
  let bodyStart   = 0;

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const line = lines[i].trim();
    if (line.startsWith("Title:"))        { title     = line.slice(6).trim() || null; bodyStart = i + 1; }
    if (line.startsWith("URL Source:"))   { urlSource = line.slice(11).trim() || null; bodyStart = i + 1; }
    if (line.startsWith("Published Time:")){ published = line.slice(15).trim() || null; bodyStart = i + 1; }
    if (line.startsWith("Warning:"))      { bodyStart = i + 1; }
    if (line.startsWith("Markdown Content:")) { bodyStart = i + 1; break; }
  }

  const body = lines.slice(bodyStart).join("\n").trim();
  return { title, url_source: urlSource, published, body };
}

export default {
  name: "readable-content",
  price: "$0.004",

  description:
    "Fetches any public URL and returns the full readable article text as clean Markdown, stripped of navigation, ads, and boilerplate. Returns title, published date (if available), and the complete body ready for LLM summarization, analysis, or RAG ingestion. A $0.004 alternative to exa.ai/contents ($0.007) and web-read ($0.016) for the same full-text extraction primitive.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public HTTP/HTTPS URL to extract readable content from. Redirects are followed.",
      },
      no_cache: {
        type: "boolean",
        description: "If true, forces a fresh fetch bypassing Jina's cache (default false).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      url:        { type: "string",           description: "Canonical URL as reported by the reader." },
      title:      { type: ["string", "null"], description: "Page/article title extracted by the reader." },
      published:  { type: ["string", "null"], description: "Published date/time string if detected in page metadata." },
      body:       { type: "string",           description: "Full readable content as Markdown. Stripped of nav, ads, footer, and boilerplate." },
      char_count: { type: "integer",          description: "Character count of the body text." },
      truncated:  { type: "boolean",          description: "True if response exceeded 128 KB and was cut. Rare for standard articles." },
      ts:         { type: "string",           description: "ISO-8601 timestamp of this extraction." },
    },
  },

  async handler(query) {
    const raw = (query.url || "https://example.com").trim();
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error("invalid URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("only http:// and https:// URLs are supported");
    }

    const noCache = Boolean(query.no_cache);
    const { text, truncated } = await fetchReadable(parsed.href, noCache);
    const { title, url_source, published, body } = parseJinaResponse(text);

    if (!body) throw new Error("no readable content extracted — page may require JavaScript or login");

    return {
      url:        url_source || parsed.href,
      title,
      published,
      body,
      char_count: body.length,
      truncated,
      ts: new Date().toISOString(),
    };
  },
};
