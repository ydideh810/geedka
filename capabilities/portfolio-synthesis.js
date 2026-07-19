// portfolio-synthesis.js
//
// AI-synthesized portfolio intelligence for a basket of US equities.
// Fetches live prices for up to 5 tickers, then runs multi-source
// synthesis (HN, OpenAlex, Reddit, arXiv, DDG) tuned to the specific
// portfolio, producing a portfolio-level narrative + per-ticker data.
//
// Seam signal (cy_hb_3307, 2026-07-06): 19x co-call pattern where agents
// call stock-price-multi + research-synthesis together on the same session.
// This cap serves both in one payment instead of two ($2.56 → $2.50).
//
// Upstream: Yahoo Finance v8 (free) + same free sources as research-synthesis
//           + gpt-4o-mini synthesis via OPENAI_API_KEY.

const YF_BASE     = "https://query2.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL  = "https://api.openai.com/v1/chat/completions";
const MODEL       = "gpt-4o-mini";
const UA          = "Mozilla/5.0 (compatible; myriad/4.82; +https://synaptiic.org)";
const SRC_TIMEOUT = 8_000;
const SYN_TIMEOUT = 25_000;
const MAX_TICKERS = 5;

// ── price fetchers (mirrors stock-price-multi) ───────────────────────────────

async function fetchTicker(ticker) {
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
  if (!sym) return { ticker, error: "invalid ticker symbol" };
  const url = `${YF_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`;
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(SRC_TIMEOUT),
    });
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      const errCode = data?.chart?.error?.code || "not_found";
      return { ticker: sym, error: `no data (${errCode})` };
    }
    const meta  = result.meta;
    const prev  = meta.chartPreviousClose ?? meta.regularMarketPrice;
    const price = meta.regularMarketPrice;
    const diff  = price - prev;
    const pct   = prev !== 0 ? (diff / prev) * 100 : 0;
    return {
      ticker:       meta.symbol,
      name:         meta.longName || meta.shortName || null,
      price_usd:    Math.round(price * 10000) / 10000,
      change_pct:   Math.round(pct   * 10000) / 10000,
      change_usd:   Math.round(diff  * 10000) / 10000,
      volume:       meta.regularMarketVolume ?? null,
      day_high:     meta.regularMarketDayHigh ?? null,
      day_low:      meta.regularMarketDayLow  ?? null,
      week_52_high: meta.fiftyTwoWeekHigh     ?? null,
      week_52_low:  meta.fiftyTwoWeekLow      ?? null,
      exchange:     meta.fullExchangeName     ?? meta.exchangeName ?? null,
      currency:     meta.currency             ?? "USD",
      market_time:  meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : null,
      error: null,
    };
  } catch (err) {
    return { ticker: sym, error: `fetch failed: ${err.message}` };
  }
}

// ── intelligence source fetchers ─────────────────────────────────────────────

async function fetchHN(query) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`;
  const r   = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`HN ${r.status}`);
  const d = await r.json();
  return (d.hits || []).map(h => ({
    source: "Hacker News",
    title:  h.title,
    url:    h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    snippet: h.story_text ? h.story_text.slice(0, 300) : null,
  }));
}

async function fetchReddit(query) {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=5&t=month`;
  const r   = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`Reddit ${r.status}`);
  const d = await r.json();
  return ((d.data?.children) || []).map(c => c.data).map(p => ({
    source:  "Reddit",
    title:   p.title,
    url:     `https://reddit.com${p.permalink}`,
    snippet: p.selftext ? p.selftext.slice(0, 300) : null,
  }));
}

async function fetchDDG(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
  const r   = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(SRC_TIMEOUT) });
  if (!r.ok) throw new Error(`DDG ${r.status}`);
  const d = await r.json();
  const items = [];
  if (d.AbstractText) {
    items.push({ source: "DuckDuckGo", title: d.Heading, url: d.AbstractURL, snippet: d.AbstractText.slice(0, 400) });
  }
  (d.RelatedTopics || []).slice(0, 3).forEach(t => {
    if (t.Text && t.FirstURL) {
      items.push({ source: "DuckDuckGo", title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text.slice(0, 300) });
    }
  });
  return items;
}

// ── portfolio synthesis ───────────────────────────────────────────────────────

