// equity-watchlist-brief.js
//
// Portfolio watchlist snapshot with technical analysis and AI brief.
//
// Seam signal (cy_hb_3323, 2026-07-06): 8x co-call — 8 distinct organic payers
// called both stock-price-multi and us-stock-price in the 30-day window.
// These are equity portfolio agents monitoring a watchlist and digging into
// the biggest mover. This cap collapses both calls into one structured output
// with technical context (RSI, trend regime, 52w positioning) and a GPT-synthesized
// portfolio brief.
//
// One call replaces: stock-price-multi + us-stock-price + manual technical analysis.
// Price: $1.25 — premium for multi-stock coverage + technical layer + AI synthesis.
//
// Upstreams: Yahoo Finance v8/finance/chart (free, no auth)
//            + gpt-4o-mini via OPENAI_API_KEY.

const YF_BASE     = "https://query2.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL  = "https://api.openai.com/v1/chat/completions";
const MODEL       = "gpt-4o-mini";
const UA          = "Mozilla/5.0 (compatible; the-stall/4.88; +https://intuitek.ai)";
const CHART_TMO   = 12_000;
const GPT_TMO     = 25_000;
const MAX_TICKERS = 8;

function r2(n) { return Math.round(n * 100) / 100; }
function r4(n) { return Math.round(n * 10000) / 10000; }

// ── Yahoo Finance fetch (1yr daily OHLCV for technicals) ─────────────────────

async function fetchTicker(sym) {
  const url = `${YF_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1y`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(CHART_TMO),
  });
  if (!resp.ok) return { ticker: sym, error: `HTTP ${resp.status}` };
  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result) return { ticker: sym, error: "no data" };

  const meta    = result.meta || {};
  const closes  = (result.indicators?.quote?.[0]?.close || []).filter(v => v != null);
  const volumes = (result.indicators?.quote?.[0]?.volume || []).filter(v => v != null);

  const price     = r2(meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0);
  const prevClose = r2(meta.chartPreviousClose ?? meta.previousClose ?? price);
  const changePct = prevClose ? r2(((price - prevClose) / prevClose) * 100) : 0;
  const changeUsd = r2(price - prevClose);

  const high52w   = r2(meta["52WeekHigh"] ?? (closes.length ? Math.max(...closes) : null));
  const low52w    = r2(meta["52WeekLow"]  ?? (closes.length ? Math.min(...closes) : null));
  const vol       = meta.regularMarketVolume ?? volumes[volumes.length - 1] ?? null;

  // RSI(14)
  let rsi14 = null;
  if (closes.length >= 15) {
    let gains = 0, losses = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const delta = closes[i] - closes[i - 1];
      if (delta > 0) gains += delta; else losses -= delta;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    rsi14 = avgLoss === 0 ? 100 : r2(100 - 100 / (1 + avgGain / avgLoss));
  }

  // SMA50
  let sma50 = null;
  if (closes.length >= 50) {
    const sl = closes.slice(-50);
    sma50 = r4(sl.reduce((a, b) => a + b, 0) / 50);
  }

  // Trend regime
  let trend_regime = "unknown";
  if (sma50 !== null) {
    trend_regime = price > sma50 ? "above_sma50" : "below_sma50";
  }

  // 52w position (0 = at 52w low, 1 = at 52w high)
  let week52_position = null;
  if (high52w !== null && low52w !== null && high52w > low52w) {
    week52_position = r2((price - low52w) / (high52w - low52w));
  }

  // Volume z-score vs 20d avg
  let vol_vs_avg = null;
  if (volumes.length >= 20 && vol !== null) {
    const recentVols = volumes.slice(-20);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    vol_vs_avg = avgVol > 0 ? r2(vol / avgVol) : null;
  }

  return {
    ticker:           meta.symbol || sym,
    name:             meta.longName || meta.shortName || null,
    price_usd:        price,
    change_pct:       changePct,
    change_usd:       changeUsd,
    volume:           vol,
    vol_vs_20d_avg:   vol_vs_avg,
    day_high:         r2(meta.regularMarketDayHigh ?? 0) || null,
    day_low:          r2(meta.regularMarketDayLow  ?? 0) || null,
    week_52_high:     high52w,
    week_52_low:      low52w,
    week_52_position: week52_position,
    rsi_14:           rsi14,
    trend_regime:     trend_regime,
    sma_50:           sma50,
    exchange:         meta.fullExchangeName || meta.exchangeName || null,
    currency:         meta.currency || "USD",
    market_state:     meta.marketState || null,
    market_time:      meta.regularMarketTime
                        ? new Date(meta.regularMarketTime * 1000).toISOString()
                        : null,
    error:            null,
  };
}

