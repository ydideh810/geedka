// labor-market.js
//
// Returns US labor market leading indicators: initial jobless claims, continued
// claims, JOLTS job openings, nonfarm payrolls, labor force participation rate,
// average hourly earnings (with YoY wage growth), and unemployed persons.
// Sourced from FRED public CSV — no API key, updated weekly/monthly.
// Priced at $0.008.
//
// Seam: macro-indicators covers headline unemployment rate and Fed policy;
// this cap fills the leading-indicator layer above it. Initial claims lead the
// unemployment rate by 2–4 weeks. JOLTS openings measure labor demand pressure.
// Wage growth (YoY) is the Fed's primary wage-inflation signal. An agent pricing
// labor costs, forecasting consumer spending, or assessing Fed dovishness needs
// all of these in a single call rather than assembling them from equity signals.
//
// Derived metrics:
//   wage_growth_yoy_pct — AHETPI current vs same month prior year (wage inflation)
//   openings_per_unemployed — JOLTS openings ÷ unemployed persons (Beveridge curve
//     ratio; >1.0 = more openings than job-seekers; <1.0 = slack labor market)
//
// Free upstream: FRED (fred.stlouisfed.org) public CSV — same no-auth path
// used by macro-indicators and credit-spreads.

const FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const UA        = "Mozilla/5.0 (compatible; the-stall/0.4; +https://intuitek.ai)";
const sleep     = (ms) => new Promise(r => setTimeout(r, ms));

