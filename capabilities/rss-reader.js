// rss-reader.js
//
// RSS 2.0 and Atom 1.0 feed reader. Fetches any public feed URL and returns
// structured items: title, link, summary, author, published date, and GUID.
// Also returns feed-level metadata (title, description, language, updated).
//
// Useful for research agents monitoring news, blog posts, security advisories,
// GitHub release feeds, Reddit RSS exports, arXiv category feeds, or any other
// structured content stream.
//
// Free upstream: native Node.js fetch — no external API, no auth, no rate limit.

const UA         = "Mozilla/5.0 (compatible; the-stall/3.12; +https://intuitek.ai)";
const MAX_BYTES  = 512 * 1024;
const TIMEOUT_MS = 12000;

async function fetchFeed(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
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
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

// Extract text from a tag, handling CDATA
function tag(xml, name) {
  const re = new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, "i");
  const m = xml.match(re);
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;
}

function attr(xml, tag, attrName) {
  const re = new RegExp(`<${tag}[^>]+${attrName}=["']([^"']+)["']`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function parseRss(xml) {
  const channelM = xml.match(/<channel>([\s\S]*)/i);
  const channel  = channelM ? channelM[1] : xml;

  const feed = {
    title:       tag(channel, "title"),
    description: tag(channel, "description"),
    link:        tag(channel, "link"),
    language:    tag(channel, "language"),
    updated:     tag(channel, "lastBuildDate") || tag(channel, "pubDate"),
    format:      "rss",
  };

  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const i = m[1];
    items.push({
      title:     tag(i, "title"),
      link:      tag(i, "link") || attr(i, "link", "href"),
      summary:   tag(i, "description")?.slice(0, 400) || null,
      author:    tag(i, "author") || tag(i, "dc:creator"),
      published: tag(i, "pubDate"),
      guid:      tag(i, "guid"),
    });
  }
  return { feed, items };
}

function parseAtom(xml) {
  const feed = {
    title:       tag(xml, "title"),
    description: tag(xml, "subtitle"),
    link:        attr(xml, 'link rel="alternate"', "href") || attr(xml, "link", "href"),
    language:    null,
    updated:     tag(xml, "updated"),
    format:      "atom",
  };

  const items = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const link = attr(e, 'link rel="alternate"', "href") || attr(e, "link", "href");
    items.push({
      title:     tag(e, "title"),
      link:      link || tag(e, "id"),
      summary:   (tag(e, "summary") || tag(e, "content"))?.slice(0, 400) || null,
      author:    tag(e, "name"),
      published: tag(e, "published") || tag(e, "updated"),
      guid:      tag(e, "id"),
    });
  }
  return { feed, items };
}

export default {
  name: "rss-reader",
  price: "$0.005",

  description:
    "Fetches and parses any public RSS 2.0 or Atom 1.0 feed. Returns feed metadata (title, description, language, last updated) and structured items (title, link, 400-char summary, author, published date, GUID). Useful for monitoring news, blog posts, GitHub release notes, Reddit RSS, arXiv category feeds, or security advisories.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public RSS or Atom feed URL to fetch.",
      },
      limit: {
        type: "integer",
        description: "Maximum number of items to return (default 20, max 100).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      feed:         { type: "object",  description: "Feed-level metadata." },
      items:        { type: "array",   description: "Feed items, most recent first." },
      item_count:   { type: "integer", description: "Items returned (capped at limit)." },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const raw = (query.url || "https://example.com").trim();
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error("invalid URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("only http:// and https:// URLs are supported");

    const limit = Math.min(Math.max(1, parseInt(query.limit, 10) || 20), 100);

    const xml = await fetchFeed(parsed.href);

    let result;
    if (xml.includes("<feed") && xml.includes("xmlns")) {
      result = parseAtom(xml);
    } else {
      result = parseRss(xml);
    }

    const items = result.items.slice(0, limit);

    return {
      feed:         result.feed,
      items,
      item_count:   items.length,
      generated_at: new Date().toISOString(),
    };
  },
};
