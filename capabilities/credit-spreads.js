// credit-spreads.js
//
// Returns current US credit spreads: High Yield (HY) and Investment Grade (IG)
// option-adjusted spreads from ICE BofA indices, sourced via FRED public CSV
// — no API key, updated daily. Priced at $0.008.
//
// Seam: fills the credit-risk layer that treasury-yields + macro-indicators leave
// open. OAS spreads measure the extra yield investors demand to hold corporate
// debt over risk-free Treasuries — when spreads widen, credit risk is rising;
// tight spreads signal credit euphoria. Agents pricing bonds, estimating WACC,
// or running stress tests need both the risk-free rate (treasury-yields) and
// the credit premium (this cap) to construct discount rates.
//
// Derived metrics: HY-IG differential (pure sub-IG premium) + risk_regime
// classification based on HY OAS level.

const FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const UA        = "Mozilla/5.0 (compatible; myriad/0.4; +https://synaptiic.org)";

// FRED series used
// BAMLH0A0HYM2  — ICE BofA US High Yield Index OAS (% = basis points / 100)
// BAMLC0A0CM    — ICE BofA US Corporate Master OAS (investment grade)
// BAMLC0A4CBBB  — ICE BofA BBB US Corporate Index OAS (lowest IG tier)
const SERIES = {
  hy:  "BAMLH0A0HYM2",
  ig:  "BAMLC0A0CM",
  bbb: "BAMLC0A4CBBB",
};

async function fetchSeries(id) {
  const url  = `${FRED_BASE}?id=${id}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`FRED ${id} returned ${resp.status}`);
  const text  = await resp.text();
  const lines = text.trim().split("\n").filter(l => !l.startsWith("DATE") && l.includes(","));
  for (let i = lines.length - 1; i >= 0; i--) {
    const [date, val] = lines[i].split(",");
    if (val && val.trim() !== "." && val.trim() !== "") {
      return { date: date.trim(), value: parseFloat(val.trim()) };
    }
  }
  return null;
}

// Classify credit stress by HY OAS level (in FRED % units, 1% = 100bp)
// Historical context: GFC peak ~17%, COVID peak ~10%, post-GFC avg ~5%
function classifyRegime(hyOas) {
  if (hyOas === null) return null;
  if (hyOas < 3.0)   return "tight";      // < 300bp — credit euphoria
  if (hyOas < 5.0)   return "normal";     // 300–500bp — healthy risk appetite
  if (hyOas < 7.0)   return "wide";       // 500–700bp — elevated stress
  return                     "stress";    // > 700bp — distress (GFC/COVID level)
}

const round3 = (n) => Math.round(n * 1000) / 1000;

export default {
  name: "credit-spreads",
  price: "$0.034",

  description:
    "Returns current US corporate credit spreads from ICE BofA indices via FRED (free, no API key): High Yield OAS, Investment Grade OAS, and BBB (lowest IG tier) OAS. Includes HY-IG differential and risk regime classification. Pairs with treasury-yields for complete fixed-income discount rate construction.",

  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      hy_oas:       { type: "number", description: "ICE BofA US High Yield OAS (%). Multiply by 100 for basis points." },
      hy_date:      { type: "string", description: "Date of latest HY OAS observation (YYYY-MM-DD)." },
      ig_oas:       { type: "number", description: "ICE BofA US Investment Grade OAS (%). All corporate bonds incl BBB–AAA." },
      ig_date:      { type: "string", description: "Date of latest IG OAS observation (YYYY-MM-DD)." },
      bbb_oas:      { type: "number", description: "ICE BofA BBB Corporate OAS (%). Lowest investment-grade tier — canary for IG deterioration." },
      bbb_date:     { type: "string", description: "Date of latest BBB OAS observation (YYYY-MM-DD)." },
      hy_ig_diff:   { type: "number", description: "HY minus IG spread differential (%). Pure sub-investment-grade credit risk premium." },
      risk_regime:  { type: "string", description: "Credit stress classification based on HY OAS: tight (<300bp) | normal (300–500bp) | wide (500–700bp) | stress (>700bp)." },
      ts:           { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(_query) {
    const [rHy, rIg, rBbb] = await Promise.all([
      fetchSeries(SERIES.hy),
      fetchSeries(SERIES.ig),
      fetchSeries(SERIES.bbb),
    ]);

    const hy_oas  = rHy  ? round3(rHy.value)  : null;
    const ig_oas  = rIg  ? round3(rIg.value)  : null;
    const bbb_oas = rBbb ? round3(rBbb.value) : null;

    const hy_ig_diff = (hy_oas !== null && ig_oas !== null)
      ? round3(hy_oas - ig_oas)
      : null;

    return {
      hy_oas,
      hy_date:     rHy  ? rHy.date  : null,
      ig_oas,
      ig_date:     rIg  ? rIg.date  : null,
      bbb_oas,
      bbb_date:    rBbb ? rBbb.date : null,
      hy_ig_diff,
      risk_regime: classifyRegime(hy_oas),
      ts:          new Date().toISOString(),
    };
  },
};
