// manufacturing-brief.js
//
// AI-synthesized US manufacturing & industrial sector situation briefing.
//
// Gathers 7 real-time signals from FRED (no API key required), then uses
// gpt-4o-mini to produce a structured ~200-word manufacturing assessment.
// One call replaces manual assembly of 7 data series + LLM synthesis.
//
// Signals assembled:
//   1. Industrial Production Index — INDPRO (index 2017=100, monthly)
//   2. Capacity Utilization        — TCU (%, total industry, monthly)
//   3. Durable Goods Orders        — AMTMNO ($M, new orders, monthly)
//   4. Manufacturing Output        — IPMAN (index 2017=100, monthly)
//   5. Manufacturing Employment    — MANEMP (thousands, monthly)
//   6. Inventory/Sales Ratio       — ISRATIO (total business, monthly)
//   7. PPI All Commodities         — PPIACO (index 1982=100, input cost proxy, monthly)
//
// Derived: INDPRO MoM %, capacity utilization change, durable orders MoM %,
//          manufacturing output MoM %, employment MoM change, PPI MoM %.
//
// Seam: agents modeling supply chains, sector rotation, inflation pass-through,
// or recession probability chain through 5+ FRED lookups + LLM synthesis;
// this collapses into one $0.350 call with AI interpretation.
//
// Upstreams: FRED public CSV (free, no auth) + gpt-4o-mini (OPENAI_API_KEY).

const FRED_BASE  = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; the-stall/4.0; +https://intuitek.ai)";
const FRED_TMO   = 14_000;
const GPT_TMO    = 28_000;

async function fredLatest(id) {
  const resp = await fetch(`${FRED_BASE}?id=${id}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FRED_TMO),
  });
  if (!resp.ok) throw new Error(`FRED ${id} HTTP ${resp.status}`);
  const text = await resp.text();
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

async function fredLastN(id, n) {
  const resp = await fetch(`${FRED_BASE}?id=${id}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FRED_TMO),
  });
  if (!resp.ok) throw new Error(`FRED ${id} HTTP ${resp.status}`);
  const text  = await resp.text();
  if (text.includes("<html") || text.includes("<!DOCTYPE")) {
    throw new Error(`FRED ${id} returned HTML — invalid series ID`);
  }
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

const r2 = n => Math.round(n * 100) / 100;
const momPct = (arr) =>
  arr.length >= 2
    ? r2(((arr[arr.length - 1].value - arr[arr.length - 2].value) / arr[arr.length - 2].value) * 100)
    : null;
const momChg = (arr) =>
  arr.length >= 2
    ? r2(arr[arr.length - 1].value - arr[arr.length - 2].value)
    : null;

async function gatherSignals() {
  const [indproArr, tcuArr, amtmnoArr, ipmanArr, manempArr, isratio, ppiacoArr] =
    await Promise.all([
      fredLastN("INDPRO",  2).catch(() => []),  // Industrial Production Index (2017=100)
      fredLastN("TCU",     2).catch(() => []),  // Capacity Utilization % (total industry)
      fredLastN("AMTMNO",  2).catch(() => []),  // Durable Goods New Orders ($M)
      fredLastN("IPMAN",   2).catch(() => []),  // Manufacturing Production Index (2017=100)
      fredLastN("MANEMP",  2).catch(() => []),  // Manufacturing Employees (thousands)
      fredLatest("ISRATIO").catch(() => null),  // Business Inventories/Sales Ratio
      fredLastN("PPIACO",  2).catch(() => []),  // PPI All Commodities (1982=100)
    ]);

  const indpro  = indproArr.at(-1)  ?? null;
  const tcu     = tcuArr.at(-1)     ?? null;
  const amtmno  = amtmnoArr.at(-1)  ?? null;
  const ipman   = ipmanArr.at(-1)   ?? null;
  const manemp  = manempArr.at(-1)  ?? null;
  const ppiaco  = ppiacoArr.at(-1)  ?? null;

  return {
    indpro,  indproArr,
    tcu,     tcuArr,
    amtmno,  amtmnoArr,
    ipman,   ipmanArr,
    manemp,  manempArr,
    isratio,
    ppiaco,  ppiacoArr,
    // Derived changes
    indpro_mom_pct:   momPct(indproArr),
    tcu_mom_chg:      momChg(tcuArr),
    amtmno_mom_pct:   momPct(amtmnoArr),
    ipman_mom_pct:    momPct(ipmanArr),
    manemp_mom_chg:   momChg(manempArr),
    ppiaco_mom_pct:   momPct(ppiacoArr),
  };
}

