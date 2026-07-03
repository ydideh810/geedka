// earnings-intel-bundle.js
//
// Composite earnings intelligence for any US equity in one x402 call.
// Returns upcoming earnings dates, EPS surprise history, fundamental
// valuations, and current Fed rate context — the four-cap workflow used
// by production earnings-research pipelines, collapsed to one payment.
//
// Constituent caps:
//   earnings-calendar   $0.001  — upcoming report dates, EPS estimates
//   earnings-surprises  $0.059  — beat/miss history, surprise %, trend
//   equity-fundamentals $0.059  — P/E, EV/EBITDA, margins, FCF, debt/equity
//   fomc-tracker        $0.008  — current fed funds rate, next FOMC date
//
// Combined price if called separately: ~$0.127
// Bundle price: $0.080 (~37% discount)
//
// Seam: observed usage pattern from payer #2 — earnings-calendar×39,
// equity-fundamentals×4, earnings-surprises×3, fomc-tracker×3 across
// Jun21–Jun26. This bundle locks in that workflow at one billable point.

import calendarCap     from './earnings-calendar.js';
import surprisesCap    from './earnings-surprises.js';
import fundamentalsCap from './equity-fundamentals.js';
import fomcCap         from './fomc-tracker.js';

export default {
  name: "earnings-intel-bundle",
  price: "$0.080",

  description:
    "Full earnings intelligence for a US stock in one call: next earnings date + EPS estimates, historical EPS beat/miss data, fundamental valuations (P/E, EV/EBITDA, margins), and current FOMC rate context. Replaces 4 separate cap calls at ~37% discount.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US stock ticker symbol (e.g. AAPL, MSFT, NVDA).",
      },
      days_ahead: {
        type: "integer",
        description: "Look-ahead window for earnings calendar (1–90 days, default 30).",
        default: 30,
      },
    },
    required: ["ticker"],
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:           { type: "string" },
      earnings_calendar: { type: "object", description: "Upcoming earnings dates from earnings-calendar (filtered to ticker)." },
      earnings_surprises: { type: "object", description: "EPS beat/miss history from earnings-surprises." },
      fundamentals:     { type: "object", description: "Valuation metrics from equity-fundamentals." },
      fomc:             { type: "object", description: "Current fed funds rate and next meeting from fomc-tracker." },
      errors:           { type: "object", description: "Any per-source errors (non-fatal; other fields still populated)." },
      as_of:            { type: "string" },
    },
    required: ["ticker", "as_of"],
  },

  async handler(query) {
    const ticker    = (query.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
    const daysAhead = Math.min(90, Math.max(1, Number(query.days_ahead) || 30));

    if (!ticker) throw new Error("ticker is required");

    const errors = {};

    const [calResult, surResult, funResult, fomcResult] = await Promise.allSettled([
      calendarCap.handler({ symbol: ticker, days_ahead: daysAhead, limit: 10 }),
      surprisesCap.handler({ ticker }),
      fundamentalsCap.handler({ ticker }),
      fomcCap.handler({}),
    ]);

    function extract(settled, key) {
      if (settled.status === "fulfilled") return settled.value;
      errors[key] = settled.reason?.message || String(settled.reason);
      return null;
    }

    return {
      ticker,
      earnings_calendar:  extract(calResult,  "earnings_calendar"),
      earnings_surprises: extract(surResult,  "earnings_surprises"),
      fundamentals:       extract(funResult,  "fundamentals"),
      fomc:               extract(fomcResult, "fomc"),
      ...(Object.keys(errors).length ? { errors } : {}),
      as_of: new Date().toISOString(),
    };
  },
};
