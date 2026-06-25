// labor-brief.js
//
// AI-synthesized US labor market briefing.
//
// Gathers 7 real-time signals from FRED (no API key required), then uses
// gpt-4o-mini to produce a structured 150-word labor market assessment.
// One call replaces manual assembly of 7 data series + LLM synthesis.
//
// Signals assembled:
//   1. Initial jobless claims  — ICSA (weekly, leading indicator)
//   2. Continued claims        — CCSA (weekly, lagging)
//   3. JOLTS job openings      — JTSJOL (millions, monthly)
//   4. Nonfarm payrolls        — PAYEMS (thousands, monthly + MoM job gains)
//   5. Unemployment rate       — UNRATE (%, monthly)
//   6. Avg hourly earnings     — AHETPI (monthly + YoY wage growth %)
//   7. Labor force participation— CIVPART (%, monthly)
//
// Derived: payroll MoM job gains, wage growth YoY %, openings-to-unemployed ratio.
//
// Seam: agents assessing Fed dovishness, wage inflation risk, recession
// probability, or labor cost projections chain through 7+ FRED lookups + LLM;
// this collapses into one $0.350 call with AI synthesis. Builds on the raw
// labor-market cap (data-only, $0.008) by adding analyst-grade synthesis.
//
// Upstreams: FRED public CSV (no auth) + gpt-4o-mini (OPENAI_API_KEY).

const FRED_BASE  = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; the-stall/3.97; +https://intuitek.ai)";
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

// UNEMPLOY series for openings-per-unemployed ratio
async function fredUnemployed() {
  return fredLatest("UNEMPLOY");
}

const r2 = (n) => Math.round(n * 100) / 100;

async function gatherSignals() {
  const [
    initialClaims,
    continuedClaims,
    openings,
    payrollsArr,
    unrate,
    earningsArr,
    participation,
    unemployed,
  ] = await Promise.all([
    fredLatest("ICSA").catch(() => null),         // Initial jobless claims (thousands)
    fredLatest("CCSA").catch(() => null),         // Continued claims (thousands)
    fredLatest("JTSJOL").catch(() => null),       // JOLTS openings (millions)
    fredLastN("PAYEMS", 2).catch(() => []),       // Nonfarm payrolls (2 for MoM)
    fredLatest("UNRATE").catch(() => null),       // Unemployment rate %
    fredLastN("AHETPI", 13).catch(() => []),      // Avg hourly earnings (13 for YoY)
    fredLatest("CIVPART").catch(() => null),      // Labor force participation %
    fredUnemployed().catch(() => null),           // Unemployed persons (thousands)
  ]);

  // Payroll MoM job gains (thousands)
  let payrolls = null, payrollMomK = null;
  if (payrollsArr.length >= 2) {
    payrolls = payrollsArr[payrollsArr.length - 1];
    const prev = payrollsArr[payrollsArr.length - 2];
    payrollMomK = Math.round(payrolls.value - prev.value);
  } else if (payrollsArr.length === 1) {
    payrolls = payrollsArr[0];
  }

  // Wage growth YoY% (AHETPI current vs 12 months prior)
  let earnings = null, wageGrowthYoyPct = null;
  if (earningsArr.length >= 13) {
    earnings = earningsArr[earningsArr.length - 1];
    const yearAgo = earningsArr[0];
    wageGrowthYoyPct = r2(((earnings.value - yearAgo.value) / yearAgo.value) * 100);
  } else if (earningsArr.length >= 1) {
    earnings = earningsArr[earningsArr.length - 1];
  }

  // Openings-to-unemployed ratio (Beveridge curve signal)
  let openingsPerUnemployed = null;
  if (openings && unemployed && unemployed.value > 0) {
    // JTSJOL in millions, UNEMPLOY in thousands → convert unemployed to millions
    openingsPerUnemployed = r2(openings.value / (unemployed.value / 1000));
  }

  return {
    initial_claims:           initialClaims  ? { date: initialClaims.date,  value_k: initialClaims.value } : null,
    continued_claims:         continuedClaims ? { date: continuedClaims.date, value_k: continuedClaims.value } : null,
    job_openings:             openings       ? { date: openings.date,       value_millions: openings.value } : null,
    nonfarm_payrolls:         payrolls       ? { date: payrolls.date,       value_k: payrolls.value, mom_job_gains_k: payrollMomK } : null,
    unemployment_rate_pct:    unrate         ? { date: unrate.date,         value: unrate.value } : null,
    avg_hourly_earnings:      earnings       ? { date: earnings.date,       value: earnings.value, wage_growth_yoy_pct: wageGrowthYoyPct } : null,
    labor_force_participation: participation ? { date: participation.date,   value: participation.value } : null,
    openings_per_unemployed:  openingsPerUnemployed,
  };
}

