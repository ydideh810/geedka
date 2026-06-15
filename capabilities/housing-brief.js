// housing-brief.js
//
// AI-synthesized US housing market intelligence briefing.
//
// Gathers 8 real-time signals from FRED (no API key required), then uses
// gpt-4o-mini to produce a structured 150-word narrative + compact dashboard.
// One call replaces manual assembly of 8 data series + LLM synthesis.
//
// Signals assembled:
//   1. Housing starts        — HOUST (SAAR, thousands)
//   2. Building permits      — PERMIT (SAAR, thousands)
//   3. Existing home sales   — EXHOSLUSM495S (annualized)
//   4. New homes sold        — HSN1F (SAAR, thousands)
//   5. Months of supply      — MSACSR (new homes, months)
//   6. 30Y mortgage rate     — MORTGAGE30US (%)
//   7. Case-Shiller HPI      — CSUSHPISA (national, SA)
//   8. Median sale price     — MSPUS (quarterly, $)
//
// Derived: permit/starts pipeline ratio, Case-Shiller MoM change.
//
// Seam: financial agents assessing REIT exposure, mortgage risk, consumer
// wealth effects, construction sector, or housing drag on macro growth chain
// through 7+ FRED series + an LLM; this collapses into one $0.350 call.
//
// Upstreams: FRED public CSV (no auth) + gpt-4o-mini (OPENAI_API_KEY).

const FRED_BASE  = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; the-stall/3.95; +https://intuitek.ai)";
const FRED_TMO   = 12_000;
const GPT_TMO    = 28_000;

async function fredLatest(id) {
  const resp = await fetch(`${FRED_BASE}?id=${id}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FRED_TMO),
  });
  if (!resp.ok) throw new Error(`FRED ${id} HTTP ${resp.status}`);
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

async function fredLastN(id, n) {
  const resp = await fetch(`${FRED_BASE}?id=${id}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FRED_TMO),
  });
  if (!resp.ok) throw new Error(`FRED ${id} HTTP ${resp.status}`);
  const text   = await resp.text();
  const lines  = text.trim().split("\n").filter(l => !l.startsWith("DATE") && l.includes(","));
  const result = [];
  for (let i = lines.length - 1; i >= 0 && result.length < n; i--) {
    const [date, val] = lines[i].split(",");
    if (val && val.trim() !== "." && val.trim() !== "") {
      result.unshift({ date: date.trim(), value: parseFloat(val.trim()) });
    }
  }
  return result;
}

const r2 = (n) => Math.round(n * 100) / 100;

async function gatherSignals() {
  const [starts, permits, existing, newSold, supply, mortgage, hpiArr, price] = await Promise.all([
    fredLatest("HOUST").catch(() => null),           // housing starts SAAR thousands
    fredLatest("PERMIT").catch(() => null),          // building permits SAAR thousands
    fredLatest("EXHOSLUSM495S").catch(() => null),   // existing home sales (units/yr)
    fredLatest("HSN1F").catch(() => null),           // new homes sold SAAR thousands
    fredLatest("MSACSR").catch(() => null),          // months supply of new homes
    fredLatest("MORTGAGE30US").catch(() => null),    // 30Y fixed mortgage rate %
    fredLastN("CSUSHPISA", 2).catch(() => []),       // Case-Shiller HPI last 2 obs
    fredLatest("MSPUS").catch(() => null),           // median sale price (quarterly, $)
  ]);

  // Case-Shiller MoM change
  let hpi = null;
  let hpiMomPct = null;
  if (hpiArr.length >= 2) {
    hpi = hpiArr[hpiArr.length - 1];
    const prev = hpiArr[hpiArr.length - 2];
    hpiMomPct = r2(((hpi.value - prev.value) / prev.value) * 100);
  } else if (hpiArr.length === 1) {
    hpi = hpiArr[0];
  }

  // Pipeline ratio: permits issued vs starts breaking ground
  const permitStartsRatio = (permits && starts && starts.value > 0)
    ? r2(permits.value / starts.value)
    : null;

  return {
    housing_starts:       starts   ? { date: starts.date,   value_k_saar: starts.value  } : null,
    building_permits:     permits  ? { date: permits.date,  value_k_saar: permits.value } : null,
    existing_sales:       existing ? { date: existing.date, value_ann: existing.value, value_millions: r2(existing.value / 1_000_000) } : null,
    new_homes_sold:       newSold  ? { date: newSold.date,  value_k_saar: newSold.value } : null,
    months_supply_new:    supply   ? { date: supply.date,   value: supply.value          } : null,
    mortgage_rate_30y:    mortgage ? { date: mortgage.date, value_pct: mortgage.value   } : null,
    case_shiller_hpi:     hpi      ? { date: hpi.date,      value: r2(hpi.value), mom_pct: hpiMomPct } : null,
    median_price_usd:     price    ? { date: price.date,    value: price.value           } : null,
    permit_starts_ratio:  permitStartsRatio,
  };
}

