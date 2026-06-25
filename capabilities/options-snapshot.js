// options-snapshot.js
//
// Options intelligence snapshot for any US equity via CBOE delayed data.
// Returns IV30, put/call volume ratio, top options by volume, and
// unusual-volume flags — collapsing what normally requires a paid options
// data subscription + custom aggregation into a single structured call.
//
// Seam: agents running equity-technicals + us-stock-price to build
// trading context lack options-layer sentiment. IV30 + P/C ratio +
// top strikes add the missing dimension without paid API keys.
//
// Free upstream: cdn.cboe.com/api/global/delayed_quotes/options/
// No API key, no auth. 15-min delayed during trading hours.

const CBOE_BASE = "https://cdn.cboe.com/api/global/delayed_quotes/options";
const UA        = "Mozilla/5.0 (compatible; the-stall/3.88; +https://intuitek.ai)";
const TIMEOUT   = 12000;

function parseOptionSymbol(sym, tickerLen) {
  // Format: {TICKER}{YYMMDD}{C|P}{strike×1000 8-digit}
  const dateStr = sym.slice(tickerLen, tickerLen + 6);
  const yy = dateStr.slice(0, 2);
  const mm = dateStr.slice(2, 4);
  const dd = dateStr.slice(4, 6);
  const expiry = `20${yy}-${mm}-${dd}`;
  const type   = sym.slice(tickerLen + 6, tickerLen + 7); // C or P
  const strike = parseInt(sym.slice(tickerLen + 7), 10) / 1000;
  return { expiry, type, strike };
}