// ── GPT synthesis ─────────────────────────────────────────────────────────────

async function synthesize(stocks, env) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const focusTicker = stocks.find(s => !s.error);
  const sortedStocks = [...stocks].sort((a, b) =>
    Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)
  );
  const focusStock = sortedStocks[0];

  const stockLines = sortedStocks.map(s => {
    if (s.error) return `${s.ticker}: error (${s.error})`;
    const regime = s.trend_regime === "above_sma50" ? "↑ uptrend" : s.trend_regime === "below_sma50" ? "↓ downtrend" : "?";
    const rsiLabel = s.rsi_14 !== null
      ? (s.rsi_14 > 70 ? "overbought" : s.rsi_14 < 30 ? "oversold" : "neutral")
      : "no RSI";
    const vol52w = s.week_52_position !== null
      ? (s.week_52_position > 0.9 ? "near 52w high" : s.week_52_position < 0.1 ? "near 52w low" : `${Math.round(s.week_52_position * 100)}% of 52w range`)
      : "";
    const volStr = s.vol_vs_20d_avg !== null
      ? ` vol=${s.vol_vs_20d_avg}x avg`
      : "";
    return `${s.ticker} (${s.name ?? ''}): $${s.price_usd} ${s.change_pct > 0 ? '+' : ''}${s.change_pct}% | ${regime} | RSI=${s.rsi_14 ?? 'n/a'} (${rsiLabel}) | ${vol52w}${volStr}`;
  }).join("\n");

  const prompt = `You are a concise equity analyst. Analyze this portfolio watchlist snapshot and provide a brief:

${stockLines}

Focus stock (biggest mover): ${focusStock?.ticker ?? 'none'}

Return a JSON object with exactly these fields:
- "portfolio_mood": one of "bullish", "bearish", "mixed", "neutral"
- "portfolio_summary": 1-2 sentence summary of overall portfolio health and key themes
- "focus_analysis": 2-3 sentence analysis of the biggest mover — what the price action + technical signals suggest
- "risk_flags": array of 0-3 short risk warnings (overbought conditions, volume spikes, trend breaks, 52w extremes). Empty array if none.
- "actionable": 1 concise sentence on what to watch next for this portfolio

Respond with valid JSON only. No markdown.`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(GPT_TMO),
  });

  if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
  const gptData = await resp.json();
  const raw = gptData.choices?.[0]?.message?.content?.trim() ?? "{}";

  try {
    return JSON.parse(raw);
  } catch {
    return { portfolio_mood: "unknown", portfolio_summary: raw.slice(0, 200), focus_analysis: null, risk_flags: [], actionable: null };
  }
}

// ── Cap export ────────────────────────────────────────────────────────────────

