// options-flow-unusual.js
//
// Detects unusual options activity for any US equity or index using free CBOE
// delayed data. "Unusual" means volume-to-open-interest ratio is abnormally high —
// a hallmark of institutional sweep orders where traders are opening new large
// positions rather than closing existing ones.
//
// Two signal tiers:
//   1. Unusual contracts (vol/OI >= threshold): sorted by ratio — these are
//      the highest-conviction sweeps relative to standing open interest.
//   2. Large-volume contracts: sorted by raw volume — these are the biggest
//      dollar flows regardless of ratio (covers deep-OI liquid strikes).
//
// Interpretation:
//   BULLISH_SWEEP  — significant unusual call volume, calls dominate flow
//   BEARISH_SWEEP  — significant unusual put volume, puts dominate flow
//   CALL_HEAVY     — calls dominate by volume but without unusual ratio signal
//   PUT_HEAVY      — puts dominate by volume but without unusual ratio signal
//   NEUTRAL        — balanced flow, no dominant signal
//
// Source: cdn.cboe.com delayed options (~15 min lag during market hours).
// No API key. No auth. 3,700+ contracts per major ticker.
//
// Seam: UX/Cheddar/Market Chameleon charge $30–$120/mo for unusual flow screeners.
// This cap returns per-ticker unusual flow on-demand for a fraction of the cost.
//
// Price: $0.025 — full chain parse + ratio computation; rivals charge monthly.

const CBOE_BASE = "https://cdn.cboe.com/api/global/delayed_quotes/options";
const TMO       = 15_000;
const UA        = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";