async function synthesizePortfolio(tickers, priceData, focus, sources) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const tickerList = tickers.join(", ");
  const priceBlock = priceData
    .filter(p => !p.error)
    .map(p => `${p.ticker} (${p.name || p.ticker}): $${p.price_usd} (${p.change_pct > 0 ? "+" : ""}${p.change_pct}%)`)
    .join("\n");

  const allSources = sources.flatMap(r => r.items || []);
  const sourceText = allSources.slice(0, 18).map((s, i) =>
    `[${i + 1}] ${s.source}: ${s.title}` +
    (s.snippet ? `\n    → ${s.snippet.slice(0, 250)}` : "")
  ).join("\n\n");

  const focusClause = focus ? ` Focus particularly on: ${focus}.` : "";
  const prompt = `You are a portfolio analyst AI. Given current market prices and gathered intelligence, synthesize a portfolio-level analysis for these holdings: ${tickerList}.${focusClause}

CURRENT PRICES:
${priceBlock}

INTELLIGENCE SOURCES GATHERED:
${sourceText}

Respond ONLY with a JSON object (no markdown, no prose outside the JSON):
{
  "portfolio_summary": "2-3 sentence executive overview of this portfolio's current position and near-term outlook",
  "key_themes": ["theme affecting 2+ holdings", "theme 2", "theme 3"],
  "risk_assessment": "brief risk narrative — macro, sector, or company-specific risks across the portfolio",
  "investment_outlook": "positive | cautious | bearish | neutral | mixed",
  "sector_exposure": {"sector_name": "percentage estimate or qualitative weight"},
  "standout_ticker": "ticker symbol most affected by current news/themes, with one-sentence reason",
  "correlation_note": "whether holdings appear correlated or diversified, based on themes"
}`;

  const resp = await fetch(OPENAI_URL, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:      MODEL,
      max_tokens: 1024,
      messages:   [
        { role: "system", content: "You are a portfolio intelligence analyst. Respond with valid JSON only." },
        { role: "user",   content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(SYN_TIMEOUT),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.status);
    throw new Error(`OpenAI API ${resp.status}: ${String(err).slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || "";
  try {
    return JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) return JSON.parse(m[0]);
    throw new Error("Synthesis did not return valid JSON");
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

export default {
  name:  "portfolio-synthesis",
  price: "$2.50",

  description:
    "AI portfolio intelligence for a basket of US equities — fetches live prices for up to 5 tickers and synthesizes multi-source market intelligence into a portfolio-level narrative. Returns per-ticker price data (price, change %, volume, 52-week range) plus a portfolio analysis: executive summary, key investment themes, risk assessment, sector exposure, investment outlook, and standout ticker. One call replaces separate price + research lookups. Pass tickers as an array (e.g. [\"AAPL\",\"NVDA\",\"MSFT\"]) and an optional focus to narrow the analytical lens.",

  inputSchema: {
    type: "object",
    properties: {
      tickers: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_TICKERS,
        description: `Up to ${MAX_TICKERS} US equity ticker symbols (e.g. ["AAPL","NVDA","MSFT"]). NYSE/NASDAQ symbols. Case-insensitive.`,
      },
      focus: {
        type: "string",
        description: "Optional analytical focus for the portfolio synthesis (e.g. 'AI exposure', 'earnings risk', 'macro sensitivity', 'dividend yield'). Narrows the intelligence lens.",
      },
      portfolio_name: {
        type: "string",
        description: "Optional label for this portfolio (e.g. 'Tech growth basket', 'Mag7 watchlist'). Included in the response for reference.",
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      tickers:            { type: "array",   description: "Live price data per ticker." },
      portfolio_name:     { type: "string",  description: "Portfolio label if provided." },
      focus:              { type: "string"   },
      portfolio_summary:  { type: "string",  description: "2-3 sentence executive portfolio overview." },
      key_themes:         { type: "array",   items: { type: "string" } },
      risk_assessment:    { type: "string"   },
      investment_outlook: { type: "string",  description: "positive | cautious | bearish | neutral | mixed" },
      sector_exposure:    { type: "object"   },
      standout_ticker:    { type: "string"   },
      correlation_note:   { type: "string"   },
      sources_queried:    { type: "integer"  },
      sources_responded:  { type: "integer"  },
      ts:                 { type: "string"   },
    },
  },

  async handler(query) {
    let raw = query.tickers || ["AAPL", "MSFT", "NVDA"];
    if (typeof raw === "string") raw = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (raw.length > MAX_TICKERS) throw new Error(`max ${MAX_TICKERS} tickers per call`);

    const focus = query.focus ? query.focus.trim().slice(0, 100) : null;
    const portfolioName = query.portfolio_name ? query.portfolio_name.trim().slice(0, 80) : null;
    const tickerList = raw.map(t => t.toUpperCase().trim());

    // Fetch prices and intelligence sources in parallel
    const searchQuery = `${tickerList.join(" ")} stock portfolio analysis outlook`;

    const [priceResults, hnResult, redditResult, ddgResult] = await Promise.all([
      Promise.all(tickerList.map(fetchTicker)),
      fetchHN(searchQuery).then(items => ({ name: "hn",     ok: true,  items })).catch(e => ({ name: "hn",     ok: false, items: [], error: e.message })),
      fetchReddit(searchQuery).then(items => ({ name: "reddit", ok: true, items })).catch(e => ({ name: "reddit", ok: false, items: [], error: e.message })),
      fetchDDG(searchQuery).then(items => ({ name: "ddg",    ok: true, items })).catch(e => ({ name: "ddg",    ok: false, items: [], error: e.message })),
    ]);

    const sourceResults = [hnResult, redditResult, ddgResult];
    const responded = sourceResults.filter(r => r.ok && r.items.length > 0);

    let synthesis = null;
    let synthError = null;
    try {
      synthesis = await synthesizePortfolio(tickerList, priceResults, focus, responded);
    } catch (err) {
      synthError = err.message;
    }

    return {
      tickers:            priceResults,
      portfolio_name:     portfolioName,
      focus:              focus,
      portfolio_summary:  synthesis?.portfolio_summary   || null,
      key_themes:         synthesis?.key_themes          || [],
      risk_assessment:    synthesis?.risk_assessment     || null,
      investment_outlook: synthesis?.investment_outlook  || null,
      sector_exposure:    synthesis?.sector_exposure     || {},
      standout_ticker:    synthesis?.standout_ticker     || null,
      correlation_note:   synthesis?.correlation_note   || null,
      sources_queried:    sourceResults.length,
      sources_responded:  responded.length,
      synthesis_error:    synthError || undefined,
      ts:                 new Date().toISOString(),
    };
  },
};
