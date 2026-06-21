// options-chain.js
//
// CBOE delayed options chain for any US equity or index.
// No API key. No auth. Delayed ~15 min during market hours; real-time after close.
//
// Source: cdn.cboe.com delayed quotes API (free, no key required).
// Returns stock price, per-option IV, delta, gamma, theta, vega, rho,
// open interest, volume, and bid/ask for all listed strikes and expirations.
//
// Seam: Bloomberg options feed $200+/mo; Polygon.io options $79+/mo;
// Tradier $10+/mo; CBOE free delayed covers 3,700+ contracts per major ticker.
//
// [REDACTED]3, 2026-06-07.

const CBOE_BASE = "https://cdn.cboe.com/api/global/delayed_quotes/options";
const TMO       = 15_000;
const UA        = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";

const TX_CODE_MAP = { C: "call", P: "put" };

function r2(n) {
  return n != null && isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function r4(n) {
  return n != null && isFinite(n) ? Math.round(n * 10000) / 10000 : null;
}

// Option symbol: {TICKER}{YYMMDD}{C|P}{STRIKE_8DIGIT}
// Suffix is always exactly 15 chars: 6 date + 1 type + 8 strike
function parseSymbol(sym) {
  const suffix = sym.slice(sym.length - 15);
  const exp = `20${suffix.slice(0, 2)}-${suffix.slice(2, 4)}-${suffix.slice(4, 6)}`;
  const type = suffix[6] === "C" ? "call" : "put";
  const strike = parseInt(suffix.slice(7), 10) / 1000;
  return { exp, type, strike };
}

function dte(expStr) {
  const now = new Date();
  const exp = new Date(expStr + "T00:00:00Z");
  return Math.round((exp - now) / 86_400_000);
}

function computeIV30(byExp) {
  // Weighted average IV of options within 20-40 DTE — proxy for VIX-style IV30
  const targets = Object.entries(byExp).filter(([, info]) => {
    return info.dte >= 20 && info.dte <= 40;
  });
  if (!targets.length) {
    // Fallback: nearest expiry with >0 DTE
    const near = Object.entries(byExp)
      .filter(([, info]) => info.dte > 0)
      .sort((a, b) => a[1].dte - b[1].dte)[0];
    if (!near) return null;
    targets.push(near);
  }
  let totalIV = 0, count = 0;
  for (const [, info] of targets) {
    for (const opt of [...info.calls, ...info.puts]) {
      if (opt.iv > 0) { totalIV += opt.iv; count++; }
    }
  }
  return count ? r4(totalIV / count) : null;
}

export default {
  name:  "options-chain",
  price: "$0.039",

  description:
    "CBOE delayed options chain for any US equity or index — returns stock price, per-contract IV, greeks (delta/gamma/theta/vega), OI, volume, and bid/ask. Filterable by expiration date and call/put. Free CBOE data, no API key.",

  inputSchema: {
    type:     "object",
    required: [],
    properties: {
      ticker: {
        type:        "string",
        description: "US equity or index ticker. Examples: AAPL, SPY, QQQ, TSLA, NVDA.",
        minLength:   1,
        maxLength:   10,
      },
      exp: {
        type:        "string",
        description: "Filter to a specific expiration date YYYY-MM-DD. Omit to return the nearest max_expirations dates.",
        pattern:     "^\\d{4}-\\d{2}-\\d{2}$",
      },
      type: {
        type:        "string",
        enum:        ["call", "put"],
        description: "Filter by option type. Omit to return both calls and puts.",
      },
      near_atm_only: {
        type:        "boolean",
        description: "If true, only return strikes within 20% of the current underlying price. Default false.",
        default:     false,
      },
      max_expirations: {
        type:        "integer",
        description: "Maximum number of expiration dates to include when no specific exp is set. Default 4, max 12.",
        default:     4,
        minimum:     1,
        maximum:     12,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:     { type: "string" },
      timestamp:  { type: "string" },
      underlying: {
        type: "object",
        properties: {
          price:      { type: "number" },
          bid:        { type: "number" },
          ask:        { type: "number" },
          change:     { type: "number" },
          change_pct: { type: "number" },
          open:       { type: ["number", "null"] },
          high:       { type: ["number", "null"] },
          low:        { type: ["number", "null"] },
        },
      },
      iv30: {
        type:        ["number", "null"],
        description: "Weighted average IV across ~30-DTE options (proxy for 30-day implied vol).",
      },
      expirations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            exp:   { type: "string" },
            dte:   { type: "integer", description: "Days to expiration from now" },
            calls: { type: "array" },
            puts:  { type: "array" },
          },
        },
      },
      total_strikes_returned: { type: "integer" },
      source:    { type: "string" },
      note:      { type: "string" },
    },
  },

  async handler({ ticker = "AAPL", exp, type, near_atm_only = false, max_expirations = 4 }) {
    const sym = ticker.trim().toUpperCase();
    if (!/^[A-Z.$\^]{1,10}$/.test(sym)) {
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

    const d  = raw.data;
    const ts = raw.timestamp ?? new Date().toISOString();
    const spotPrice = d.current_price;

    // Parse all options into a map keyed by expiry
    const byExp = {};
    for (const o of d.options ?? []) {
      const { exp: oExp, type: oType, strike } = parseSymbol(o.option);

      // Apply filters
      if (exp && oExp !== exp) continue;
      if (type && oType !== type) continue;
      if (near_atm_only) {
        const pct = Math.abs(strike - spotPrice) / spotPrice;
        if (pct > 0.20) continue;
      }

      if (!byExp[oExp]) {
        byExp[oExp] = { dte: dte(oExp), calls: [], puts: [] };
      }

      const contract = {
        strike,
        bid:         r2(o.bid),
        ask:         r2(o.ask),
        last:        r2(o.last_trade_price),
        iv:          r4(o.iv),
        delta:       r4(o.delta),
        gamma:       r4(o.gamma),
        theta:       r4(o.theta),
        vega:        r4(o.vega),
        rho:         r4(o.rho),
        oi:          o.open_interest ?? 0,
        volume:      o.volume ?? 0,
        change:      r2(o.change),
        prev_close:  r2(o.prev_day_close),
      };

      byExp[oExp][oType === "call" ? "calls" : "puts"].push(contract);
    }

    // Sort strikes within each expiry
    for (const info of Object.values(byExp)) {
      info.calls.sort((a, b) => a.strike - b.strike);
      info.puts.sort((a, b) => a.strike - b.strike);
    }

    // Select expirations to return
    let expKeys = Object.keys(byExp).sort();
    if (!exp) {
      // Filter out expired and limit
      expKeys = expKeys.filter(k => byExp[k].dte >= 0).slice(0, max_expirations);
    }

    const iv30 = computeIV30(byExp);

    const expirations = expKeys.map(k => ({
      exp:   k,
      dte:   byExp[k].dte,
      calls: type === "put" ? [] : byExp[k].calls,
      puts:  type === "call" ? [] : byExp[k].puts,
    }));

    const totalStrikes = expirations.reduce(
      (s, e) => s + e.calls.length + e.puts.length, 0
    );

    return {
      ticker:    sym,
      timestamp: ts,
      underlying: {
        price:      r2(d.current_price),
        bid:        r2(d.bid),
        ask:        r2(d.ask),
        change:     r2(d.price_change),
        change_pct: r2(d.price_change_percent),
        open:       r2(d.open) ?? null,
        high:       r2(d.high) ?? null,
        low:        r2(d.low) ?? null,
      },
      iv30,
      expirations,
      total_strikes_returned: totalStrikes,
      source: "CBOE delayed quotes — ~15 min delay during market hours",
      note:   exp ? null : `Showing ${expKeys.length} nearest expiration(s). Use max_expirations up to 12 or set exp= for a specific date.`,
    };
  },
};
