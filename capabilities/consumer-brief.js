// consumer-brief.js
//
// AI-synthesized US consumer health briefing.
//
// Gathers 8 real-time signals from FRED (no API key required), then uses
// gpt-4o-mini to produce a structured 150-word consumer health assessment.
// One call replaces manual assembly of 8 data series + LLM synthesis.
//
// Signals assembled:
//   1. Consumer sentiment      — UMCSENT (U of Michigan, monthly)
//   2. Retail sales ex-food    — RSXFS (billions $, monthly)
//   3. Real PCE                — PCEC96 (chained 2017$, billions)
//   4. Real disposable income  — DSPIC96 (chained 2017$, billions)
//   5. Personal savings rate   — PSAVERT (%, monthly)
//   6. Total consumer credit   — TOTALSL (millions $, monthly)
//   7. Revolving credit        — REVOLSL (credit cards, millions $)
//   8. Nominal PCE             — PCE (billions $)
//
// Derived: retail sales MoM %, real income MoM %, revolving credit trend.
//
// Seam: agents modeling consumer spending, recession probability, retail
// sector exposure, or credit risk chain through 6+ FRED lookups + LLM;
// this collapses into one $0.350 call with AI synthesis.
//
// Upstreams: FRED public CSV (no auth) + gpt-4o-mini (OPENAI_API_KEY).

const FRED_BASE  = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; the-stall/3.96; +https://intuitek.ai)";
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
  const [sentiment, retailArr, realPceArr, realIncArr, savings, totalCredit, revolving, nomPce] =
    await Promise.all([
      fredLatest("UMCSENT").catch(() => null),   // Michigan consumer sentiment
      fredLastN("RSXFS", 2).catch(() => []),     // Retail sales ex-food (2 for MoM)
      fredLastN("PCEC96", 2).catch(() => []),    // Real PCE (2 for MoM)
      fredLastN("DSPIC96", 2).catch(() => []),   // Real disposable income (2 for MoM)
      fredLatest("PSAVERT").catch(() => null),   // Personal savings rate %
      fredLatest("TOTALSL").catch(() => null),   // Total consumer credit ($M)
      fredLastN("REVOLSL", 3).catch(() => []),   // Revolving credit last 3 (trend)
      fredLatest("PCE").catch(() => null),       // Nominal PCE ($B)
    ]);

  // Retail sales MoM %
  let retail = null, retailMomPct = null;
  if (retailArr.length >= 2) {
    retail = retailArr[retailArr.length - 1];
    const prev = retailArr[retailArr.length - 2];
    retailMomPct = r2(((retail.value - prev.value) / prev.value) * 100);
  } else if (retailArr.length === 1) {
    retail = retailArr[0];
  }

  // Real PCE MoM %
  let realPce = null, realPceMomPct = null;
  if (realPceArr.length >= 2) {
    realPce = realPceArr[realPceArr.length - 1];
    const prev = realPceArr[realPceArr.length - 2];
    realPceMomPct = r2(((realPce.value - prev.value) / prev.value) * 100);
  } else if (realPceArr.length === 1) {
    realPce = realPceArr[0];
  }

  // Real income MoM %
  let realInc = null, realIncMomPct = null;
  if (realIncArr.length >= 2) {
    realInc = realIncArr[realIncArr.length - 1];
    const prev = realIncArr[realIncArr.length - 2];
    realIncMomPct = r2(((realInc.value - prev.value) / prev.value) * 100);
  } else if (realIncArr.length === 1) {
    realInc = realIncArr[0];
  }

  // Revolving credit trend (3-month direction)
  let revolvLatest = null, revolvTrendPct = null;
  if (revolving.length >= 2) {
    revolvLatest = revolving[revolving.length - 1];
    const oldest  = revolving[0];
    revolvTrendPct = r2(((revolvLatest.value - oldest.value) / oldest.value) * 100);
  } else if (revolving.length === 1) {
    revolvLatest = revolving[0];
  }

  return {
    sentiment:              sentiment  ? { date: sentiment.date,    value: sentiment.value } : null,
    retail_sales:           retail     ? { date: retail.date,       value_millions: retail.value, mom_pct: retailMomPct } : null,
    real_pce:               realPce    ? { date: realPce.date,      value_b_2017: realPce.value, mom_pct: realPceMomPct } : null,
    real_disposable_income: realInc    ? { date: realInc.date,      value_b_2017: realInc.value, mom_pct: realIncMomPct } : null,
    savings_rate_pct:       savings    ? { date: savings.date,      value: savings.value } : null,
    total_consumer_credit:  totalCredit ? { date: totalCredit.date, value_millions: totalCredit.value } : null,
    revolving_credit:       revolvLatest ? { date: revolvLatest.date, value_millions: revolvLatest.value, trend_3mo_pct: revolvTrendPct } : null,
    nominal_pce:            nomPce     ? { date: nomPce.date,       value_billions: nomPce.value } : null,
  };
}

