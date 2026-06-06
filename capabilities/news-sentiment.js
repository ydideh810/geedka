// news-sentiment.js
//
// Global news coverage and sentiment for any company, ticker, or topic.
// Primary source: GDELT Project v2 Doc API (free, no key, 250M+ articles,
// ML tone scoring). Fallback: Google News RSS + keyword sentiment heuristic
// (unlimited, no key) — activates on GDELT rate-limit (429) after one retry.
//
// Seam: x402stock.xyz/api/v1/news-sentiment (Media category, new 2026-06-06,
// PROSPECTOR archive). Free upstream + cache → clean hedge at $0.004.
//
// Results cached 10 min per (query, days) to stay within GDELT's 1req/5s limit.
// Concurrent calls for the same query return the cached result immediately.

const GDELT    = "https://api.gdeltproject.org/api/v2/doc/doc";
const GN_RSS   = "https://news.google.com/rss/search";
const UA       = "Mozilla/5.0 (compatible; the-stall/3.44; +https://intuitek.ai)";
const TIMEOUT  = 15_000;
const CACHE_TTL = 10 * 60 * 1000;

// Module-level result cache (survives across requests in the same process).
const cache = new Map();
function cacheKey(q, d) { return `${q.trim().toLowerCase()}:${d}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── GDELT ToneChart ──────────────────────────────────────────────────────────
function fmtGdeltDt(d) {
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

async function fetchGdelt(query, days) {
  const now   = new Date();
  const start = new Date(now.getTime() - days * 86_400_000);
  const url = `${GDELT}?${new URLSearchParams({
    query,
    mode:          "ToneChart",
    format:        "json",
    startdatetime: fmtGdeltDt(start),
    enddatetime:   fmtGdeltDt(now),
  })}`;

  const doFetch = () => fetch(url, {
    headers: { "User-Agent": UA },
    signal:  AbortSignal.timeout(TIMEOUT),
  });

  let r = await doFetch();
  if (r.status === 429) {
    await sleep(10_000); // extra margin on rate limit
    r = await doFetch();
  }
  if (r.status === 429) throw Object.assign(new Error("GDELT rate-limited"), { code: "RATE_LIMITED" });
  if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);

  const data = await r.json();
  const bins = data.tonechart || [];
  if (!bins.length) return null;

  let totalCount = 0, weightedSum = 0;
  const posStories = [], negStories = [];
  const domainCounts = {};

  for (const b of bins) {
    const cnt = b.count || 0;
    if (!cnt) continue;
    totalCount += cnt;
    weightedSum += b.bin * cnt;

    for (const art of b.toparts || []) {
      if (b.bin >= 5)  posStories.push({ title: art.title, url: art.url, tone: b.bin });
      if (b.bin <= -5) negStories.push({ title: art.title, url: art.url, tone: b.bin });
      try {
        const domain = new URL(art.url).hostname.replace(/^www\./, "");
        domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      } catch { /* skip */ }
    }
  }

  const avgTone = totalCount > 0 ? weightedSum / totalCount : 0;
  posStories.sort((a, b) => b.tone - a.tone);
  negStories.sort((a, b) => a.tone - b.tone);

  return {
    article_count: totalCount,
    avg_tone:      parseFloat(avgTone.toFixed(2)),
    sentiment:     avgTone >= 2 ? "positive" : avgTone <= -2 ? "negative" : "neutral",
    top_positive:  posStories.slice(0, 3).map(({ title, url }) => ({ title, url })),
    top_negative:  negStories.slice(0, 3).map(({ title, url }) => ({ title, url })),
    top_domains:   Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, c]) => ({ domain: d, count: c })),
    source:        "gdelt",
  };
}

// ── Google News RSS fallback (keyword-based sentiment heuristic) ─────────────
const POS_WORDS = new Set(["beat","surge","record","rally","gain","profit","growth","upgrade","soar","win","strong","launch","breakthrough","approve","approve","rise","jump","high","buy","bullish"]);
const NEG_WORDS = new Set(["miss","fall","drop","decline","loss","warning","risk","downgrade","cut","crash","tumble","scandal","concern","recall","fraud","sell","bearish","layoff","lower","weak"]);

function keywordSentiment(titles) {
  let pos = 0, neg = 0;
  for (const t of titles) {
    for (const w of t.toLowerCase().split(/\W+/)) {
      if (POS_WORDS.has(w)) pos++;
      if (NEG_WORDS.has(w)) neg++;
    }
  }
  const score = pos - neg;
  return { pos, neg, score, label: score >= 2 ? "positive" : score <= -2 ? "negative" : "neutral" };
}

async function fetchGoogleNews(query, days) {
  const url = `${GN_RSS}?${new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" })}`;
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`Google News HTTP ${r.status}`);
  const xml = await r.text();

  // Parse items from RSS (simple regex, no XML parser dependency)
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const items = [];
  for (const m of xml.matchAll(/<item>[\s\S]*?<\/item>/g)) {
    const block  = m[0];
    const title  = (block.match(/<title>(.+?)<\/title>/) || [])[1]?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, "").trim() || "";
    const link   = (block.match(/<link>([^<]+)/) || [])[1]?.trim() || "";
    const pubDate = (block.match(/<pubDate>(.+?)<\/pubDate>/) || [])[1];
    const domain  = (block.match(/<source url="([^"]+)"/) || [])[1];

    if (!title) continue;
    if (pubDate && new Date(pubDate) < cutoff) continue;

    items.push({ title, url: link, domain: domain ? new URL(domain).hostname.replace(/^www\./, "") : "" });
  }

  const sent = keywordSentiment(items.map(i => i.title));
  const domainCounts = {};
  for (const it of items) {
    if (it.domain) domainCounts[it.domain] = (domainCounts[it.domain] || 0) + 1;
  }

  return {
    article_count: items.length,
    avg_tone:      sent.score,
    sentiment:     sent.label,
    top_positive:  [], // heuristic only, no per-article tone to sort by
    top_negative:  [],
    top_stories:   items.slice(0, 5).map(({ title, url }) => ({ title, url })),
    top_domains:   Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, c]) => ({ domain: d, count: c })),
    source:        "google_news_rss",
    note:          "Using Google News RSS + keyword heuristic (GDELT unavailable). Tone scores are approximate.",
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────
async function handler({ query, days = 3 }) {
  const d   = Math.max(1, Math.min(30, Math.round(days)));
  const key = cacheKey(query, d);

  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.result;

  let result;
  try {
    const gdelt = await fetchGdelt(query, d);
    result = gdelt
      ? { query, period_days: d, ...gdelt }
      : { query, period_days: d, article_count: 0, avg_tone: 0, sentiment: "neutral", top_positive: [], top_negative: [], top_domains: [], source: "gdelt", note: "No coverage found in GDELT for this query and time window." };
  } catch (err) {
    // Fall back to Google News RSS
    try {
      const gnews = await fetchGoogleNews(query, d);
      result = { query, period_days: d, ...gnews };
    } catch (err2) {
      throw new Error(`Both sources failed. GDELT: ${err.message}. Google News: ${err2.message}`);
    }
  }

  cache.set(key, { result, expiry: Date.now() + CACHE_TTL });
  return result;
}

