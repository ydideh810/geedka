// treasury-yields.js
//
// Returns current US Treasury yield curve at 3M, 5Y, 10Y, and 30Y nodes.
// Sourced from CBOE interest-rate indices via Yahoo Finance public API —
// no API key, updated during market hours. Priced at $0.010.
//
// Seam: fills the term-structure gap in the financial intelligence stack.
// Agents pricing risk, running DCF models, or building bond analytics need
// the risk-free rate and curve shape in a single call rather than inferring
// it from equity data. Pairs naturally with macro-indicators (Fed policy) and
// market-overview (VIX, SPY) for the complete risk backdrop.
//
// Derived metrics: 10Y-3M spread (key recession signal — negative = inverted)
// and curve_shape classification (normal / flat / inverted).

const YF_BASE = "https://query2.finance.yahoo.com/v8/finance/chart";
const UA      = "Mozilla/5.0 (compatible; myriad/0.4; +https://synaptiic.org)";

const TICKERS = {
  y3m:  "^IRX",  // 13-Week T-Bill
  y5y:  "^FVX",  // 5-Year Treasury Yield
  y10y: "^TNX",  // 10-Year Treasury Yield
  y30y: "^TYX",  // 30-Year Treasury Yield
};

async function fetchYield(symbol) {
  const url = `${YF_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Yahoo Finance returned ${resp.status} for ${symbol}`);
  const data = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const errCode = data?.chart?.error?.code || "no_data";
    throw new Error(`no data for ${symbol} (${errCode})`);
  }
  const meta = result.meta;
  return {
    value: meta.regularMarketPrice ?? null,
    ts: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : null,
  };
}

export default {
  name: "treasury-yields",
  price: "$0.059",

  description:
    "Returns current US Treasury yield curve at 3M, 5Y, 10Y, and 30Y nodes from CBOE interest-rate indices (free, no API key). Includes 10Y-3M spread and curve shape classification. Essential for DCF discount rates, bond pricing, and recession signal monitoring.",

  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      y3m:           { type: "number", description: "3-Month (13-Week) Treasury Bill yield (%)." },
      y5y:           { type: "number", description: "5-Year Treasury yield (%)." },
      y10y:          { type: "number", description: "10-Year Treasury yield (%). Primary risk-free rate for DCF models." },
      y30y:          { type: "number", description: "30-Year Treasury yield (%)." },
      spread_10y_3m: { type: "number", description: "10Y minus 3M spread (bp). Negative = yield curve inverted (recession signal)." },
      spread_30y_10y:{ type: "number", description: "30Y minus 10Y spread (bp). Measures long-end steepness." },
      curve_shape:   { type: "string", description: "Yield curve classification: 'normal' (10Y > 3M), 'inverted' (10Y < 3M), or 'flat' (|spread| <= 25bp)." },
      data_ts:       { type: "string", description: "ISO-8601 timestamp of the latest market observation." },
      ts:            { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(_query) {
    const [r3m, r5y, r10y, r30y] = await Promise.all([
      fetchYield(TICKERS.y3m),
      fetchYield(TICKERS.y5y),
      fetchYield(TICKERS.y10y),
      fetchYield(TICKERS.y30y),
    ]);

    const round2 = (n) => Math.round(n * 100) / 100;

    const spread_10y_3m  = (r10y.value !== null && r3m.value !== null)
      ? round2((r10y.value - r3m.value) * 100)  // bps
      : null;

    const spread_30y_10y = (r30y.value !== null && r10y.value !== null)
      ? round2((r30y.value - r10y.value) * 100)  // bps
      : null;

    let curve_shape = null;
    if (spread_10y_3m !== null) {
      if (Math.abs(spread_10y_3m) <= 25) curve_shape = "flat";
      else if (spread_10y_3m < 0)        curve_shape = "inverted";
      else                               curve_shape = "normal";
    }

    const data_ts = r10y.ts ?? r3m.ts ?? r30y.ts ?? null;

    return {
      y3m:            r3m.value  !== null ? round2(r3m.value)  : null,
      y5y:            r5y.value  !== null ? round2(r5y.value)  : null,
      y10y:           r10y.value !== null ? round2(r10y.value) : null,
      y30y:           r30y.value !== null ? round2(r30y.value) : null,
      spread_10y_3m,
      spread_30y_10y,
      curve_shape,
      data_ts,
      ts: new Date().toISOString(),
    };
  },
};
