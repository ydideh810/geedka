// energy-brief.js
//
// AI-synthesized US energy market situation briefing.
//
// Gathers 7 real-time signals from FRED (no API key required), then uses
// gpt-4o-mini to produce a structured ~200-word energy market assessment.
// One call replaces manual assembly of 7 data series + LLM synthesis.
//
// Signals assembled:
//   1. WTI crude oil price    — WTISPLC ($/barrel, monthly)
//   2. Gasoline price         — GASREGCOVW ($/gallon, weekly)
//   3. Natural gas price      — MHHNGSP (Henry Hub $/mmBtu, monthly)
//   4. CPI Energy             — CPIENGSL (index, monthly) — consumer inflation from energy
//   5. PPI Oil & Gas          — PCU211211 (index, monthly) — producer-side price pressure
//   6. Utilities production   — IPUTIL (index, monthly) — energy demand signal
//   7. Electric power output  — IPG22112N (index, monthly) — electricity demand
//
// Seam: agents assessing energy market exposure, inflation risk, commodity
// cycles, or macro-energy linkages chain 5+ FRED lookups + LLM synthesis;
// this collapses into one $0.350 call with AI interpretation.
//
// Upstreams: FRED public CSV (free, no auth) + gpt-4o-mini (OPENAI_API_KEY).

const FRED_BASE  = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; the-stall/3.98; +https://intuitek.ai)";
const FRED_TMO   = 14_000;
const GPT_TMO    = 28_000;

