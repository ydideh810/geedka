// crypto-news-equity-brief.js
//
// AI brief: today's crypto news narrative + equity watchlist prices in one call.
// Answers "what's the macro crypto story today and how are my equities doing?"
//
// Seam signal (cy_hb_3327, 2026-07-06): 4 organic wallets co-calling
// crypto-news-impact + stock-price-multi together over 30 days. Distinct from
// crypto-equity-brief (price movers → equities) — this cap leads with the NEWS
// narrative and correlates to equity prices for portfolio context.
//
// Upstream: CoinDesk RSS (free, no key) + Yahoo Finance v8 chart (free)
//           + gpt-4o-mini synthesis via OPENAI_API_KEY.

const COINDESK_RSS = "https://www.coindesk.com/arc/outboundfeeds/rss/";
const YF_BASE      = "https://query2.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL   = "https://api.openai.com/v1/chat/completions";
const MODEL        = "gpt-4o-mini";
const UA           = "Mozilla/5.0 (compatible; myriad/4.90; +https://synaptiic.org)";
const NEWS_TIMEOUT = 12_000;
const EQ_TIMEOUT   = 8_000;
const SYN_TIMEOUT  = 25_000;
const DEFAULT_TICKERS = ["SPY", "QQQ", "BTC-USD"];
const MAX_NEWS = 10;
const MAX_TICKERS = 8;

async function fetchCryptoNews(maxNews) {
  const resp = await fetch(COINDESK_RSS, {
    headers: { "User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(NEWS_TIMEOUT),
  });
  if (!resp.ok) throw new Error(`CoinDesk RSS ${resp.status}`);
  const xml = await resp.text();

  const items = [];
  const itemRe  = /<item>([\s\S]*?)<\/item>/g;
  const titleRe = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/;
  const descRe  = /<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/;

  let match;
  while ((match = itemRe.exec(xml)) !== null && items.length < maxNews) {
    const block = match[1];
    const titleM = titleRe.exec(block);
    const descM  = descRe.exec(block);
    if (!titleM) continue;
    items.push({
      title:   titleM[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(),
      summary: descM ? descM[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").substring(0, 120).trim() : "",
    });
  }
  return items;
}

async function fetchEquity(ticker) {
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
  if (!sym) return { ticker, error: "invalid symbol" };
  const url = `${YF_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(EQ_TIMEOUT),
    });
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ticker: sym, error: "no data" };
    const meta = result.meta;
    const price     = meta.regularMarketPrice ?? meta.previousClose ?? null;
    const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
    const change    = (price && prevClose) ? ((price - prevClose) / prevClose * 100) : null;
    return {
      ticker:   sym,
      price:    price  != null ? Math.round(price  * 100) / 100 : null,
      change:   change != null ? Math.round(change * 100) / 100 : null,
      currency: meta.currency || "USD",
    };
  } catch (e) {
    return { ticker, error: e.message };
  }
}

async function synthesize(newsItems, equities, apiKey) {
  const newsText = newsItems.map((n, i) =>
    `${i + 1}. ${n.title}${n.summary ? ` — ${n.summary}` : ""}`
  ).join("\n");

  const eqText = equities.map(e =>
    e.error ? `${e.ticker}: unavailable`
            : `${e.ticker}: $${e.price} (${e.change >= 0 ? "+" : ""}${e.change}%)`
  ).join("  |  ");

  const prompt = `You are a concise market analyst. Given today's crypto news headlines and equity performance, write a brief (3–4 sentences) that:
1. Names the 1–2 dominant crypto narratives from the headlines
2. Notes how those narratives likely affect the listed equities
3. Identifies the single most important portfolio signal

Crypto news headlines:
${newsText}

Equity snapshot:
${eqText}

Write the brief now. Be direct. No filler.`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:       MODEL,
      messages:    [{ role: "user", content: prompt }],
      max_tokens:  200,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(SYN_TIMEOUT),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err.substring(0, 120)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "Synthesis unavailable.";
}

export default {
  name:  "crypto-news-equity-brief",
  price: "$1.75",

  description:
    "AI brief connecting today's crypto news narrative to equity watchlist performance in one call — replaces separate crypto-news-impact + stock-price-multi lookups. Fetches CoinDesk headlines, pairs with live equity prices via Yahoo Finance, and GPT-4o-mini synthesizes the dominant news story and its portfolio implications. Answers: what's driving crypto right now and how does it affect my holdings?",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      tickers: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_TICKERS,
        description: `Up to ${MAX_TICKERS} equity or ETF tickers to price (e.g. ["SPY","NVDA","COIN"]). Defaults to SPY, QQQ, BTC-USD if omitted.`,
      },
      max_news: {
        type:    "integer",
        minimum: 3,
        maximum: MAX_NEWS,
        description: `Number of CoinDesk headlines to include in synthesis (default ${MAX_NEWS}, max ${MAX_NEWS}).`,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      brief:        { type: "string",  description: "AI-synthesized 3-4 sentence portfolio brief." },
      headlines:    { type: "array",   items: { type: "string" }, description: "Raw CoinDesk headline list." },
      equities:     { type: "array",   description: "Equity ticker prices and % change." },
      news_count:   { type: "integer", description: "Number of headlines fetched." },
      generated_at: { type: "string",  description: "ISO-8601 timestamp." },
    },
  },

  async handler(query) {
    const rawTickers = query?.tickers
      ? (Array.isArray(query.tickers) ? query.tickers : String(query.tickers).split(",").map(s => s.trim()))
      : DEFAULT_TICKERS;
    const tickers = rawTickers.slice(0, MAX_TICKERS);
    const maxNews = Math.min(parseInt(query?.max_news || MAX_NEWS, 10), MAX_NEWS);

    const env = query?._env || query;
    const apiKey = (typeof process !== "undefined" && process.env?.OPENAI_API_KEY) || env?.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

    const [newsItems, ...equities] = await Promise.all([
      fetchCryptoNews(maxNews).catch(e => { throw new Error(`News fetch failed: ${e.message}`); }),
      ...tickers.map(t => fetchEquity(t)),
    ]);

    if (newsItems.length === 0) throw new Error("No news items returned from CoinDesk RSS");

    const brief = await synthesize(newsItems, equities, apiKey);

    return {
      brief,
      headlines:    newsItems.map(n => n.title),
      equities,
      news_count:   newsItems.length,
      generated_at: new Date().toISOString(),
    };
  },
};
