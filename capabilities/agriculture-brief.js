// agriculture-brief.js
//
// AI-synthesized US agricultural commodities market intelligence briefing.
//
// Gathers 9 real-time signals from Yahoo Finance (free, no key), then uses
// gpt-4o-mini to produce a structured ~200-word agricultural market assessment.
// One call replaces manual assembly of 9 live tickers + LLM synthesis.
//
// Signals assembled:
//   1. Corn futures       (ZC=F) — CBOT, benchmark grain
//   2. Wheat futures      (ZW=F) — CBOT Chicago SRW, global supply proxy
//   3. Soybean futures    (ZS=F) — CBOT, crush margin / protein market
//   4. Live Cattle        (LE=F) — CME, beef complex bellwether
//   5. Lean Hogs          (HE=F) — CME, pork complex
//   6. Coffee             (KC=F) — ICE Arabica, soft commodity
//   7. Cotton             (CT=F) — ICE, textile / fiber market
//   8. Agribusiness ETF   (MOO) — VanEck, broad sector equity signal
//   9. Deere & Company    (DE)  — farm equipment demand / farmer confidence
//
// Derived: corn/soy ratio (crush proxy), wheat/corn spread (flour premium),
//          grain supply regime classification.
//
// Seam: any commodity fund, ag-sector analyst, food supply chain agent, or
// inflation-modeling pipeline that tracks food input costs.
// Priced at $0.35/call — matches manufacturing-brief/labor-brief tier.
//
// Upstreams: Yahoo Finance v8 chart (free, no auth) + gpt-4o-mini (OPENAI_API_KEY).

const YF_BASE    = "https://query1.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; the-stall/4.65; +https://intuitek.ai)";
const YF_TMO     = 12_000;
const GPT_TMO    = 38_000;

const r2  = n => Math.round(n * 100) / 100;
const pct = (a, b) => b ? r2(((a - b) / b) * 100) : null;