export default {
  name:  "equity-watchlist-brief",
  price: "$1.25",

  description:
    "Portfolio watchlist snapshot with technical analysis and AI brief. Accepts up to 8 US equity tickers, returns price, change %, RSI(14), 52-week positioning, volume vs 20-day average, and trend regime (above/below SMA50) for each. AI synthesizes a portfolio mood assessment, focus analysis on the biggest mover, risk flags, and next-watch guidance. Replaces stock-price-multi + us-stock-price + manual technical review in one call. Data: Yahoo Finance (free, no auth) + gpt-4o-mini synthesis.",

  inputSchema: {
    type: "object",
    properties: {
      tickers: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_TICKERS,
        description: `Up to ${MAX_TICKERS} US stock ticker symbols (e.g. ["AAPL","NVDA","MSFT"]). Case-insensitive.`,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      portfolio: {
        type: "array",
        description: "All requested tickers sorted by absolute move magnitude (biggest movers first).",
        items: {
          type: "object",
          properties: {
            ticker:            { type: "string",  description: "Ticker symbol." },
            name:              { type: "string",  description: "Company name." },
            price_usd:         { type: "number",  description: "Current price in USD." },
            change_pct:        { type: "number",  description: "% change from previous close." },
            change_usd:        { type: "number",  description: "USD change from previous close." },
            volume:            { type: "integer", description: "Intraday volume." },
            vol_vs_20d_avg:    { type: "number",  description: "Volume relative to 20-day average (1.0 = average, 2.0 = double)." },
            day_high:          { type: "number",  description: "Intraday high." },
            day_low:           { type: "number",  description: "Intraday low." },
            week_52_high:      { type: "number",  description: "52-week high." },
            week_52_low:       { type: "number",  description: "52-week low." },
            week_52_position:  { type: "number",  description: "Position in 52-week range (0=at 52w low, 1=at 52w high)." },
            rsi_14:            { type: "number",  description: "RSI(14) momentum indicator." },
            trend_regime:      { type: "string",  description: "above_sma50 or below_sma50." },
            sma_50:            { type: "number",  description: "50-day simple moving average." },
            exchange:          { type: "string",  description: "Exchange name." },
            currency:          { type: "string",  description: "Quote currency." },
            market_state:      { type: "string",  description: "REGULAR, PRE, POST, CLOSED." },
            market_time:       { type: "string",  description: "ISO-8601 timestamp of last price." },
            error:             { type: "string",  description: "Error message if ticker fetch failed." },
          },
        },
      },
      focus_ticker:        { type: "string",  description: "The ticker with the largest absolute move (the focus stock for AI analysis)." },
      portfolio_mood:      { type: "string",  description: "Overall portfolio mood: bullish, bearish, mixed, or neutral." },
      portfolio_summary:   { type: "string",  description: "1-2 sentence summary of overall portfolio health and key themes." },
      focus_analysis:      { type: "string",  description: "2-3 sentence technical and contextual analysis of the biggest mover." },
      risk_flags:          { type: "array",   items: { type: "string" }, description: "Active risk signals: overbought conditions, volume spikes, trend breaks, 52w extremes." },
      actionable:          { type: "string",  description: "One concise sentence on what to watch next for this portfolio." },
      ts:                  { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query, env) {
    const rawTickers = Array.isArray(query.tickers)
      ? query.tickers
      : (typeof query.tickers === "string" ? [query.tickers] : ["AAPL", "NVDA", "MSFT"]);

    const symbols = rawTickers
      .slice(0, MAX_TICKERS)
      .map(t => t.toUpperCase().replace(/[^A-Z0-9.\-^]/g, ""))
      .filter(Boolean);

    if (symbols.length === 0) throw new Error("No valid tickers provided");

    // Fetch all tickers in parallel
    const stockData = await Promise.all(symbols.map(sym => fetchTicker(sym)));

    // Sort by absolute change magnitude
    const sorted = [...stockData].sort((a, b) =>
      Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)
    );

    const focusStock = sorted.find(s => !s.error);

    // GPT synthesis
    let synthesis = {};
    try {
      synthesis = await synthesize(sorted, env ?? {});
    } catch (e) {
      synthesis = {
        portfolio_mood: "unknown",
        portfolio_summary: `Synthesis unavailable: ${e.message}`,
        focus_analysis: null,
        risk_flags: [],
        actionable: null,
      };
    }

    return {
      portfolio:          sorted,
      focus_ticker:       focusStock?.ticker ?? null,
      portfolio_mood:     synthesis.portfolio_mood ?? "unknown",
      portfolio_summary:  synthesis.portfolio_summary ?? null,
      focus_analysis:     synthesis.focus_analysis ?? null,
      risk_flags:         Array.isArray(synthesis.risk_flags) ? synthesis.risk_flags : [],
      actionable:         synthesis.actionable ?? null,
      ts:                 new Date().toISOString(),
    };
  },
};
