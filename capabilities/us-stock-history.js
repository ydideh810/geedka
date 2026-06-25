// us-stock-history.js
//
// Historical OHLCV bars for US stocks/ETFs/indices — TradingView-compatible
// resolution format (D, W, M, 1, 5, 15, 60, 240). Accepts Unix timestamps.
//
// Demand basis: blockrun.ai /api/v1/stocks/us/history saw 48,360 settlements
// (~$48) in 72h in archive.db — highest-volume external endpoint observed.
// Blockrun charges $0.0010/call. STALL priced at $0.005/call.
//
// Upstream: Yahoo Finance v8/finance/chart — free, no API key, no rate limit.

const YF_BASE  = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA       = "Mozilla/5.0 (compatible; the-stall/4.43; +https://intuitek.ai)";
const TIMEOUT  = 12000;

const RESOLUTION_MAP = {
  "1":   "1m",
  "5":   "5m",
  "15":  "15m",
  "60":  "1h",
  "240": "1h",   // Yahoo Finance has no 4h interval — map to 1h
  "D":   "1d",
  "W":   "1wk",
  "M":   "1mo",
};

export default {
  name:  "us-stock-history",
  price: "$0.059",

  description:
    "Historical OHLCV bars for any US stock, ETF, or index. TradingView-compatible resolution (D, W, M, 60, 15, 5, 1). Pass Unix timestamps for from/to. $0.005/call — no API key required. Use us-stock-price for live quotes; equity-technicals for indicators.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US ticker symbol (e.g. AAPL, SPY, QQQ, ^VIX, BRK-B). Case-insensitive.",
      },
      resolution: {
        type: "string",
        enum: ["1", "5", "15", "60", "240", "D", "W", "M"],
        description: "Bar resolution: 1/5/15/60/240 = minutes, D = daily, W = weekly, M = monthly. Default: D.",
        default: "D",
      },
      from: {
        type: "integer",
        description: "Window start as Unix seconds. Default: 90 days ago.",
      },
      to: {
        type: "integer",
        description: "Window end as Unix seconds. Default: now.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    required: [],
    properties: {
      symbol:     { type: "string",  description: "Normalized ticker as returned by the exchange." },
      resolution: { type: "string",  description: "Bar resolution requested." },
      from:       { type: "integer", description: "Window start (Unix seconds)." },
      to:         { type: "integer", description: "Window end (Unix seconds)." },
      bars: {
        type: "array",
        description: "OHLCV bars sorted ascending by time.",
        items: {
          type: "object",
          required: [],
          properties: {
            t: { type: "integer", description: "Bar open time (Unix seconds)." },
            o: { type: "number",  description: "Open price." },
            h: { type: "number",  description: "High price." },
            l: { type: "number",  description: "Low price." },
            c: { type: "number",  description: "Close price." },
            v: { type: "number",  description: "Volume (shares)." },
          },
        },
      },
      count:  { type: "integer", description: "Number of bars returned." },
      source: { type: "string",  description: "Data source identifier." },
    },
  },

  async handler({ ticker = "AAPL", resolution = "D", from, to }) {
    const now      = Math.floor(Date.now() / 1000);
    const period1  = from ?? now - 90 * 86400;
    const period2  = to   ?? now;
    const interval = RESOLUTION_MAP[resolution] ?? "1d";

    const url = `${YF_BASE}/${encodeURIComponent(ticker.toUpperCase())}` +
      `?interval=${interval}&period1=${period1}&period2=${period2}` +
      `&events=history&includePrePost=false&corsDomain=finance.yahoo.com`;

    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Yahoo Finance HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data  = await resp.json();
    const chart = data?.chart?.result?.[0];
    if (!chart) {
      const err = data?.chart?.error?.description ?? "no result";
      throw new Error(`No chart data for "${ticker}": ${err}`);
    }

    const timestamps = chart.timestamp ?? [];
    const q          = chart.indicators?.quote?.[0] ?? {};

    const bars = timestamps
      .map((t, i) => ({
        t: t,
        o: +(q.open?.[i]   ?? 0).toFixed(4),
        h: +(q.high?.[i]   ?? 0).toFixed(4),
        l: +(q.low?.[i]    ?? 0).toFixed(4),
        c: +(q.close?.[i]  ?? 0).toFixed(4),
        v: Math.round(q.volume?.[i] ?? 0),
      }))
      .filter(b => b.c > 0);   // drop null/gap bars

    return {
      symbol:     chart.meta?.symbol ?? ticker.toUpperCase(),
      resolution,
      from:       period1,
      to:         period2,
      bars,
      count:      bars.length,
      source:     "yahoo",
    };
  },
};