async function fetchQuote(symbol) {
  const url  = `${YF_BASE}/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(YF_TMO),
  });
  if (!resp.ok) throw new Error(`YF ${symbol} HTTP ${resp.status}`);
  const data   = await resp.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`YF ${symbol}: no result`);

  const meta   = result.meta || {};
  const closes = result.indicators?.quote?.[0]?.close || [];
  const validC = closes.filter(v => v != null && !isNaN(v));
  const price  = meta.regularMarketPrice ?? validC[validC.length - 1];
  const prev   = meta.previousClose ?? meta.chartPreviousClose;
  const w52Hi  = meta.fiftyTwoWeekHigh ?? (validC.length ? Math.max(...validC) : null);
  const w52Lo  = meta.fiftyTwoWeekLow  ?? (validC.length ? Math.min(...validC) : null);

  return {
    symbol,
    price:              price ? r2(price) : null,
    change_pct:         pct(price, prev),
    week_52_high:       w52Hi ? r2(w52Hi) : null,
    week_52_low:        w52Lo ? r2(w52Lo) : null,
    pct_from_52w_high:  (price && w52Hi) ? pct(price, w52Hi) : null,
    pct_from_52w_low:   (price && w52Lo) ? pct(price, w52Lo) : null,
  };
}

async function gatherSignals() {
  const SYMS    = ["ZC=F", "ZW=F", "ZS=F", "LE=F", "HE=F", "KC=F", "CT=F", "MOO", "DE"];
  const results = await Promise.allSettled(SYMS.map(s => fetchQuote(s)));
  const Q       = {};
  SYMS.forEach((s, i) => { Q[s] = results[i].status === "fulfilled" ? results[i].value : null; });

  const corn    = Q["ZC=F"];
  const wheat   = Q["ZW=F"];
  const soy     = Q["ZS=F"];

  // Corn is priced in USX/bu (cents/bushel), Yahoo sometimes returns in full dollars
  // Derive ratios using raw price (no unit conversion needed for ratio)
  const cornSoyRatio  = (corn?.price && soy?.price) ? r2(soy.price / corn.price) : null;
  const wheatCornSprd = (wheat?.price && corn?.price) ? r2(wheat.price - corn.price) : null;

  return {
    corn,
    wheat,
    soybeans: soy,
    live_cattle:    Q["LE=F"],
    lean_hogs:      Q["HE=F"],
    coffee:         Q["KC=F"],
    cotton:         Q["CT=F"],
    agribiz_moo:    Q["MOO"],
    deere:          Q["DE"],
    derived: {
      soy_corn_ratio:     cornSoyRatio,
      wheat_corn_spread:  wheatCornSprd,
    },
  };
}

function interpretSignals(s) {
  const corn  = s.corn;
  const wheat = s.wheat;
  const soy   = s.soybeans;

  // Grain complex regime (prices in USX/bu for futures; daily ranges vary)
  const grainsBullish =
    (corn?.change_pct  != null && corn.change_pct  > 0.5) ||
    (wheat?.change_pct != null && wheat.change_pct > 0.5) ||
    (soy?.change_pct   != null && soy.change_pct   > 0.5);
  const grainsBearish =
    (corn?.change_pct  != null && corn.change_pct  < -0.5) &&
    (wheat?.change_pct != null && wheat.change_pct < -0.5);

  const cattle_strong = s.live_cattle?.change_pct != null && s.live_cattle.change_pct > 0.3;
  const cattle_weak   = s.live_cattle?.change_pct != null && s.live_cattle.change_pct < -0.3;

  const grain_regime =
    grainsBullish ? "grain_rally"
    : grainsBearish ? "grain_pressure"
    : "grain_mixed";

  const livestock_regime =
    cattle_strong ? "livestock_firm"
    : cattle_weak  ? "livestock_soft"
    : "livestock_neutral";

  return { grain_regime, livestock_regime };
}

async function synthesize(signals, interp, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const d = signals.derived;

  const block = [
    `Corn (ZC=F): ${signals.corn?.price ?? "N/A"} USX/bu (${signals.corn?.change_pct ?? "N/A"}% today, ${signals.corn?.pct_from_52w_high ?? "N/A"}% from 52w high)`,
    `Wheat (ZW=F): ${signals.wheat?.price ?? "N/A"} USX/bu (${signals.wheat?.change_pct ?? "N/A"}% today) — wheat/corn spread: ${d.wheat_corn_spread ?? "N/A"} USX/bu`,
    `Soybeans (ZS=F): ${signals.soybeans?.price ?? "N/A"} USX/bu (${signals.soybeans?.change_pct ?? "N/A"}% today) — soy/corn ratio: ${d.soy_corn_ratio ?? "N/A"}x`,
    `Live Cattle (LE=F): ${signals.live_cattle?.price ?? "N/A"} USX/lb (${signals.live_cattle?.change_pct ?? "N/A"}% today)`,
    `Lean Hogs (HE=F): ${signals.lean_hogs?.price ?? "N/A"} USX/lb (${signals.lean_hogs?.change_pct ?? "N/A"}% today)`,
    `Coffee Arabica (KC=F): ${signals.coffee?.price ?? "N/A"} USX/lb (${signals.coffee?.change_pct ?? "N/A"}% today)`,
    `Cotton (CT=F): ${signals.cotton?.price ?? "N/A"} USX/lb (${signals.cotton?.change_pct ?? "N/A"}% today)`,
    `Agribusiness ETF (MOO): ${signals.agribiz_moo?.change_pct ?? "N/A"}% today`,
    `Deere & Co (DE): ${signals.deere?.price ?? "N/A"} (${signals.deere?.change_pct ?? "N/A"}% today) — farmer confidence proxy`,
    `Grain regime: ${interp.grain_regime} | Livestock regime: ${interp.livestock_regime}`,
  ].join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 180-220 words.";

  const prompt = `You are a senior agricultural commodities analyst writing a daily situation briefing for AI agents. Synthesize the agricultural signal data below into a coherent, actionable assessment of current US ag market conditions.

CURRENT SIGNAL DATA (Yahoo Finance real-time):
${block}

${toneClause} Focus on: (1) the dominant grain/livestock market regime and what is driving it, (2) the single most important supply or demand risk for agents relying on food-price or commodity-input assumptions, and (3) one concrete implication for agent decision-making (especially food sector equity, inflation forecasting, commodity trading, or supply chain agents).

Write in plain professional prose. Do not use bullet points. Do not repeat raw numbers unless critical for context. Do not start with "Based on".

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "situation": "one sentence: the core ag market regime in plain language",
  "dominant_risk": "one sentence: the single biggest supply or demand risk",
  "agent_implication": "one sentence: concrete action relevance for AI agents",
  "narrative": "the full briefing paragraph",
  "grain_regime": "grain_rally" | "grain_pressure" | "grain_mixed" | "uncertain",
  "livestock_regime": "livestock_firm" | "livestock_soft" | "livestock_neutral" | "uncertain",
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
  name:  "agriculture-brief",
  price: "$0.35",

  description:
    "AI-synthesized US agricultural commodities market intelligence brief. Assembles 9 real-time signals from Yahoo Finance: corn futures (ZC=F), wheat (ZW=F), soybeans (ZS=F), live cattle (LE=F), lean hogs (HE=F), coffee arabica (KC=F), cotton (CT=F), agribusiness sector ETF (MOO), and Deere & Co (DE, farmer confidence proxy). Returns 52-week context, soy/corn ratio, wheat/corn spread, grain-regime and livestock-regime classification, plus a 200-word GPT-4o-mini narrative covering supply risk, dominant driver, and agent decision implications for food-sector, commodity-trading, and inflation-modeling pipelines.",

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
      grain_regime:      { type: "string", description: "grain_rally | grain_pressure | grain_mixed | uncertain" },
      livestock_regime:  { type: "string", description: "livestock_firm | livestock_soft | livestock_neutral | uncertain" },
      situation:         { type: "string", description: "One-sentence ag market summary." },
      dominant_risk:     { type: "string", description: "Most important supply or demand risk." },
      agent_implication: { type: "string", description: "Concrete action relevance for AI agents." },
      narrative:         { type: "string", description: "Full ~200-word briefing narrative." },
      confidence:        { type: "number", description: "Synthesis confidence 0–1." },
      grains: {
        type: "object",
        description: "Real-time grain futures prices.",
        properties: {
          corn_usxbu:     { type: "object" },
          wheat_usxbu:    { type: "object" },
          soybeans_usxbu: { type: "object" },
          soy_corn_ratio: { type: "number", description: "Soybean/corn price ratio — crush margin proxy." },
          wheat_corn_spread: { type: "number", description: "Wheat/corn price spread in USX/bu." },
        },
      },
      livestock: {
        type: "object",
        description: "Real-time livestock futures prices.",
        properties: {
          live_cattle_usxlb: { type: "object" },
          lean_hogs_usxlb:   { type: "object" },
        },
      },
      softs: {
        type: "object",
        description: "Soft commodity and sector signals.",
        properties: {
          coffee_arabica: { type: "object" },
          cotton:         { type: "object" },
          moo_agribiz:    { type: "object" },
          de_deere:       { type: "object" },
        },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const style = query.style || "standard";

    const raw = await gatherSignals();
    const signalCount = [raw.corn, raw.wheat, raw.soybeans, raw.live_cattle, raw.lean_hogs]
      .filter(v => v && v.price != null).length;
    if (signalCount === 0) {
      throw Object.assign(
        new Error("Yahoo Finance rate-limited (HTTP 429) — all ag signals unavailable. Please retry in 5 minutes."),
        { status: 503 }
      );
    }

    const interp = interpretSignals(raw);
    const synth  = await synthesize(raw, interp, style);

    return {
      ...synth,
      grains: {
        corn_usxbu:           raw.corn      ? { price: raw.corn.price,     change_pct: raw.corn.change_pct,     week_52_high: raw.corn.week_52_high,     week_52_low: raw.corn.week_52_low,     pct_from_52w_high: raw.corn.pct_from_52w_high     } : null,
        wheat_usxbu:          raw.wheat     ? { price: raw.wheat.price,    change_pct: raw.wheat.change_pct,    week_52_high: raw.wheat.week_52_high,    week_52_low: raw.wheat.week_52_low,    pct_from_52w_high: raw.wheat.pct_from_52w_high    } : null,
        soybeans_usxbu:       raw.soybeans  ? { price: raw.soybeans.price, change_pct: raw.soybeans.change_pct, week_52_high: raw.soybeans.week_52_high, week_52_low: raw.soybeans.week_52_low, pct_from_52w_high: raw.soybeans.pct_from_52w_high } : null,
        soy_corn_ratio:       raw.derived.soy_corn_ratio,
        wheat_corn_spread:    raw.derived.wheat_corn_spread,
      },
      livestock: {
        live_cattle_usxlb: raw.live_cattle ? { price: raw.live_cattle.price, change_pct: raw.live_cattle.change_pct, week_52_high: raw.live_cattle.week_52_high, week_52_low: raw.live_cattle.week_52_low } : null,
        lean_hogs_usxlb:   raw.lean_hogs   ? { price: raw.lean_hogs.price,   change_pct: raw.lean_hogs.change_pct,   week_52_high: raw.lean_hogs.week_52_high,   week_52_low: raw.lean_hogs.week_52_low   } : null,
      },
      softs: {
        coffee_arabica: raw.coffee      ? { price: raw.coffee.price,     change_pct: raw.coffee.change_pct,     week_52_high: raw.coffee.week_52_high     } : null,
        cotton:         raw.cotton      ? { price: raw.cotton.price,     change_pct: raw.cotton.change_pct,     week_52_high: raw.cotton.week_52_high     } : null,
        moo_agribiz:    raw.agribiz_moo ? { price: raw.agribiz_moo.price, change_pct: raw.agribiz_moo.change_pct } : null,
        de_deere:       raw.deere       ? { price: raw.deere.price,       change_pct: raw.deere.change_pct       } : null,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
