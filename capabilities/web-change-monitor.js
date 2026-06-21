// web-change-monitor.js
//
// Returns content-change signals for any public URL: ETag, Last-Modified,
// Content-Length, and Content-Type via HTTP HEAD. If the server returns no
// cache markers (no ETag, no Last-Modified), falls back to GET and returns a
// SHA-256 hash of the first 32 KB of the response body.
//
// Use case: agent stores the snapshot, re-calls on each polling interval, and
// compares returned fields to detect when a page has changed. Fully stateless —
// no server-side state stored. Caller owns the previous snapshot.
//
// Seam origin: orbisapi.com/proxy/web-change-monitor-api (1,583 settlements/wk,
// 14 payers, avg $0.005/call). Surfaced by [REDACTED]4, 2026-06-06.

const UA         = "Mozilla/5.0 (compatible; the-stall/0.4; +https://intuitek.ai)";
const HASH_LIMIT = 32 * 1024; // 32 KB

export default {
  name: "web-change-monitor",
  price: "$0.039",

  description:
    "Returns content-change signals for any public URL: ETag, Last-Modified, Content-Length, and Content-Type via HTTP HEAD. Falls back to GET + SHA-256 of the first 32 KB when the server returns no cache markers. Store the snapshot and re-call periodically to detect changes. Useful for monitoring competitor pricing, news, regulatory filings, or any public page.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "HTTPS or HTTP URL to poll. Must be a publicly accessible endpoint.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      url:            { type: "string",            description: "URL as passed." },
      status_code:    { type: "integer",           description: "HTTP status code returned by the server." },
      etag:           { type: ["string", "null"],  description: "ETag header value if returned by the server." },
      last_modified:  { type: ["string", "null"],  description: "Last-Modified header value if returned by the server." },
      content_length: { type: ["integer", "null"], description: "Content-Length in bytes, if present." },
      content_type:   { type: ["string", "null"],  description: "Content-Type header, if present." },
      content_hash:   { type: ["string", "null"],  description: "SHA-256 hex of first 32 KB of body — only populated when ETag and Last-Modified are both absent." },
      method_used:    { type: "string",            description: "\"HEAD\" (preferred) or \"GET\" (fallback when HEAD yields no change markers)." },
      ts:             { type: "string",            description: "ISO-8601 timestamp of this check." },
    },
  },

  async handler(query) {
    const raw = (query.url || "https://example.com").trim();

    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error("invalid URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("only http:// and https:// URLs are supported");
    }

    // --- HEAD pass ---
    let headResp;
    try {
      headResp = await fetch(raw, {
        method: "HEAD",
        headers: { "User-Agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new Error(`HEAD request failed: ${err.message}`);
    }

    const etag         = headResp.headers.get("etag")           || null;
    const lastModified = headResp.headers.get("last-modified")  || null;
    const rawLength    = headResp.headers.get("content-length");
    const contentLen   = rawLength !== null ? parseInt(rawLength, 10) : null;
    const contentType  = headResp.headers.get("content-type")   || null;

    if (etag || lastModified) {
      return {
        url:            raw,
        status_code:    headResp.status,
        etag,
        last_modified:  lastModified,
        content_length: contentLen,
        content_type:   contentType,
        content_hash:   null,
        method_used:    "HEAD",
        ts:             new Date().toISOString(),
      };
    }

    // --- GET fallback: hash first 32 KB ---
    let getResp;
    try {
      getResp = await fetch(raw, {
        method: "GET",
        headers: { "User-Agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`GET fallback failed: ${err.message}`);
    }

    const buf   = await getResp.arrayBuffer();
    const slice = buf.byteLength > HASH_LIMIT ? buf.slice(0, HASH_LIMIT) : buf;
    const hash  = await crypto.subtle.digest("SHA-256", slice);
    const hex   = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    const rawLen2  = getResp.headers.get("content-length");
    const bodySize = rawLen2 !== null ? parseInt(rawLen2, 10) : buf.byteLength;

    return {
      url:            raw,
      status_code:    getResp.status,
      etag:           getResp.headers.get("etag")           || null,
      last_modified:  getResp.headers.get("last-modified")  || null,
      content_length: bodySize,
      content_type:   getResp.headers.get("content-type")   || null,
      content_hash:   hex,
      method_used:    "GET",
      ts:             new Date().toISOString(),
    };
  },
};