export default {
  name:  "options-snapshot",
  price: "$0.035",

  description:
    "Options intelligence snapshot for any US equity — IV30, put/call volume ratio, top calls and puts by trading volume, and unusual-volume flags. Free CBOE delayed data (15-min delay during trading hours), no API key required. Complements us-stock-price and equity-technicals with the options-layer sentiment layer agents need for complete trade context. $0.015/call.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type:        "string",
        description: "US equity ticker symbol (e.g. AAPL, TSLA, NVDA, SPY). Case-insensitive.",
      },
      top_n: {
        type:        "integer",
        minimum:     1,
        maximum:     10,
        description: "Number of top calls and top puts to return (by volume). Default: 5.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:             { type: "string",  description: "Canonical ticker symbol." },
      current_price:      { type: "number",  description: "Current underlying price." },
      price_change_pct:   { type: "number",  description: "Intraday price change percentage." },
      iv30:               { type: "number",  description: "30-day implied volatility (CBOE methodology)." },
      iv30_change_pct:    { type: "number",  description: "IV30 change percentage vs prior day." },
      put_call_ratio:     { type: "number",  description: "Put/call volume ratio. >1.0 = bearish skew; <1.0 = bullish skew." },
      total_volume:       { type: "integer", description: "Total options volume today." },
      call_volume:        { type: "integer", description: "Total call volume today." },
      put_volume:         { type: "integer", description: "Total put volume today." },
      total_open_interest:{ type: "integer", description: "Total open interest across all contracts." },
      expiry_dates:       { type: "array",   description: "Next 6 expiration dates (YYYY-MM-DD)." },
      top_calls:          { type: "array",   description: "Top calls by volume (up to top_n)." },
      top_puts:           { type: "array",   description: "Top puts by volume (up to top_n)." },
      unusual_volume:     { type: "array",   description: "Options where volume exceeds open interest by 2× or more (unusual activity flags)." },
      data_delay_min:     { type: "integer", description: "Data delay in minutes (15 during market hours)." },
      ts:                 { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const raw    = (query.ticker || "AAPL").trim();
    const ticker = raw.toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
    if (!ticker) throw new Error("invalid ticker symbol");
    const topN = Math.min(Math.max(query.top_n || 5, 1), 10);

    let json;
    try {
      const res = await fetch(`${CBOE_BASE}/${encodeURIComponent(ticker)}.json`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal:  AbortSignal.timeout(TIMEOUT),
      });
      if (res.status === 404 || res.status === 403) throw new Error(`no options data found for ticker "${ticker}" — verify ticker is a CBOE-listed US equity`);
      if (!res.ok) throw new Error(`CBOE HTTP ${res.status}`);
      json = await res.json();
    } catch (err) {
      if (err.message.includes("no options data found")) throw err;
      throw new Error(`upstream fetch failed: ${err.message}`);
    }

    const d = json?.data;
    if (!d) throw new Error(`unexpected CBOE response for "${ticker}"`);

    const opts       = d.options || [];
    const tickerLen  = ticker.length;

    // ── Parse all options, split calls/puts ──────────────────────────────────
    const parsed = opts.map(o => {
      const { expiry, type, strike } = parseOptionSymbol(o.option, tickerLen);
      return { ...o, expiry, type, strike };
    });

    const calls = parsed.filter(o => o.type === "C");
    const puts  = parsed.filter(o => o.type === "P");

    // ── Volume and open interest aggregates ─────────────────────────────────
    const callVol = calls.reduce((s, o) => s + (o.volume || 0), 0);
    const putVol  = puts.reduce((s, o) => s + (o.volume || 0), 0);
    const totalVol = callVol + putVol;
    const totalOI  = parsed.reduce((s, o) => s + (o.open_interest || 0), 0);
    const pcRatio  = callVol > 0 ? parseFloat((putVol / callVol).toFixed(3)) : null;

    // ── Expiration dates (sorted, unique, next 6) ────────────────────────────
    const expirySet = [...new Set(parsed.map(o => o.expiry))].sort();
    const expiryDates = expirySet.slice(0, 6);

    // ── Top calls / puts by volume ───────────────────────────────────────────
    function formatTop(arr, n) {
      return arr
        .filter(o => (o.volume || 0) > 0)
        .sort((a, b) => (b.volume || 0) - (a.volume || 0))
        .slice(0, n)
        .map(o => ({
          option:        o.option,
          expiry:        o.expiry,
          strike:        o.strike,
          bid:           o.bid           ?? null,
          ask:           o.ask           ?? null,
          last:          o.last_trade_price ?? null,
          iv:            o.iv            != null ? parseFloat(o.iv.toFixed(4)) : null,
          delta:         o.delta         != null ? parseFloat(o.delta.toFixed(4)) : null,
          volume:        o.volume        || 0,
          open_interest: o.open_interest || 0,
          change:        o.change        ?? null,
        }));
    }

    const topCalls = formatTop(calls, topN);
    const topPuts  = formatTop(puts,  topN);

    // ── Unusual volume: volume ≥ 2× open_interest (and volume > 0) ──────────
    const unusual = parsed
      .filter(o => {
        const vol = o.volume || 0;
        const oi  = o.open_interest || 0;
        return vol > 0 && oi > 0 && vol >= oi * 2;
      })
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, 8)
      .map(o => ({
        option:        o.option,
        type:          o.type === "C" ? "call" : "put",
        expiry:        o.expiry,
        strike:        o.strike,
        volume:        o.volume        || 0,
        open_interest: o.open_interest || 0,
        vol_oi_ratio:  o.open_interest > 0
          ? parseFloat((o.volume / o.open_interest).toFixed(1))
          : null,
        iv:            o.iv != null ? parseFloat(o.iv.toFixed(4)) : null,
      }));

    return {
      ticker,
      current_price:       d.current_price       ?? null,
      price_change_pct:    d.price_change_percent ?? null,
      iv30:                d.iv30                 ?? null,
      iv30_change_pct:     d.iv30_change_percent  ?? null,
      put_call_ratio:      pcRatio,
      total_volume:        totalVol,
      call_volume:         callVol,
      put_volume:          putVol,
      total_open_interest: totalOI,
      expiry_dates:        expiryDates,
      top_calls:           topCalls,
      top_puts:            topPuts,
      unusual_volume:      unusual,
      data_delay_min:      15,
      ts:                  new Date().toISOString(),
    };
  },
};