async function synthesize(sig, env) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const prompt = `You are a US housing market analyst. Based on current FRED data, produce a structured briefing in JSON.

CURRENT DATA:
- Housing Starts (SAAR): ${sig.housing_starts?.value_k_saar ?? "N/A"}K units/yr (${sig.housing_starts?.date ?? "?"})
- Building Permits (SAAR): ${sig.building_permits?.value_k_saar ?? "N/A"}K units/yr (${sig.building_permits?.date ?? "?"})
- Existing Home Sales: ${sig.existing_sales?.value_millions ?? "N/A"}M annualized (${sig.existing_sales?.date ?? "?"})
- New Homes Sold (SAAR): ${sig.new_homes_sold?.value_k_saar ?? "N/A"}K units/yr (${sig.new_homes_sold?.date ?? "?"})
- Months Supply (new homes): ${sig.months_supply_new?.value ?? "N/A"} months (${sig.months_supply_new?.date ?? "?"})
- 30Y Mortgage Rate: ${sig.mortgage_rate_30y?.value_pct ?? "N/A"}% (${sig.mortgage_rate_30y?.date ?? "?"})
- Case-Shiller HPI: ${sig.case_shiller_hpi?.value ?? "N/A"} (MoM: ${sig.case_shiller_hpi?.mom_pct !== null && sig.case_shiller_hpi?.mom_pct !== undefined ? sig.case_shiller_hpi.mom_pct + "%" : "N/A"}, ${sig.case_shiller_hpi?.date ?? "?"})
- Median Sale Price: $${sig.median_price_usd?.value?.toLocaleString() ?? "N/A"} (${sig.median_price_usd?.date ?? "?"})
- Permit/Starts Ratio: ${sig.permit_starts_ratio ?? "N/A"}

NORMS: Months supply <5=seller, 5-7=balanced, >7=buyer market. Healthy starts 1,400-1,600K/yr. High affordability stress if mortgage >7% + median price >$400K.

Respond ONLY with valid JSON:
{
  "market_phase": "seller" or "balanced" or "buyer" or "frozen",
  "direction": "heating" or "stable" or "cooling",
  "supply_posture": "under" or "balanced" or "over",
  "affordability_regime": "accessible" or "moderate" or "stressed" or "extreme",
  "narrative": "120-150 word analysis of current US housing market conditions, key drivers, and near-term trajectory",
  "dominant_risk": "one sentence: the single greatest risk to housing market stability right now",
  "agent_implication": "one sentence: what an AI agent should do with this briefing (e.g., for REIT valuation, mortgage exposure assessment, consumer wealth forecasting)"
}`;

  const r = await fetch(OPENAI_URL, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:           MODEL,
      messages:        [{ role: "user", content: prompt }],
      temperature:     0.2,
      max_tokens:      600,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(GPT_TMO),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
  const d = await r.json();
  return JSON.parse(d.choices[0].message.content);
}

export default {
  name:  "housing-brief",
  price: "$0.350",

  description:
    "AI-synthesized US housing market briefing. Fetches 8 FRED signals (starts, permits, existing/new sales, months supply, 30Y mortgage rate, Case-Shiller HPI, median price) and uses gpt-4o-mini to produce market phase, direction, supply posture, affordability regime, 150-word narrative, dominant risk, and agent implication. One call collapses 8 FRED lookups + LLM synthesis for REIT analysis, mortgage exposure, consumer wealth, and macro housing drag.",

  inputSchema: {
    type:       "object",
    properties: {},
    required:   [],
  },

  outputSchema: {
    type: "object",
    properties: {
      signals: {
        type: "object",
        description: "Raw FRED signals assembled for this briefing.",
        properties: {
          housing_starts:      { type: ["object", "null"] },
          building_permits:    { type: ["object", "null"] },
          existing_sales:      { type: ["object", "null"] },
          new_homes_sold:      { type: ["object", "null"] },
          months_supply_new:   { type: ["object", "null"] },
          mortgage_rate_30y:   { type: ["object", "null"] },
          case_shiller_hpi:    { type: ["object", "null"] },
          median_price_usd:    { type: ["object", "null"] },
          permit_starts_ratio: { type: ["number", "null"] },
        },
      },
      market_phase:         { type: "string", description: "seller | balanced | buyer | frozen" },
      direction:            { type: "string", description: "heating | stable | cooling" },
      supply_posture:       { type: "string", description: "under | balanced | over" },
      affordability_regime: { type: "string", description: "accessible | moderate | stressed | extreme" },
      narrative:            { type: "string", description: "150-word housing market situation brief" },
      dominant_risk:        { type: "string", description: "Primary risk to housing market stability" },
      agent_implication:    { type: "string", description: "What an AI agent should do with this data" },
    },
  },

  async handler(input, env) {
    const sig       = await gatherSignals();
    const synthesis = await synthesize(sig, env);
    return { signals: sig, ...synthesis };
  },
};