async function fredLatest(id) {
  const resp = await fetch(`${FRED_BASE}?id=${id}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FRED_TMO),
  });
  if (!resp.ok) throw new Error(`FRED ${id} HTTP ${resp.status}`);
  const text  = await resp.text();
  if (text.includes("<html") || text.includes("<!DOCTYPE")) {
    throw new Error(`FRED ${id} returned HTML — invalid series ID`);
  }
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
  const [wti, gasoline, natgas, cpiEnergy, ppiOilGas, utilProd, elecProd] = await Promise.all([
    fredLatest("WTISPLC").catch(() => null),    // WTI crude oil $/barrel (monthly)
    fredLatest("GASREGCOVW").catch(() => null), // Regular gasoline $/gallon (weekly)
    fredLatest("MHHNGSP").catch(() => null),    // Henry Hub natural gas $/mmBtu (monthly)
    fredLatest("CPIENGSL").catch(() => null),   // CPI Energy index (monthly)
    fredLatest("PCU211211").catch(() => null),  // PPI Oil & Gas extraction (monthly)
    fredLatest("IPUTIL").catch(() => null),     // Industrial production: utilities (monthly)
    fredLatest("IPG22112N").catch(() => null),  // Industrial production: electric power (monthly)
  ]);
  return { wti, gasoline, natgas, cpiEnergy, ppiOilGas, utilProd, elecProd };
}

function interpretSignals(s) {
  const oil_regime =
    !s.wti             ? "unknown"
    : s.wti.value > 120 ? "shock"
    : s.wti.value > 90  ? "elevated"
    : s.wti.value > 60  ? "normal"
    :                     "low";

  const gas_stress =
    !s.gasoline            ? "unknown"
    : s.gasoline.value > 4.50 ? "high"
    : s.gasoline.value > 3.50 ? "elevated"
    :                           "low";

  const natgas_regime =
    !s.natgas             ? "unknown"
    : s.natgas.value > 5.0 ? "tight"
    : s.natgas.value > 3.0 ? "normal"
    :                        "glut";

  return { oil_regime, gas_stress, natgas_regime };
}

async function synthesize(signals, interp, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const block = [
    `WTI crude oil: ${signals.wti     ? `$${r2(signals.wti.value)}/barrel (${signals.wti.date}) — regime: ${interp.oil_regime}` : "N/A"}`,
    `Gasoline price: ${signals.gasoline ? `$${r2(signals.gasoline.value)}/gallon (${signals.gasoline.date}) — stress: ${interp.gas_stress}` : "N/A"}`,
    `Natural gas (Henry Hub): ${signals.natgas ? `$${r2(signals.natgas.value)}/mmBtu (${signals.natgas.date}) — regime: ${interp.natgas_regime}` : "N/A"}`,
    `CPI Energy index: ${signals.cpiEnergy ? `${r2(signals.cpiEnergy.value)} (${signals.cpiEnergy.date})` : "N/A"}`,
    `PPI Oil & Gas extraction: ${signals.ppiOilGas ? `${r2(signals.ppiOilGas.value)} (${signals.ppiOilGas.date})` : "N/A"}`,
    `Industrial production — utilities: ${signals.utilProd  ? `${r2(signals.utilProd.value)} (${signals.utilProd.date})` : "N/A"}`,
    `Industrial production — electric power: ${signals.elecProd ? `${r2(signals.elecProd.value)} (${signals.elecProd.date})` : "N/A"}`,
  ].join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 180-220 words.";

  const prompt = `You are a senior energy market analyst writing a daily situation briefing for AI agents. Synthesize the energy signal data below into a coherent, actionable assessment of current US energy market conditions.

CURRENT SIGNAL DATA (sourced from FRED):
${block}

${toneClause} Focus on: (1) the overall energy market regime and what is driving it, (2) the single most important risk for agents relying on energy-sensitive assumptions, and (3) one concrete implication for agent decision-making (especially macro, inflation, commodities, or equity agents).

Write in plain professional prose. Do not use bullet points. Do not repeat raw numbers unless critical for context. Do not start with "Based on".

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "situation": "one sentence: the core energy market regime in plain language",
  "dominant_risk": "one sentence: the single biggest risk the combined signals imply",
  "agent_implication": "one sentence: concrete action relevance for AI agents",
  "narrative": "the full briefing paragraph",
  "energy_regime": "energy_shock" | "elevated" | "normal" | "energy_glut" | "uncertain",
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

  const data  = await resp.json();
  const raw   = data.choices?.[0]?.message?.content || "";
  const clean = raw.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  name:  "energy-brief",
  price: "$0.350",

  description:
    "AI-synthesized US energy market situation briefing. Gathers 7 real-time signals from FRED (free, no auth): WTI crude price, regular gasoline price, Henry Hub natural gas, CPI Energy, PPI Oil & Gas, utilities output, and electric power production. Uses GPT-4o-mini to synthesize: energy regime label (energy_shock/elevated/normal/energy_glut/uncertain), dominant risk, agent implication, and a 200-word narrative. Extends the macro intelligence suite to energy — critical for inflation analysis, commodity exposure, and sector rotation decisions.",

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
      energy_regime:      { type: "string",  description: "Current energy regime: energy_shock | elevated | normal | energy_glut | uncertain" },
      situation:          { type: "string",  description: "One-sentence energy market summary." },
      dominant_risk:      { type: "string",  description: "Most important risk the combined signals imply." },
      agent_implication:  { type: "string",  description: "Concrete decision relevance for AI agents." },
      narrative:          { type: "string",  description: "Full ~200-word briefing narrative." },
      confidence:         { type: "number",  description: "Synthesis confidence 0–1." },
      signals: {
        type: "object",
        description: "Raw signal data used in synthesis.",
        properties: {
          wti_crude_barrel:     { type: "number" },
          gasoline_per_gallon:  { type: "number" },
          natgas_mmbtu:         { type: "number" },
          cpi_energy_index:     { type: "number" },
          ppi_oil_gas:          { type: "number" },
          util_production:      { type: "number" },
          elec_production:      { type: "number" },
          oil_regime:           { type: "string" },
          gas_stress:           { type: "string" },
          natgas_regime:        { type: "string" },
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
        wti_crude_barrel:    raw.wti       ? r2(raw.wti.value)        : null,
        gasoline_per_gallon: raw.gasoline  ? r2(raw.gasoline.value)   : null,
        natgas_mmbtu:        raw.natgas    ? r2(raw.natgas.value)      : null,
        cpi_energy_index:    raw.cpiEnergy ? r2(raw.cpiEnergy.value)  : null,
        ppi_oil_gas:         raw.ppiOilGas ? r2(raw.ppiOilGas.value)  : null,
        util_production:     raw.utilProd  ? r2(raw.utilProd.value)   : null,
        elec_production:     raw.elecProd  ? r2(raw.elecProd.value)   : null,
        oil_regime:          interp.oil_regime,
        gas_stress:          interp.gas_stress,
        natgas_regime:       interp.natgas_regime,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
