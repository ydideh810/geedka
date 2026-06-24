// podcast-intel.js
//
// Podcast intelligence: show metadata + recent episodes from any podcast RSS feed.
// Search by name via iTunes API or provide a direct RSS URL.
//
// Upstream: iTunes Search API (free, no auth) + RSS/Atom feed parsing (no dependencies).
// Seam: no direct x402 competitor for podcast intelligence.

const ITUNES_SEARCH = "https://itunes.apple.com/search";

// ── RSS parser (regex-based, handles CDATA) ──────────────────────────────────

const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

function decodeEntities(s) {
  if (!s) return s;
  return s.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, m => HTML_ENTITIES[m] ?? m);
}

function stripCdata(s) {
  if (!s) return s;
  return decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
}

function stripHtml(s) {
  if (!s) return null;
  return s.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim() || null;
}

function tagValue(xml, tag) {
  const re = new RegExp(`<${tag}(?:[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? stripCdata(m[1].trim()) : null;
}

function attrValue(xml, tag, attrName) {
  const re = new RegExp(`<${tag}[^>]+${attrName}=["']([^"']+)["']`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function parseDuration(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function fmtDuration(secs) {
  if (secs == null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function parseRss(xml, feedUrl, episodeLimit) {
  // Channel section = everything before first <item>
  const firstItem = xml.indexOf("<item");
  const channelXml = firstItem > -1 ? xml.slice(0, firstItem) : xml;

  const show_title  = tagValue(channelXml, "title");
  const author      = tagValue(channelXml, "itunes:author") ?? tagValue(channelXml, "author");
  const rawDesc     = tagValue(channelXml, "description") ?? tagValue(channelXml, "itunes:summary");
  const description = rawDesc ? stripHtml(rawDesc)?.slice(0, 500) ?? null : null;
  const website_url = tagValue(channelXml, "link");
  const artwork_url = attrValue(channelXml, "itunes:image", "href")
    ?? tagValue(channelXml, "url"); // fallback <image><url>

  // Categories
  const catRe = /<itunes:category[^>]+text=["']([^"']+)["']/gi;
  const categories = [];
  let cm;
  while ((cm = catRe.exec(channelXml)) !== null) categories.push(cm[1]);

  // Episodes
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const items = [];
  let im;
  while ((im = itemRe.exec(xml)) !== null) items.push(im[1]);

  const latest_episodes = items.slice(0, episodeLimit).map(item => {
    const audioUrl    = attrValue(item, "enclosure", "url");
    const durSecs     = parseDuration(tagValue(item, "itunes:duration"));
    const rawEpDesc   = tagValue(item, "description") ?? tagValue(item, "itunes:summary");
    return {
      title:            tagValue(item, "title"),
      pub_date:         tagValue(item, "pubDate"),
      duration_seconds: durSecs,
      duration_string:  fmtDuration(durSecs),
      description:      rawEpDesc ? stripHtml(rawEpDesc)?.slice(0, 300) ?? null : null,
      audio_url:        audioUrl,
      guid:             tagValue(item, "guid"),
    };
  });

  return {
    show_title,
    author,
    description,
    feed_url:       feedUrl,
    website_url,
    artwork_url,
    categories,
    episode_count:  items.length,
    latest_episodes,
    source: "rss",
  };
}

// ── iTunes search ────────────────────────────────────────────────────────────

async function searchItunes(query, resultLimit) {
  const url = `${ITUNES_SEARCH}?${new URLSearchParams({
    term: query, media: "podcast", entity: "podcast",
    limit: String(Math.min(resultLimit, 5)),
  })}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`iTunes search HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.results ?? []).map(r => ({
    show_title:      r.trackName ?? null,
    author:          r.artistName ?? null,
    description:     null,
    feed_url:        r.feedUrl ?? null,
    website_url:     r.collectionViewUrl ?? null,
    artwork_url:     r.artworkUrl600 ?? r.artworkUrl100 ?? null,
    categories:      [r.primaryGenreName].filter(Boolean).map(decodeEntities),
    episode_count:   r.trackCount ?? null,
    latest_episodes: [],
    itunes_id:       r.collectionId ?? null,
    source:          "itunes",
  }));
}

async function fetchFeed(feedUrl, episodeLimit) {
  const resp = await fetch(feedUrl, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Mozilla/5.0 (podcast-intel/1.0)" },
  });
  if (!resp.ok) throw new Error(`RSS fetch HTTP ${resp.status}`);
  const xml = await resp.text();
  return parseRss(xml, feedUrl, episodeLimit);
}

// ── Cap definition ───────────────────────────────────────────────────────────

export default {
  name:  "podcast-intel",
  price: "$0.039",

  description:
    "Podcast intelligence: show metadata and recent episodes. Search by name via iTunes or supply a direct RSS feed URL. Returns title, author, description, artwork, categories, and up to 20 recent episodes with titles, dates, durations, and audio URLs.",

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Podcast name/keyword to search iTunes (e.g. 'Lex Fridman', 'We Study Billionaires').",
      },
      url: {
        type: "string",
        description: "Direct RSS/Atom feed URL to fetch instead of searching.",
      },
      episodes: {
        type: "integer",
        description: "Number of recent episodes to return (default 10, max 20).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        description: "Matched podcasts (1 when url provided, up to 5 when query-searching).",
        items: {
          type: "object",
          properties: {
            show_title:    { type: ["string","null"], description: "Podcast show title." },
            author:        { type: ["string","null"], description: "Host or creator name." },
            description:   { type: ["string","null"], description: "Show description (500-char cap)." },
            feed_url:      { type: ["string","null"], description: "RSS feed URL." },
            website_url:   { type: ["string","null"], description: "Show website URL." },
            artwork_url:   { type: ["string","null"], description: "Cover art URL." },
            categories:    { type: "array", items: { type: "string" }, description: "Genre/category tags." },
            episode_count: { type: ["integer","null"], description: "Episodes available in feed." },
            latest_episodes: {
              type: "array",
              description: "Most recent episodes.",
              items: {
                type: "object",
                properties: {
                  title:            { type: ["string","null"] },
                  pub_date:         { type: ["string","null"] },
                  duration_seconds: { type: ["integer","null"] },
                  duration_string:  { type: ["string","null"] },
                  description:      { type: ["string","null"] },
                  audio_url:        { type: ["string","null"] },
                  guid:             { type: ["string","null"] },
                },
              },
            },
            source: { type: "string", enum: ["itunes","rss"] },
          },
        },
      },
      ts: { type: "string", description: "ISO-8601 response timestamp." },
    },
  },

  async handler(query) {
    const episodeLimit = Math.min(query.episodes ?? 10, 20);

    if (!query.query && !query.url) {
      throw new Error("provide 'query' (podcast name) or 'url' (RSS feed URL)");
    }

    let results = [];

    if (query.url) {
      const feed = await fetchFeed(query.url, episodeLimit);
      results = [feed];
    } else {
      const hits = await searchItunes(query.query, 5);
      if (hits.length === 0) return { results: [], ts: new Date().toISOString() };

      // Enrich top result with full RSS episode data
      const top = hits[0];
      if (top.feed_url) {
        try {
          const feed = await fetchFeed(top.feed_url, episodeLimit);
          hits[0] = { ...top, ...feed, itunes_id: top.itunes_id };
        } catch { /* keep iTunes-only data for this result */ }
      }
      results = hits;
    }

    return { results, ts: new Date().toISOString() };
  },
};