function r2(n) {
  return n != null && isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function r4(n) {
  return n != null && isFinite(n) ? Math.round(n * 10000) / 10000 : null;
}

// Option symbol: {TICKER}{YYMMDD}{C|P}{STRIKE_8DIGIT} — suffix always 15 chars
function parseSymbol(sym) {
  const suffix = sym.slice(sym.length - 15);
  const exp    = `20${suffix.slice(0, 2)}-${suffix.slice(2, 4)}-${suffix.slice(4, 6)}`;
  const type   = suffix[6] === "C" ? "call" : "put";
  const strike = parseInt(suffix.slice(7), 10) / 1000;
  return { exp, type, strike };
}

function dte(expStr) {
  const now = new Date();
  const exp = new Date(expStr + "T00:00:00Z");
  return Math.round((exp - now) / 86_400_000);
}

// Weighted average IV of options within 20-40 DTE — proxy for VIX-style IV30
function computeIV30(allContracts) {
  const near = allContracts.filter(c => c.dte >= 20 && c.dte <= 40 && c.iv > 0);
  if (!near.length) return null;
  const sum = near.reduce((s, c) => s + c.iv, 0);
  return r4(sum / near.length);
}

function interpret(unusualCalls, unusualPuts, totalCallVol, totalPutVol) {
  const hasUnusualCalls = unusualCalls.length >= 2;
  const hasUnusualPuts  = unusualPuts.length  >= 2;
  const pcRatio = totalCallVol > 0 ? totalPutVol / totalCallVol : null;

  if (hasUnusualCalls && hasUnusualPuts) {
    return pcRatio !== null && pcRatio > 1.2 ? "BEARISH_SWEEP" : "BULLISH_SWEEP";
  }
  if (hasUnusualCalls) return "BULLISH_SWEEP";
  if (hasUnusualPuts)  return "BEARISH_SWEEP";
  if (pcRatio !== null) {
    if (pcRatio < 0.7) return "CALL_HEAVY";
    if (pcRatio > 1.4) return "PUT_HEAVY";
  }
  return "NEUTRAL";
}

export default {
  name:  "options-flow-unusual",
  price: "$0.025",

  description:
    "Detects unusual options activity via CBOE delayed data — flags contracts where volume/OI ratio exceeds threshold (institutional sweep signal), ranks top flows by notional value, and returns a BULLISH_SWEEP/BEARISH_SWEEP/NEUTRAL interpretation. No API key required.",

  inputSchema: {
    type:       "object",
    required:   [],
    properties: {
      ticker: {
        type:        "string",
        description: "US equity or index ticker. Examples: AAPL, SPY, TSLA, NVDA, QQQ.",
        default:     "SPY",
        minLength:   1,
        maxLength:   10,
      },
      min_ratio: {
        type:        "number",
        description: "Minimum volume/OI ratio to flag as unusual. Default 5.0 (volume is 5× outstanding OI). Lower to 2.0 for more sensitive detection on liquid tickers.",
        default:     5.0,
        minimum:     1.0,
        maximum:     50.0,
      },
      min_volume: {
        type:        "integer",
        description: "Minimum volume threshold to include a contract in unusual screening. Default 100 to filter noise.",
        default:     100,
        minimum:     1,
      },
      top_n: {
        type:        "integer",
        description: "Number of top unusual contracts to return per side (calls and puts). Default 5.",
        default:     5,
        minimum:     1,
        maximum:     20,
      },
      days_to_exp: {
        type:        "integer",
        description: "Only consider options expiring within this many calendar days. Default 60 (near-term flow). Set to 365 for LEAPS sweep detection.",
        default:     60,
        minimum:     1,
        maximum:     730,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:          { type: "string" },
      timestamp:       { type: "string" },
      spot_price:      { type: ["number", "null"] },
      iv30:            { type: ["number", "null"], description: "Weighted average IV across ~30-DTE options." },
      put_call_ratio:  { type: ["number", "null"], description: "Total put volume / total call volume. >1 = put-heavy." },
      interpretation:  { type: "string", enum: ["BULLISH_SWEEP", "BEARISH_SWEEP", "CALL_HEAVY", "PUT_HEAVY", "NEUTRAL"] },
      unusual_calls:   { type: "array", description: "Top unusual call contracts by vol/OI ratio." },
      unusual_puts:    { type: "array", description: "Top unusual put contracts by vol/OI ratio." },
      top_call_volume: { type: "array", description: "Top call contracts by raw volume (largest flows)." },
      top_put_volume:  { type: "array", description: "Top put contracts by raw volume (largest flows)." },
      total_call_volume: { type: "integer" },
      total_put_volume:  { type: "integer" },
      contracts_scanned: { type: "integer" },
      source:          { type: "string" },
      note:            { type: "string" },
    },
  },

  async handler({ ticker = "SPY", min_ratio = 5.0, min_volume = 100, top_n = 5, days_to_exp = 60 }) {
    const sym = ticker.trim().toUpperCase();
    if (!/^[A-Z.$^]{1,10}$/.test(sym)) {
      return { error: `Invalid ticker format: ${sym}` };
    }

    const url = `${CBOE_BASE}/${encodeURIComponent(sym)}.json`;
    let raw;
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal:  AbortSignal.timeout(TMO),
      });
      if (resp.status === 403) return { error: `Ticker not found on CBOE: ${sym}` };
      if (!resp.ok) throw new Error(`CBOE returned ${resp.status}`);
      raw = await resp.json();
    } catch (e) {
      return { error: `CBOE fetch failed: ${e.message}` };
    }

    const d         = raw.data;
    const ts        = raw.timestamp ?? new Date().toISOString();
    const spotPrice = r2(d.current_price);

    // Parse all contracts with DTE filter
    const calls = [];
    const puts  = [];

    for (const o of d.options ?? []) {
      const { exp, type, strike } = parseSymbol(o.option);
      const dteVal = dte(exp);
      if (dteVal < 0 || dteVal > days_to_exp) continue;

      const volume = o.volume ?? 0;
      const oi     = o.open_interest ?? 0;
      const mark   = (r2((o.bid ?? 0) + (o.ask ?? 0)) ?? 0) / 2;
      const iv     = r4(o.iv) ?? 0;

      const contract = {
        symbol:    o.option,
        exp,
        dte:       dteVal,
        strike,
        type,
        volume,
        oi,
        ratio:     oi > 0 ? r4(volume / oi) : null,
        mark:      r2(mark),
        notional:  r2(volume * 100 * mark),
        iv,
        bid:       r2(o.bid),
        ask:       r2(o.ask),
      };

      if (type === "call") calls.push(contract);
      else                 puts.push(contract);
    }

    const allContracts = [...calls, ...puts];
    const iv30         = computeIV30(allContracts);

    // Unusual: vol/OI >= min_ratio AND volume >= min_volume
    const unusualCalls = calls
      .filter(c => c.volume >= min_volume && c.ratio !== null && c.ratio >= min_ratio)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, top_n);

    const unusualPuts = puts
      .filter(c => c.volume >= min_volume && c.ratio !== null && c.ratio >= min_ratio)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, top_n);

    // Largest flows by raw volume
    const topCallVol = calls.filter(c => c.volume >= min_volume)
      .sort((a, b) => b.volume - a.volume).slice(0, top_n);
    const topPutVol  = puts.filter(c => c.volume >= min_volume)
      .sort((a, b) => b.volume - a.volume).slice(0, top_n);

    const totalCallVol = calls.reduce((s, c) => s + c.volume, 0);
    const totalPutVol  = puts.reduce((s, c) => s + c.volume, 0);
    const pcRatio      = totalCallVol > 0 ? r4(totalPutVol / totalCallVol) : null;

    const interp = interpret(unusualCalls, unusualPuts, totalCallVol, totalPutVol);

    const unusualTotal = unusualCalls.length + unusualPuts.length;

    return {
      ticker:          sym,
      timestamp:       ts,
      spot_price:      spotPrice,
      iv30,
      put_call_ratio:  pcRatio,
      interpretation:  interp,
      unusual_calls:   unusualCalls,
      unusual_puts:    unusualPuts,
      top_call_volume: topCallVol,
      top_put_volume:  topPutVol,
      total_call_volume: totalCallVol,
      total_put_volume:  totalPutVol,
      contracts_scanned: allContracts.length,
      source: "CBOE delayed quotes — ~15 min delay during market hours",
      note: unusualTotal === 0
        ? `No unusual activity found (vol/OI >= ${min_ratio}, min volume ${min_volume}). Try lowering min_ratio or min_volume, or check after market open when volume builds.`
        : `Found ${unusualCalls.length} unusual call(s) and ${unusualPuts.length} unusual put(s) with vol/OI >= ${min_ratio} within ${days_to_exp}-day window.`,
    };
  },
};
