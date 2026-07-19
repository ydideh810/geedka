// macro-brief.js
//
// AI-synthesized US macroeconomic situation briefing.
//
// Gathers five real-time signals from free public APIs (FRED + CBOE), then
// uses gpt-4o-mini to produce a structured 200-word narrative briefing and
// a compact signal dashboard. One call replaces a manual assembly of 5+
// data sources and an LLM prompt.
//
// Signals assembled:
//   1. Credit conditions  — HY and IG OAS (ICE BofA via FRED)
//   2. Yield curve        — 10Y-3M Treasury spread (FRED)
//   3. Labor market       — Initial jobless claims + JOLTS openings (FRED)
//   4. Inflation pressure — Core PCE YoY % (FRED)
//   5. Fed stance         — Effective Fed Funds rate (FRED)
//
// Seam: financial agents assembling macro context currently chain 3-6 FRED
// lookups + an LLM synthesis call; this collapses into one $0.350 endpoint.
// Comparable: Briefing.com / Bloomberg macro summaries ($2-10/day).
//
// Upstreams: FRED public CSV (free, no auth) + gpt-4o-mini (OPENAI_API_KEY).

const FRED_BASE   = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const OPENAI_URL  = "https://api.openai.com/v1/chat/completions";
const MODEL       = "gpt-4o-mini";
const UA          = "Mozilla/5.0 (compatible; myriad/3.93; +https://synaptiic.org)";
const FRED_TMO    = 12_000;
const GPT_TMO     = 28_000;

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

const r2 = n => Math.round(n * 100) / 100;

async function gatherSignals() {
  // All 7 FRED series in one parallel batch — max wall time = slowest single fetch.
  const [hy, ig, t10y3m, icsa, jolts, pceyoy, fedfunds] = await Promise.all([
    fredLatest("BAMLH0A0HYM2").catch(() => null),  // HY OAS
    fredLatest("BAMLC0A0CM").catch(() => null),     // IG OAS
    fredLatest("T10Y3M").catch(() => null),         // 10Y-3M spread
    fredLatest("ICSA").catch(() => null),           // Initial claims (thousands)
    fredLatest("JTSJOL").catch(() => null),         // JOLTS job openings (thousands)
    fredLatest("PCEPILFE").catch(() => null),       // Core PCE price index
    fredLatest("FEDFUNDS").catch(() => null),       // Effective Fed Funds rate
  ]);
  return { hy, ig, t10y3m, icsa, jolts, pceyoy, fedfunds };
}

function interpretSignals(s) {
  const credit_regime = s.hy && s.hy.value < 3.5 ? "tight" : s.hy && s.hy.value < 5.5 ? "normal" : "stressed";
  const curve_regime  = s.t10y3m && s.t10y3m.value > 0 ? "normal" : s.t10y3m && s.t10y3m.value > -0.5 ? "flat" : "inverted";
  const labor_signal  = s.icsa && s.icsa.value < 220 ? "strong" : s.icsa && s.icsa.value < 260 ? "stable" : "softening";
  return { credit_regime, curve_regime, labor_signal };
}

