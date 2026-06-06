// stock-ohlcv.js
//
// Returns historical OHLCV (open/high/low/close/volume) candlestick data for
// stocks, ETFs, and indices via Yahoo Finance free API. Useful for chart
// analysis, backtesting, price pattern detection, and trend assessment.
//
// No x402 competitor with significant settlement volume observed in archive.
// Seam basis: us-stock-price (161p/23k sett) and equity-technicals (38p) prove
// strong finance data demand — historical candlesticks are the natural next step.
//
// Free upstream: query1.finance.yahoo.com — no API key required.

const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA   = "Mozilla/5.0 (compatible; the-stall/3.0; +https://intuitek.ai)";

const VALID_INTERVALS = new Set(["1m","5m","15m","30m","1h","1d","1wk","1mo"]);
const VALID_RANGES    = new Set(["1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"]);

export default {
  name: "stock-ohlcv",
  price: "$0.010",

  description:
    "Returns historical OHLCV (open/high/low/close/volume) candlestick data for a stock, ETF, or index. Supports intervals from 1-minute to monthly and ranges from 1 day to max history. Use for chart analysis, trend detection, and quantitative backtesting. $0.010/call — free upstream, no API key.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "Stock ticker symbol (e.g. 'AAPL', 'SPY', 'BTC-USD', '^VIX'). Case-insensitive.",
      },
      interval: {
        type: "string",
        enum: ["1m","5m","15m","30m","1h","1d","1wk","1mo"],
        description: "Candlestick interval. Intraday ('1m'–'1h') limited to last 60 days. Default: '1d'.",
        default: "1d",
      },
      range: {
        type: "string",
        enum: ["1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"],
        description: "Lookback period. Default: '1mo'. Note: intraday intervals cap at 60d max.",
        default: "1mo",
      },
      limit: {
        type: "integer",
        description: "Max candles to return (1–500, default 60). Applied from most recent.",
        minimum: 1,
        maximum: 500,
        default: 60,
      },
    },
    required: ["ticker"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:   { type: "string",  description: "Normalized ticker symbol." },
      currency: { type: "string",  description: "Denomination currency (e.g. 'USD')." },
      interval: { type: "string",  description: "Candle interval returned." },
      range:    { type: "string",  description: "Lookback range requested." },
      candles:  {
        type: "array",
        description: "OHLCV candles, newest last.",
        items: {
          type: "object",
          properties: {
            date:   { type: "string",  description: "ISO date (YYYY-MM-DD) for daily+; ISO datetime for intraday." },
            open:   { type: "number",  description: "Opening price." },
            high:   { type: "number",  description: "Period high." },
            low:    { type: "number",  description: "Period low." },
            close:  { type: "number",  description: "Closing price." },
            volume: { type: "integer", description: "Shares/units traded." },
          },
          required: ["date","open","high","low","close","volume"],
        },
      },
      count:         { type: "integer", description: "Number of candles returned." },
      latest_close:  { type: "number",  description: "Most recent closing price." },
      period_high:   { type: "number",  description: "Highest price in the returned window." },
      period_low:    { type: "number",  description: "Lowest price in the returned window." },
      pct_change:    { type: "number",  description: "Percent change from first to last close in window." },
    },
    required: ["ticker","interval","range","candles","count"],
  },

  async handler({ ticker, interval = "1d", range = "1mo", limit = 60 }) {
    ticker   = ticker.trim().toUpperCase();
    interval = VALID_INTERVALS.has(interval) ? interval : "1d";
    range    = VALID_RANGES.has(range)       ? range    : "1mo";
    limit    = Math.min(500, Math.max(1, Math.floor(limit)));

    const url = `${BASE}/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&includePrePost=false`;

    const res  = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Yahoo Finance returned HTTP ${res.status} for ${ticker}`);

    const body   = await res.json();
    const result = body?.chart?.result?.[0];
    if (!result) {
      const err = body?.chart?.error;
      throw new Error(err?.description || `No data returned for ${ticker}`);
    }

    const meta      = result.meta   || {};
    const timestamps = result.timestamp || [];
    const quote     = result.indicators?.quote?.[0] || {};
    const opens     = quote.open   || [];
    const highs     = quote.high   || [];
    const lows      = quote.low    || [];
    const closes    = quote.close  || [];
    const volumes   = quote.volume || [];

    // Build candles (drop nulls)
    const isIntraday = ["1m","5m","15m","30m","1h"].includes(interval);
    const allCandles = timestamps
      .map((ts, i) => {
        const o = opens[i], h = highs[i], l = lows[i], c = closes[i], v = volumes[i];
        if (o == null || c == null) return null;
        const d = new Date(ts * 1000);
        const dateStr = isIntraday
          ? d.toISOString().replace("T", " ").substring(0, 16) + " UTC"
          : d.toISOString().substring(0, 10);
        return {
          date:   dateStr,
          open:   Math.round(o * 10000) / 10000,
          high:   Math.round(h * 10000) / 10000,
          low:    Math.round(l * 10000) / 10000,
          close:  Math.round(c * 10000) / 10000,
          volume: Math.round(v || 0),
        };
      })
      .filter(Boolean);

    // Trim to limit (newest last)
    const candles = allCandles.slice(-limit);

    const closes_arr  = candles.map(c => c.close);
    const period_high = closes_arr.length ? Math.max(...candles.map(c => c.high)) : null;
    const period_low  = closes_arr.length ? Math.min(...candles.map(c => c.low))  : null;
    const latest_close = closes_arr.length ? closes_arr[closes_arr.length - 1] : null;
    const first_close  = closes_arr.length ? closes_arr[0] : null;
    const pct_change   = (first_close && latest_close)
      ? Math.round(((latest_close - first_close) / first_close) * 10000) / 100
      : null;

    return {
      ticker,
      currency:     meta.currency || "USD",
      interval,
      range,
      candles,
      count:        candles.length,
      latest_close,
      period_high,
      period_low,
      ...(pct_change !== null ? { pct_change } : {}),
    };
  },
};