function interpretSignals(s) {
  const capacity_regime =
    !s.tcu                  ? "unknown"
    : s.tcu.value >= 80     ? "constrained"
    : s.tcu.value >= 75     ? "balanced"
    :                         "slack";

  const input_cost_pressure =
    !s.ppiaco_mom_pct       ? "unknown"
    : s.ppiaco_mom_pct > 1  ? "high"
    : s.ppiaco_mom_pct > 0  ? "moderate"
    :                         "low";

  const inventory_posture =
    !s.isratio              ? "unknown"
    : s.isratio.value > 1.4 ? "overstocked"
    : s.isratio.value > 1.3 ? "elevated"
    : s.isratio.value > 1.2 ? "normal"
    :                         "lean";

  const output_trend =
    s.indpro_mom_pct === null  ? "unknown"
    : s.indpro_mom_pct > 0.5   ? "expanding"
    : s.indpro_mom_pct > 0     ? "growing"
    : s.indpro_mom_pct > -0.5  ? "stagnant"
    :                            "contracting";

  return { capacity_regime, input_cost_pressure, inventory_posture, output_trend };
}

async function synthesize(sig, interp, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const block = [
    `Industrial Production Index: ${sig.indpro ? `${r2(sig.indpro.value)} (${sig.indpro.date}), MoM: ${sig.indpro_mom_pct !== null ? sig.indpro_mom_pct + "%" : "N/A"} — trend: ${interp.output_trend}` : "N/A"}`,
    `Capacity Utilization: ${sig.tcu ? `${r2(sig.tcu.value)}% (${sig.tcu.date}), MoM change: ${sig.tcu_mom_chg !== null ? sig.tcu_mom_chg + "pp" : "N/A"} — regime: ${interp.capacity_regime}` : "N/A"}`,
    `Durable Goods Orders: ${sig.amtmno ? `$${r2(sig.amtmno.value / 1000)}B (${sig.amtmno.date}), MoM: ${sig.amtmno_mom_pct !== null ? sig.amtmno_mom_pct + "%" : "N/A"}` : "N/A"}`,
    `Manufacturing Production: ${sig.ipman ? `${r2(sig.ipman.value)} (${sig.ipman.date}), MoM: ${sig.ipman_mom_pct !== null ? sig.ipman_mom_pct + "%" : "N/A"}` : "N/A"}`,
    `Manufacturing Employment: ${sig.manemp ? `${r2(sig.manemp.value)}K (${sig.manemp.date}), MoM change: ${sig.manemp_mom_chg !== null ? "+" + sig.manemp_mom_chg + "K" : "N/A"}` : "N/A"}`,
    `Business Inventory/Sales Ratio: ${sig.isratio ? `${sig.isratio.value} (${sig.isratio.date}) — posture: ${interp.inventory_posture}` : "N/A"}`,
    `PPI All Commodities: ${sig.ppiaco ? `${r2(sig.ppiaco.value)} (${sig.ppiaco.date}), MoM: ${sig.ppiaco_mom_pct !== null ? sig.ppiaco_mom_pct + "%" : "N/A"} — cost pressure: ${interp.input_cost_pressure}` : "N/A"}`,
  ].join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 180-220 words.";

  const prompt = `You are a senior industrial economist writing a daily situation briefing for AI agents. Synthesize the US manufacturing and industrial signal data below into a coherent, actionable assessment of current sector conditions.

CURRENT SIGNAL DATA (sourced from FRED):
${block}

${toneClause} Focus on: (1) the overall manufacturing regime and what is driving it, (2) the single most important risk for agents relying on supply-chain or industrial assumptions, and (3) one concrete implication for agent decision-making (especially macro, inflation, equity sector, or supply-chain agents).

Write in plain professional prose. Do not use bullet points. Do not repeat raw numbers unless critical for context. Do not start with "Based on".

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "situation": "one sentence: the core manufacturing regime in plain language",
  "dominant_risk": "one sentence: the single biggest risk the combined signals imply",
  "agent_implication": "one sentence: concrete action relevance for AI agents",
  "narrative": "the full briefing paragraph",
  "manufacturing_regime": "expanding" | "growing" | "stagnant" | "contracting" | "uncertain",
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
  name:  "manufacturing-brief",
  price: "$0.350",

  description:
    "AI-synthesized US manufacturing & industrial sector briefing. Gathers 7 FRED signals (free, no auth): Industrial Production, Capacity Utilization, Durable Goods Orders, Manufacturing Output, Manufacturing Employment, Inventory/Sales Ratio, and PPI All Commodities. Uses GPT-4o-mini to synthesize: manufacturing regime (expanding/growing/stagnant/contracting), dominant risk, agent implication, and 200-word narrative. Completes the macro intelligence suite alongside energy-brief, labor-brief, and consumer-brief.",

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
      manufacturing_regime: { type: "string", description: "Current regime: expanding | growing | stagnant | contracting | uncertain" },
      situation:            { type: "string", description: "One-sentence manufacturing sector summary." },
      dominant_risk:        { type: "string", description: "Most important risk the combined signals imply." },
      agent_implication:    { type: "string", description: "Concrete decision relevance for AI agents." },
      narrative:            { type: "string", description: "Full ~200-word briefing narrative." },
      confidence:           { type: "number", description: "Synthesis confidence 0–1." },
      signals: {
        type: "object",
        description: "Raw signal data used in synthesis.",
        properties: {
          industrial_production_index:  { type: "number", description: "INDPRO index (2017=100)." },
          ip_mom_pct:                   { type: "number", description: "Industrial Production MoM % change." },
          capacity_utilization_pct:     { type: "number", description: "TCU: total industry capacity utilization %." },
          cap_util_mom_pp:              { type: "number", description: "Capacity utilization MoM percentage-point change." },
          durable_goods_orders_bn:      { type: "number", description: "Durable Goods new orders in $B." },
          durable_orders_mom_pct:       { type: "number", description: "Durable Goods orders MoM % change." },
          mfg_production_index:         { type: "number", description: "IPMAN: manufacturing production index (2017=100)." },
          mfg_output_mom_pct:           { type: "number", description: "Manufacturing output MoM % change." },
          mfg_employment_k:             { type: "number", description: "Manufacturing employees (thousands)." },
          mfg_employment_mom_chg_k:     { type: "number", description: "Manufacturing employment MoM change (thousands)." },
          inventory_sales_ratio:        { type: "number", description: "Total business inventories/sales ratio." },
          ppi_all_commodities:          { type: "number", description: "PPI All Commodities index (1982=100)." },
          ppi_mom_pct:                  { type: "number", description: "PPI All Commodities MoM % change." },
          capacity_regime:              { type: "string" },
          input_cost_pressure:          { type: "string" },
          inventory_posture:            { type: "string" },
          output_trend:                 { type: "string" },
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
        industrial_production_index:  raw.indpro  ? r2(raw.indpro.value)          : null,
        ip_mom_pct:                   raw.indpro_mom_pct,
        capacity_utilization_pct:     raw.tcu     ? r2(raw.tcu.value)             : null,
        cap_util_mom_pp:              raw.tcu_mom_chg,
        durable_goods_orders_bn:      raw.amtmno  ? r2(raw.amtmno.value / 1000)   : null,
        durable_orders_mom_pct:       raw.amtmno_mom_pct,
        mfg_production_index:         raw.ipman   ? r2(raw.ipman.value)           : null,
        mfg_output_mom_pct:           raw.ipman_mom_pct,
        mfg_employment_k:             raw.manemp  ? r2(raw.manemp.value)          : null,
        mfg_employment_mom_chg_k:     raw.manemp_mom_chg,
        inventory_sales_ratio:        raw.isratio ? raw.isratio.value             : null,
        ppi_all_commodities:          raw.ppiaco  ? r2(raw.ppiaco.value)          : null,
        ppi_mom_pct:                  raw.ppiaco_mom_pct,
        capacity_regime:              interp.capacity_regime,
        input_cost_pressure:          interp.input_cost_pressure,
        inventory_posture:            interp.inventory_posture,
        output_trend:                 interp.output_trend,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