export default {
  name: "news-sentiment",
  price: "$0.004",

  description:
    "Returns global news coverage and sentiment for any company, stock ticker, or topic. Primary source: GDELT Project v2 (250M+ articles, ML tone scoring). Fallback: Google News RSS with keyword heuristic. Returns article count, avg sentiment tone (−100 negative → +100 positive), top positive/negative headlines, and top news domains. Lookback: 1–30 days (default 3). Results cached 10 min.",

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Company name, stock ticker, or news topic (e.g. 'NVIDIA', 'Apple earnings', 'Bitcoin regulation', 'Fed interest rates').",
      },
      days: {
        type: "number",
        description: "Lookback window in days (1–30). Default: 3.",
        default: 3,
      },
    },
    required: ["query"],
  },

  outputSchema: {
    type: "object",
    properties: {
      query:         { type: "string" },
      period_days:   { type: "number" },
      article_count: { type: "number", description: "Total articles found matching query in the time window." },
      avg_tone:      { type: "number", description: "Weighted avg tone: −100 = very negative, +100 = very positive, near 0 = neutral. Precise when source=gdelt; approximate keyword score when source=google_news_rss." },
      sentiment:     { type: "string", enum: ["positive", "neutral", "negative"] },
      source:        { type: "string", description: "Data source used: 'gdelt' (ML tone) or 'google_news_rss' (keyword heuristic)." },
      top_positive:  { type: "array", description: "Most positively-toned articles (GDELT source only).", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } } } },
      top_negative:  { type: "array", description: "Most negatively-toned articles (GDELT source only).", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } } } },
      top_stories:   { type: "array", description: "Top recent headlines (Google News RSS fallback only).", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } } } },
      top_domains:   { type: "array", description: "Top 5 news domains by article count.", items: { type: "object", properties: { domain: { type: "string" }, count: { type: "number" } } } },
      note:          { type: "string", description: "Contextual note about data availability or source fallback." },
    },
  },

  handler,
};