async function synthesize(sig, env) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const prompt = `You are a US labor market analyst. Based on current FRED data, produce a structured briefing in JSON.

CURRENT DATA:
- Initial Jobless Claims: ${sig.initial_claims?.value_k ? sig.initial_claims.value_k.toLocaleString() + "K" : "N/A"} (${sig.initial_claims?.date ?? "?"}) [<200K=very tight; 200-250K=healthy; 300K+=softening; 400K+=recessionary]
- Continued Claims: ${sig.continued_claims?.value_k ? sig.continued_claims.value_k.toLocaleString() + "K" : "N/A"} (${sig.continued_claims?.date ?? "?"})
- JOLTS Job Openings: ${sig.job_openings?.value_millions !== undefined ? sig.job_openings.value_millions + "M" : "N/A"} (${sig.job_openings?.date ?? "?"}) [pre-pandemic avg ~7M; 10M+=overheated]
- Nonfarm Payrolls MoM gain: ${sig.nonfarm_payrolls?.mom_job_gains_k !== null && sig.nonfarm_payrolls?.mom_job_gains_k !== undefined ? sig.nonfarm_payrolls.mom_job_gains_k.toLocaleString() + "K jobs" : "N/A"} (${sig.nonfarm_payrolls?.date ?? "?"}) [<100K=weak; 100-200K=solid; >300K=very strong]
- Unemployment Rate: ${sig.unemployment_rate_pct?.value !== undefined ? sig.unemployment_rate_pct.value + "%" : "N/A"} (${sig.unemployment_rate_pct?.date ?? "?"}) [<4%=tight; 4-5%=normal; >6%=elevated]
- Wage Growth YoY: ${sig.avg_hourly_earnings?.wage_growth_yoy_pct !== null && sig.avg_hourly_earnings?.wage_growth_yoy_pct !== undefined ? sig.avg_hourly_earnings.wage_growth_yoy_pct + "%" : "N/A"} (${sig.avg_hourly_earnings?.date ?? "?"}) [<3%=low; 3-4%=neutral; >4.5%=inflationary]
- Labor Force Participation: ${sig.labor_force_participation?.value !== undefined ? sig.labor_force_participation.value + "%" : "N/A"} (${sig.labor_force_participation?.date ?? "?"}) [pre-pandemic peak ~63.3%]
- Openings-per-Unemployed: ${sig.openings_per_unemployed !== null && sig.openings_per_unemployed !== undefined ? sig.openings_per_unemployed : "N/A"} [>1.0=more openings than job-seekers; <1.0=slack]

CONTEXT: Fed watches initial claims, payrolls, wage growth, and JOLTS openings most closely. A tight labor market (low claims, high openings, strong wage growth) = hawkish Fed risk. Rising claims + slowing payrolls + falling openings = labor market deterioration = dovish shift ahead.

Respond ONLY with valid JSON:
{
  "labor_regime": "overheating" or "tight" or "balanced" or "softening" or "recessionary",
  "wage_pressure": "rising" or "stable" or "falling",
  "claims_trend": "improving" or "stable" or "deteriorating" or "alarming",
  "fed_posture_signal": "hawkish" or "neutral" or "dovish",
  "narrative": "120-150 word analysis of US labor market: claims trajectory, payroll momentum, wage inflation risk, participation trend, and Fed policy implication",
  "dominant_risk": "one sentence: the single greatest risk in the current labor market",
  "agent_implication": "one sentence: what an AI agent should do with this data (e.g., for wage inflation models, recession probability, sector hiring forecasts)"
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
  name:  "labor-brief",
  price: "$0.370",

  description:
    "AI-synthesized US labor market briefing. Fetches 7 FRED signals (initial claims, continued claims, JOLTS openings, nonfarm payrolls MoM, unemployment rate, wage growth YoY, labor force participation) and uses GPT-4o-mini to produce labor regime, wage pressure, claims trend, Fed posture signal, 150-word narrative, dominant risk, and agent implication. One call collapses 7 FRED lookups + LLM synthesis for wage inflation models, recession probability, and Fed policy forecasting.",

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
          initial_claims:            { type: ["object", "null"] },
          continued_claims:          { type: ["object", "null"] },
          job_openings:              { type: ["object", "null"] },
          nonfarm_payrolls:          { type: ["object", "null"] },
          unemployment_rate_pct:     { type: ["object", "null"] },
          avg_hourly_earnings:       { type: ["object", "null"] },
          labor_force_participation: { type: ["object", "null"] },
          openings_per_unemployed:   { type: ["number", "null"] },
        },
      },
      labor_regime:        { type: "string", description: "overheating | tight | balanced | softening | recessionary" },
      wage_pressure:       { type: "string", description: "rising | stable | falling" },
      claims_trend:        { type: "string", description: "improving | stable | deteriorating | alarming" },
      fed_posture_signal:  { type: "string", description: "hawkish | neutral | dovish" },
      narrative:           { type: "string", description: "150-word labor market brief" },
      dominant_risk:       { type: "string", description: "Primary risk in current labor market" },
      agent_implication:   { type: "string", description: "What an AI agent should do with this data" },
    },
  },

  async handler(input, env) {
    const sig       = await gatherSignals();
    const synthesis = await synthesize(sig, env);
    return { signals: sig, ...synthesis };
  },
};