async function synthesize(sig, env) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const prompt = `You are a US consumer health analyst. Based on current FRED data, produce a structured briefing in JSON.

CURRENT DATA:
- Michigan Consumer Sentiment: ${sig.sentiment?.value ?? "N/A"} (${sig.sentiment?.date ?? "?"}) [100=baseline; >90=optimistic; <70=pessimistic; <60=recessionary]
- Retail Sales ex-food (MoM): ${sig.retail_sales?.mom_pct !== null && sig.retail_sales?.mom_pct !== undefined ? sig.retail_sales.mom_pct + "%" : "N/A"} (${sig.retail_sales?.date ?? "?"})
- Real PCE (MoM): ${sig.real_pce?.mom_pct !== null && sig.real_pce?.mom_pct !== undefined ? sig.real_pce.mom_pct + "%" : "N/A"} (${sig.real_pce?.date ?? "?"})
- Real Disposable Income (MoM): ${sig.real_disposable_income?.mom_pct !== null && sig.real_disposable_income?.mom_pct !== undefined ? sig.real_disposable_income.mom_pct + "%" : "N/A"} (${sig.real_disposable_income?.date ?? "?"})
- Personal Savings Rate: ${sig.savings_rate_pct?.value ?? "N/A"}% (${sig.savings_rate_pct?.date ?? "?"}) [historical avg ~7%; <3%=stress; <1%=depletion]
- Total Consumer Credit: $${sig.total_consumer_credit?.value_millions ? (sig.total_consumer_credit.value_millions / 1000).toFixed(0) + "B" : "N/A"} (${sig.total_consumer_credit?.date ?? "?"})
- Revolving Credit (3-mo trend): ${sig.revolving_credit?.trend_3mo_pct !== null && sig.revolving_credit?.trend_3mo_pct !== undefined ? sig.revolving_credit.trend_3mo_pct + "%" : "N/A"} (latest: $${sig.revolving_credit?.value_millions ? (sig.revolving_credit.value_millions / 1000).toFixed(0) + "B" : "N/A"}, ${sig.revolving_credit?.date ?? "?"})

CONTEXT: Recession signals: sentiment <60, savings rate <2%, real income declining MoM, revolving credit accelerating (consumers borrowing to spend).

Respond ONLY with valid JSON:
{
  "consumer_posture": "strong" or "cautious" or "stressed" or "distressed",
  "spending_regime": "expanding" or "stable" or "contracting",
  "confidence_level": "high" or "moderate" or "low" or "recessionary",
  "savings_stress": "adequate" or "low" or "depleted",
  "credit_dependency": "low" or "moderate" or "high" or "extreme",
  "narrative": "120-150 word analysis of US consumer health: spending patterns, income vs. spending gap, credit reliance, confidence trajectory, and near-term outlook",
  "dominant_risk": "one sentence: the single greatest risk to consumer spending stability",
  "agent_implication": "one sentence: what an AI agent should do with this data (e.g., for retail sector exposure, recession probability, consumer credit risk)"
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
  name:  "consumer-brief",
  price: "$0.350",

  description:
    "AI-synthesized US consumer health briefing. Fetches 8 FRED signals (Michigan sentiment, retail sales MoM, real PCE, real disposable income, savings rate, total/revolving consumer credit) and uses GPT-4o-mini to produce consumer posture, spending regime, confidence level, savings stress, credit dependency, 150-word narrative, dominant risk, and agent implication. One call collapses 8 FRED lookups + LLM synthesis for retail sector exposure, recession probability, and consumer credit risk.",

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
          sentiment:              { type: ["object", "null"] },
          retail_sales:           { type: ["object", "null"] },
          real_pce:               { type: ["object", "null"] },
          real_disposable_income: { type: ["object", "null"] },
          savings_rate_pct:       { type: ["object", "null"] },
          total_consumer_credit:  { type: ["object", "null"] },
          revolving_credit:       { type: ["object", "null"] },
          nominal_pce:            { type: ["object", "null"] },
        },
      },
      consumer_posture:   { type: "string", description: "strong | cautious | stressed | distressed" },
      spending_regime:    { type: "string", description: "expanding | stable | contracting" },
      confidence_level:   { type: "string", description: "high | moderate | low | recessionary" },
      savings_stress:     { type: "string", description: "adequate | low | depleted" },
      credit_dependency:  { type: "string", description: "low | moderate | high | extreme" },
      narrative:          { type: "string", description: "150-word consumer health brief" },
      dominant_risk:      { type: "string", description: "Primary risk to consumer spending" },
      agent_implication:  { type: "string", description: "What an AI agent should do with this data" },
    },
  },

  async handler(input, env) {
    const sig       = await gatherSignals();
    const synthesis = await synthesize(sig, env);
    return { signals: sig, ...synthesis };
  },
};
