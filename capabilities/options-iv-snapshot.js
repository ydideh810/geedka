// options-iv-snapshot.js
//
// Options implied volatility snapshot for any US equity: IV30 (CBOE 30-day
// implied vol), IV change, expected move for nearest and next-nearest expiry
// from ATM straddle pricing, and options-derived sentiment (call/put volume
// skew and put/call open interest ratio).
//
// Seam: equity-research agents tracking earnings run earnings-calendar +
// earnings-estimates to know the when, then need the market's implied move
// expectation (ATM straddle / spot) to set probability assumptions before
// entry. Currently no options cap exists; researchers must estimate externally.
//
// Active payer signal: 0x63E402 runs earnings-calendar (35x) + fomc-tracker
// + equity-fundamentals. Adding expected-move-pct closes the pre-earnings
// decision circuit.
//
// Upstream: cdn.cboe.com/api/global/delayed_quotes/options/{TICKER}.json
// Free, no auth, delayed ~15 min. Returns iv30, full chain with per-leg IV.
// 403 on bad ticker (handled as ticker_not_found).
// Priced at $0.025.

const CBOE_BASE = "https://cdn.cboe.com/api/global/delayed_quotes/options";
const TMO       = 12_000;

function r2(n) { return n != null ? Math.round(n * 100) / 100 : null; }
function r4(n) { return n != null ? Math.round(n * 10000) / 10000 : null; }
function pct(n) { return n != null ? r2(n * 100) : null; }

function mid(bid, ask) {
  if (bid == null || ask == null) return null;
  return (bid + ask) / 2;
}

// Parse YYMMDD from CBOE option symbol e.g. "AAPL260624C00225000"
function parseExpiry(optSym) {
  const m = optSym.match(/[A-Z]+(\d{6})[CP]/);
  if (!m) return null;
  const yy = m[1].slice(0, 2);
  const mm = m[1].slice(2, 4);
  const dd = m[1].slice(4, 6);
  return `20${yy}-${mm}-${dd}`;
}

function isCall(optSym) { return optSym.includes("C0"); }
function isPut(optSym)  { return optSym.includes("P0"); }

// Parse strike from CBOE symbol: last 8 digits / 1000
function parseStrike(optSym) {
  const m = optSym.match(/[CP](\d{8})$/);
  if (!m) return null;
  return parseInt(m[1], 10) / 1000;
}

function buildExpectedMoveForExpiry(chain, spot) {
  // ATM straddle: call with strike closest to spot + matching put
  const strikes = [...new Set(chain.map(o => parseStrike(o.option)).filter(Boolean))];
  if (!strikes.length) return null;

  const atmStrike = strikes.reduce((best, s) =>
    Math.abs(s - spot) < Math.abs(best - spot) ? s : best, strikes[0]);

  const atmCall = chain.find(o => isCall(o.option) && parseStrike(o.option) === atmStrike);
  const atmPut  = chain.find(o => isPut(o.option)  && parseStrike(o.option) === atmStrike);

  const callMid = atmCall ? mid(atmCall.bid, atmCall.ask) : null;
  const putMid  = atmPut  ? mid(atmPut.bid,  atmPut.ask)  : null;
  if (callMid == null || putMid == null) return null;

  const straddlePrice = callMid + putMid;
  const expectedMovePct = r2((straddlePrice / spot) * 100);
  return { atm_strike: atmStrike, straddle_price: r2(straddlePrice), expected_move_pct: expectedMovePct };
}

export default {
  name: "options-iv-snapshot",
  price: "$0.025",
  description: "Options IV snapshot: CBOE IV30, expected move from ATM straddle (1st + 2nd expiry), P/C ratio. Completes pre-earnings decision workflow.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US equity ticker symbol (e.g. AAPL, NVDA, TSLA).",
      },
    },
    required: ["ticker"],
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:       { type: "string" },
      spot_price:   { type: "number" },
      iv30:         { type: "number", description: "30-day implied volatility from CBOE (annualized %)" },
      iv30_change:  { type: "number", description: "IV30 change from prior close" },
      iv30_change_pct: { type: "number" },
      sentiment: {
        type: "object",
        properties: {
          call_volume:     { type: "number" },
          put_volume:      { type: "number" },
          pc_volume_ratio: { type: "number", description: "Put/call volume ratio (<1 = bullish skew)" },
          call_oi:         { type: "number" },
          put_oi:          { type: "number" },
          pc_oi_ratio:     { type: "number", description: "Put/call open interest ratio" },
        },
      },
      nearest_expiry: {
        type: "object",
        properties: {
          expiry:           { type: "string" },
          atm_strike:       { type: "number" },
          straddle_price:   { type: "number" },
          expected_move_pct: { type: "number", description: "Market-implied ±move as % of spot" },
        },
      },
      next_expiry: {
        type: "object",
        description: "Same fields as nearest_expiry for the following expiry date.",
      },
      data_as_of:   { type: "string", description: "CBOE delayed-data timestamp" },
      retrieved_at: { type: "string" },
    },
  },

  async handler({ ticker }) {
    const sym = String(ticker).toUpperCase().trim();
    const url = `${CBOE_BASE}/${encodeURIComponent(sym)}.json`;

    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; the-stall/4.9; +https://intuitek.ai)" },
      signal: AbortSignal.timeout(TMO),
    });

    if (resp.status === 403 || resp.status === 404) {
      const err = new Error(`Ticker not found on CBOE: ${sym}`);
      err.status = 400;
      throw err;
    }
    if (!resp.ok) throw new Error(`CBOE returned ${resp.status}`);

    const body     = await resp.json();
    const data     = body.data      ?? {};
    const options  = data.options   ?? [];
    const spot     = data.current_price;
    const asOf     = body.timestamp ?? null;

    if (!spot) throw new Error("CBOE returned no price data");

    // Aggregate volume + OI across chain
    let callVol = 0, putVol = 0, callOI = 0, putOI = 0;
    for (const o of options) {
      const vol = o.volume ?? 0;
      const oi  = o.open_interest ?? 0;
      if (isCall(o.option)) { callVol += vol; callOI += oi; }
      else                  { putVol  += vol; putOI  += oi; }
    }

    // Collect unique expiry dates sorted ascending
    const expirySet = new Set();
    for (const o of options) {
      const exp = parseExpiry(o.option);
      if (exp) expirySet.add(exp);
    }
    const expiries = [...expirySet].sort();

    // Build expected-move blocks for nearest and next expiry
    function expiryBlock(expDate) {
      if (!expDate) return null;
      const chain = options.filter(o => parseExpiry(o.option) === expDate);
      const em    = buildExpectedMoveForExpiry(chain, spot);
      if (!em) return null;
      return { expiry: expDate, ...em };
    }

    const nearestExpiry = expiries[0] ?? null;
    const nextExpiry    = expiries[1] ?? null;

    return {
      ticker: sym,
      spot_price: r2(spot),
      iv30:            r2(data.iv30),
      iv30_change:     r2(data.iv30_change),
      iv30_change_pct: r2(data.iv30_change_percent),
      sentiment: {
        call_volume:     Math.round(callVol),
        put_volume:      Math.round(putVol),
        pc_volume_ratio: callVol > 0 ? r4(putVol / callVol) : null,
        call_oi:         Math.round(callOI),
        put_oi:          Math.round(putOI),
        pc_oi_ratio:     callOI > 0 ? r4(putOI / callOI) : null,
      },
      nearest_expiry: expiryBlock(nearestExpiry),
      next_expiry:    expiryBlock(nextExpiry),
      data_as_of:     asOf,
      retrieved_at:   new Date().toISOString(),
    };
  },
};