async function fredGet(id) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(`${FRED_BASE}?id=${id}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) throw new Error(`FRED ${id} returned ${resp.status}`);
      return await resp.text();
    } catch (e) {
      if (attempt === 0) await sleep(1500);
      else throw e;
    }
  }
}

function parseLatest(text) {
  const lines = text.trim().split("\n").filter(l => !l.startsWith("DATE") && l.includes(","));
  for (let i = lines.length - 1; i >= 0; i--) {
    const [date, val] = lines[i].split(",");
    if (val && val.trim() !== "." && val.trim() !== "") {
      return { date: date.trim(), value: parseFloat(val.trim()) };
    }
  }
  return null;
}

function parseLastN(text, n) {
  const lines   = text.trim().split("\n").filter(l => !l.startsWith("DATE") && l.includes(","));
  const results = [];
  for (let i = lines.length - 1; i >= 0 && results.length < n; i--) {
    const [date, val] = lines[i].split(",");
    if (val && val.trim() !== "." && val.trim() !== "") {
      results.unshift({ date: date.trim(), value: parseFloat(val.trim()) });
    }
  }
  return results;
}

// Returns { date, value } for the most recent non-missing observation.
async function fetchLatest(id) {
  return parseLatest(await fredGet(id));
}

// Returns an array of { date, value } for the last `n` non-missing obs.
async function fetchLastN(id, n) {
  return parseLastN(await fredGet(id), n);
}

const round2 = (n) => Math.round(n * 100) / 100;

export default {
  name: "labor-market",
  price: "$0.008",

  description:
    "Returns US labor market leading indicators from FRED (free, no API key): initial jobless claims (weekly), continued claims, JOLTS job openings, nonfarm payrolls, labor force participation rate, average hourly earnings with YoY wage growth, and the openings-per-unemployed Beveridge curve ratio. Pairs with macro-indicators for the complete employment picture.",

  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      initial_claims:             { type: "number", description: "Initial jobless claims, seasonally adjusted (thousands). Weekly; most recent Thursday release." },
      initial_claims_date:        { type: "string", description: "Reference week ending date for initial claims (YYYY-MM-DD)." },
      continued_claims:           { type: "number", description: "Continued claims (insured unemployment), SA (thousands). One week lagged vs initial claims." },
      continued_claims_date:      { type: "string", description: "Reference date for continued claims (YYYY-MM-DD)." },
      jolts_openings:             { type: "number", description: "JOLTS job openings (thousands). Monthly; measures labor demand." },
      jolts_openings_date:        { type: "string", description: "Survey month for JOLTS openings (YYYY-MM-DD)." },
      nonfarm_payrolls:           { type: "number", description: "Total nonfarm payroll employment (thousands). Monthly; net jobs added/lost." },
      nonfarm_payrolls_date:      { type: "string", description: "Reference month for nonfarm payrolls (YYYY-MM-DD)." },
      participation_rate:         { type: "number", description: "Labor force participation rate (%). Share of civilian noninstitutional population in labor force." },
      participation_date:         { type: "string", description: "Reference month for participation rate (YYYY-MM-DD)." },
      avg_hourly_earnings:        { type: "number", description: "Average hourly earnings, all private employees ($). Monthly." },
      avg_hourly_earnings_date:   { type: "string", description: "Reference month for avg hourly earnings (YYYY-MM-DD)." },
      wage_growth_yoy_pct:        { type: "number", description: "Average hourly earnings year-over-year change (%). Wage inflation signal watched by the Fed." },
      unemployed_persons:         { type: "number", description: "Unemployed persons (thousands). Monthly; from CPS household survey." },
      unemployed_date:            { type: "string", description: "Reference month for unemployed persons (YYYY-MM-DD)." },
      openings_per_unemployed:    { type: "number", description: "JOLTS openings ÷ unemployed persons. >1.0 = more jobs than seekers (tight); <1.0 = labor market slack. Beveridge curve demand/supply ratio." },
      ts:                         { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(_query) {
    // Fetch in two batches to stay within FRED's concurrent-connection tolerance.
    // Batch 1: weekly leading indicators + payrolls
    const [rIcsa, rCcsa, rJolts, rPayems] = await Promise.all([
      fetchLatest("ICSA"),
      fetchLatest("CCSA"),
      fetchLatest("JTSJOL"),
      fetchLatest("PAYEMS"),
    ]);
    // Batch 2: participation, wages (needs trailing 14 for YoY), unemployed level
    const [rCivpart, rAhetpiArr, rUnemp] = await Promise.all([
      fetchLatest("CIVPART"),
      fetchLastN("AHETPI", 14),
      fetchLatest("UNEMPLOY"),
    ]);

    // Wage YoY: most recent vs 12 months prior
    let avg_hourly_earnings   = null;
    let avg_hourly_earnings_date = null;
    let wage_growth_yoy_pct   = null;

    if (rAhetpiArr.length >= 13) {
      const current  = rAhetpiArr[rAhetpiArr.length - 1];
      const yearAgo  = rAhetpiArr[rAhetpiArr.length - 13];  // 12 months back
      avg_hourly_earnings      = round2(current.value);
      avg_hourly_earnings_date = current.date;
      if (yearAgo && yearAgo.value) {
        wage_growth_yoy_pct = round2(((current.value - yearAgo.value) / yearAgo.value) * 100);
      }
    } else if (rAhetpiArr.length > 0) {
      const current = rAhetpiArr[rAhetpiArr.length - 1];
      avg_hourly_earnings      = round2(current.value);
      avg_hourly_earnings_date = current.date;
    }

    // Beveridge curve ratio: openings (thousands) ÷ unemployed (thousands)
    let openings_per_unemployed = null;
    if (rJolts && rUnemp && rUnemp.value > 0) {
      openings_per_unemployed = round2(rJolts.value / rUnemp.value);
    }

    return {
      initial_claims:           rIcsa   ? rIcsa.value      : null,
      initial_claims_date:      rIcsa   ? rIcsa.date       : null,
      continued_claims:         rCcsa   ? rCcsa.value      : null,
      continued_claims_date:    rCcsa   ? rCcsa.date       : null,
      jolts_openings:           rJolts  ? rJolts.value     : null,
      jolts_openings_date:      rJolts  ? rJolts.date      : null,
      nonfarm_payrolls:         rPayems ? rPayems.value    : null,
      nonfarm_payrolls_date:    rPayems ? rPayems.date     : null,
      participation_rate:       rCivpart? rCivpart.value   : null,
      participation_date:       rCivpart? rCivpart.date    : null,
      avg_hourly_earnings,
      avg_hourly_earnings_date,
      wage_growth_yoy_pct,
      unemployed_persons:       rUnemp  ? rUnemp.value     : null,
      unemployed_date:          rUnemp  ? rUnemp.date      : null,
      openings_per_unemployed,
      ts: new Date().toISOString(),
    };
  },
};