async function synthesize(signals, interp, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const block = [
    s => `HY credit spread: ${s.hy ? `${r2(s.hy.value)}% OAS (${s.hy.date}) — regime: ${interp.credit_regime}` : "N/A"}`,
    s => `IG credit spread: ${s.ig ? `${r2(s.ig.value)}% OAS (${s.ig.date})` : "N/A"}`,
    s => `Yield curve (10Y-3M): ${s.t10y3m ? `${r2(s.t10y3m.value)}% (${s.t10y3m.date}) — ${interp.curve_regime}` : "N/A"}`,
    s => `Initial jobless claims: ${s.icsa ? `${r2(s.icsa.value)}K (${s.icsa.date}) — labor: ${interp.labor_signal}` : "N/A"}`,
    s => `JOLTS job openings: ${s.jolts ? `${r2(s.jolts.value / 1000)}M (${s.jolts.date})` : "N/A"}`,
    s => `Core PCE price index: ${s.pceyoy ? `${r2(s.pceyoy.value)} (${s.pceyoy.date})` : "N/A"}`,
    s => `Fed Funds rate: ${s.fedfunds ? `${r2(s.fedfunds.value)}% (${s.fedfunds.date})` : "N/A"}`,
  ].map(fn => fn(signals)).join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 180-220 words.";

  const prompt = `You are a senior macro strategist writing a daily situation briefing for AI financial agents. Your job is to synthesize the economic signal data below into a coherent, actionable narrative assessment.

CURRENT SIGNAL DATA (sourced from FRED, ICE BofA indices):
${block}

${toneClause} Focus on: (1) what the data collectively says about the economic regime, (2) the single most important risk or opportunity the combination implies, and (3) one concrete implication for agent decision-making.

Write in plain professional prose. Do not use bullet points. Do not repeat the raw numbers unless necessary for context. Do not start with "Based on".

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "situation": "one sentence: the core macro regime in plain language",
  "dominant_risk": "one sentence: the single biggest risk the combined signals imply",
  "agent_implication": "one sentence: concrete action relevance for AI agents",
  "narrative": "the full briefing paragraph",
  "regime_label": "expansion" | "late_cycle" | "contraction" | "recovery" | "uncertain",
  "confidence": 0.0 to 1.0
}`;

  const resp = await fetch(OPENAI_URL, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model:       MODEL,
      max_tokens:  600,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(GPT_TMO),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err.slice(0, 120)}`);
  }

  const data = await resp.json();
  const raw  = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  name: "macro-brief",
  price: "$0.370",

  description:
    "AI-synthesized US macroeconomic situation briefing. Gathers 7 real-time signals — HY/IG credit spreads, yield curve (10Y-3M), initial jobless claims, JOLTS openings, core PCE, and Fed Funds rate — from FRED (free, no auth) then uses GPT-4o-mini to synthesize a structured briefing: regime label (expansion/contraction/late-cycle/recovery/uncertain), dominant risk, agent implication, and a 200-word narrative. Replaces a 5+ step data assembly + LLM chain. Priced below Bloomberg macro summaries.",

  inputSchema: {
    type: "object",
    properties: {
      style: {
        type: "string",
        enum: ["standard", "concise"],
        description: "Output length. 'standard' = 200-word narrative (default). 'concise' = 100-word summary.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      regime_label:       { type: "string",  description: "Current macro regime: expansion | late_cycle | contraction | recovery | uncertain" },
      situation:          { type: "string",  description: "One-sentence macro regime summary." },
      dominant_risk:      { type: "string",  description: "Most important risk the combined signals imply." },
      agent_implication:  { type: "string",  description: "Concrete decision relevance for AI agents." },
      narrative:          { type: "string",  description: "Full 200-word briefing narrative." },
      confidence:         { type: "number",  description: "Synthesis confidence 0–1." },
      signals: {
        type: "object",
        description: "Raw signal data used in synthesis.",
        properties: {
          hy_oas:          { type: "number" },
          ig_oas:          { type: "number" },
          yield_curve:     { type: "number" },
          initial_claims:  { type: "number" },
          jolts_openings:  { type: "number" },
          core_pce:        { type: "number" },
          fed_funds:       { type: "number" },
          credit_regime:   { type: "string" },
          curve_regime:    { type: "string" },
          labor_signal:    { type: "string" },
        },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const style = query.style || "standard";

    const raw    = await gatherSignals();
    const interp = interpretSignals(raw);
    const synth  = await synthesize(raw, interp, style);

    return {
      ...synth,
      signals: {
        hy_oas:         raw.hy     ? r2(raw.hy.value)          : null,
        ig_oas:         raw.ig     ? r2(raw.ig.value)           : null,
        yield_curve:    raw.t10y3m ? r2(raw.t10y3m.value)       : null,
        initial_claims: raw.icsa   ? r2(raw.icsa.value)         : null,
        jolts_openings: raw.jolts  ? r2(raw.jolts.value / 1000) : null,
        core_pce:       raw.pceyoy ? r2(raw.pceyoy.value)       : null,
        fed_funds:      raw.fedfunds ? r2(raw.fedfunds.value)   : null,
        credit_regime:  interp.credit_regime,
        curve_regime:   interp.curve_regime,
        labor_signal:   interp.labor_signal,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
