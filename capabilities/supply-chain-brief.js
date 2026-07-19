// supply-chain-brief.js
//
// AI-synthesized global supply chain intelligence briefing.
//
// Gathers 10 real-time market signals from Yahoo Finance (free, no key) covering
// shipping, logistics, freight, and industrial commodity inputs, then uses
// gpt-4o-mini to produce a structured ~200-word supply chain assessment.
// One call replaces manual assembly of 10 live tickers + LLM synthesis.
//
// Signals assembled:
//   1. BDRY (Dry Bulk Shipping ETF)   — Baltic Dry Index proxy; ocean freight demand
//   2. FDX  (FedEx)                   — parcel/freight network health
//   3. UPS  (United Parcel Service)   — US logistics & parcel proxy
//   4. XPO  (XPO Logistics)           — less-than-truckload freight
//   5. ODFL (Old Dominion Freight)    — LTL pricing power / freight volumes
//   6. CHRW (C.H. Robinson)           — freight brokerage / spot rates proxy
//   7. MATX (Matson Navigation)       — trans-Pacific container shipping
//   8. HG=F (Copper Futures)          — global manufacturing demand signal
//   9. NUE  (Nucor Steel)             — domestic steel supply/demand
//  10. ALB  (Albemarle)               — critical minerals / battery supply chain
//
// Derived: LTL freight momentum (ODFL + XPO composite), ocean vs land spread.
//
// Seam: agents modeling supply chain risk, logistics bottlenecks, input cost
// inflation, or manufacturing lead times need a single synthesized signal.
// No port APIs, no freight exchange auth required.
// Priced at $0.35 — brief-family pattern.
//
// Upstreams: Yahoo Finance v8 chart (free, no auth) + gpt-4o-mini (OPENAI_API_KEY).

const YF_BASE    = "https://query1.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; myriad/4.64; +https://synaptiic.org)";
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
    price:             price ? r2(price) : null,
    change_pct:        pct(price, prev),
    week_52_high:      w52Hi ? r2(w52Hi) : null,
    week_52_low:       w52Lo ? r2(w52Lo) : null,
    pct_from_52w_high: (price && w52Hi) ? pct(price, w52Hi) : null,
    pct_from_52w_low:  (price && w52Lo) ? pct(price, w52Lo) : null,
  };
}

async function gatherSignals() {
  const SYMS    = ["BDRY", "FDX", "UPS", "XPO", "ODFL", "CHRW", "MATX", "HG=F", "NUE", "ALB"];
  const results = await Promise.allSettled(SYMS.map(s => fetchQuote(s)));
  const Q       = {};
  SYMS.forEach((s, i) => { Q[s] = results[i].status === "fulfilled" ? results[i].value : null; });

  const odfl = Q["ODFL"];
  const xpo  = Q["XPO"];
  const chrw = Q["CHRW"];

  return {
    dry_bulk_shipping:  Q["BDRY"],
    fedex:              Q["FDX"],
    ups:                Q["UPS"],
    xpo_logistics:      Q["XPO"],
    old_dominion_ltl:   Q["ODFL"],
    ch_robinson_broker: Q["CHRW"],
    matson_shipping:    Q["MATX"],
    copper_futures:     Q["HG=F"],
    nucor_steel:        Q["NUE"],
    albemarle_minerals: Q["ALB"],
    derived: {
      ltl_freight_momentum: (() => {
        const vals = [odfl?.change_pct, xpo?.change_pct, chrw?.change_pct].filter(v => v != null);
        if (!vals.length) return null;
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return r2(avg);
      })(),
      freight_signal:    (() => {
        const vals = [odfl?.change_pct, xpo?.change_pct, chrw?.change_pct].filter(v => v != null);
        if (!vals.length) return "unknown";
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return avg > 1.0 ? "expansion" : avg > 0 ? "stable" : avg > -1.0 ? "softening" : "contraction";
      })(),
      copper_regime:  (() => {
        const hg = Q["HG=F"];
        if (!hg?.price) return "unknown";
        return hg.price > 4.5 ? "tight" : hg.price > 3.5 ? "normal" : "weak";
      })(),
    },
  };
}

async function synthesize(signals, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const bdry = signals.dry_bulk_shipping;
  const fdx  = signals.fedex;
  const odfl = signals.old_dominion_ltl;
  const matx = signals.matson_shipping;
  const hg   = signals.copper_futures;
  const d    = signals.derived;

  const block = [
    `Ocean freight (BDRY dry bulk ETF): ${bdry?.change_pct ?? "N/A"}% today ($${bdry?.price ?? "N/A"}, ${bdry?.pct_from_52w_high ?? "N/A"}% from 52w high)`,
    `Trans-Pacific container (MATX): ${matx?.change_pct ?? "N/A"}% today`,
    `LTL freight composite: ${d.ltl_freight_momentum != null ? d.ltl_freight_momentum + "% avg" : "N/A"} — signal: ${d.freight_signal} | ODFL: ${odfl?.change_pct ?? "N/A"}% | XPO: ${signals.xpo_logistics?.change_pct ?? "N/A"}% | C.H. Robinson: ${signals.ch_robinson_broker?.change_pct ?? "N/A"}%`,
    `Parcel/express: FedEx ${fdx?.change_pct ?? "N/A"}% | UPS ${signals.ups?.change_pct ?? "N/A"}%`,
    `Industrial inputs: Copper $${hg?.price ?? "N/A"}/lb (${hg?.change_pct ?? "N/A"}% today) — regime: ${d.copper_regime} | Steel (Nucor NUE): ${signals.nucor_steel?.change_pct ?? "N/A"}%`,
    `Critical minerals (Albemarle ALB): ${signals.albemarle_minerals?.change_pct ?? "N/A"}% today`,
  ].join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 180-220 words.";

  const prompt = `You are a senior supply chain analyst writing a daily situation briefing for AI agents. Synthesize the supply chain market signal data below into a coherent, actionable assessment of current global supply chain conditions.

CURRENT SIGNAL DATA (Yahoo Finance real-time):
${block}

${toneClause} Focus on: (1) the overall supply chain regime (tight/normal/loose/disrupted) and key driver, (2) the single most important signal for agents modeling logistics, inventory, or input costs, and (3) one concrete implication for agent decision-making.

Write in plain professional prose. Do not use bullet points. Do not repeat raw numbers unless critical. Do not start with "Based on".

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "situation": "one sentence: the core supply chain regime in plain language",
  "dominant_signal": "one sentence: the most important supply chain signal",
  "agent_implication": "one sentence: concrete action relevance for AI agents",
  "narrative": "the full briefing paragraph",
  "supply_chain_regime": "tight" | "normal" | "loose" | "disrupted" | "uncertain",
  "freight_signal": "expansion" | "stable" | "softening" | "contraction" | "unknown",
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
  name:  "supply-chain-brief",
  price: "$0.35",

  description:
    "AI-synthesized global supply chain intelligence brief. Assembles 10 real-time signals from Yahoo Finance: dry bulk shipping ETF (BDRY/Baltic Dry proxy), FedEx, UPS, XPO Logistics, Old Dominion LTL, C.H. Robinson freight brokerage, Matson trans-Pacific shipping, copper futures, Nucor steel, and Albemarle critical minerals. Returns LTL freight momentum composite, supply-chain regime classification, and a 200-word GPT-4o-mini narrative covering logistics health, input costs, and agent implications. No freight exchange or port API auth required.",

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
      supply_chain_regime: { type: "string", description: "tight | normal | loose | disrupted | uncertain" },
      situation:           { type: "string", description: "One-sentence supply chain summary." },
      dominant_signal:     { type: "string", description: "Most important supply chain signal." },
      agent_implication:   { type: "string", description: "Concrete action relevance for AI agents." },
      narrative:           { type: "string", description: "Full ~200-word briefing narrative." },
      freight_signal:      { type: "string", description: "expansion | stable | softening | contraction | unknown" },
      confidence:          { type: "number", description: "Synthesis confidence 0–1." },
      shipping: {
        type: "object",
        description: "Ocean and air freight signals.",
        properties: {
          dry_bulk_bdry:  { type: "object" },
          matson_pacific: { type: "object" },
          fedex:          { type: "object" },
          ups:            { type: "object" },
        },
      },
      ground_freight: {
        type: "object",
        description: "LTL and freight brokerage signals.",
        properties: {
          old_dominion:   { type: "object" },
          xpo_logistics:  { type: "object" },
          ch_robinson:    { type: "object" },
          ltl_composite:  { type: "number", description: "Average % change across LTL carriers." },
        },
      },
      industrial_inputs: {
        type: "object",
        description: "Key material input signals.",
        properties: {
          copper_futures:     { type: "object" },
          nucor_steel:        { type: "object" },
          albemarle_minerals: { type: "object" },
          copper_regime:      { type: "string" },
        },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const style = query.style || "standard";

    const raw        = await gatherSignals();
    const signalCount = Object.values(raw).filter(v => v && typeof v === "object" && v.price != null).length;
    if (signalCount === 0) {
      throw Object.assign(new Error("Yahoo Finance rate-limited (HTTP 429) — all supply chain signals unavailable. Please retry in 5 minutes."), { status: 503 });
    }
    const synth = await synthesize(raw, style);

    return {
      ...synth,
      shipping: {
        dry_bulk_bdry:  raw.dry_bulk_shipping ? { price: raw.dry_bulk_shipping.price,  change_pct: raw.dry_bulk_shipping.change_pct,  pct_from_52w_high: raw.dry_bulk_shipping.pct_from_52w_high  } : null,
        matson_pacific: raw.matson_shipping    ? { price: raw.matson_shipping.price,    change_pct: raw.matson_shipping.change_pct    } : null,
        fedex:          raw.fedex              ? { price: raw.fedex.price,              change_pct: raw.fedex.change_pct,              pct_from_52w_high: raw.fedex.pct_from_52w_high              } : null,
        ups:            raw.ups                ? { price: raw.ups.price,                change_pct: raw.ups.change_pct                } : null,
      },
      ground_freight: {
        old_dominion:  raw.old_dominion_ltl   ? { price: raw.old_dominion_ltl.price,   change_pct: raw.old_dominion_ltl.change_pct   } : null,
        xpo_logistics: raw.xpo_logistics      ? { price: raw.xpo_logistics.price,      change_pct: raw.xpo_logistics.change_pct      } : null,
        ch_robinson:   raw.ch_robinson_broker ? { price: raw.ch_robinson_broker.price, change_pct: raw.ch_robinson_broker.change_pct } : null,
        ltl_composite: raw.derived.ltl_freight_momentum,
      },
      industrial_inputs: {
        copper_futures:     raw.copper_futures     ? { price: raw.copper_futures.price,     change_pct: raw.copper_futures.change_pct     } : null,
        nucor_steel:        raw.nucor_steel        ? { price: raw.nucor_steel.price,        change_pct: raw.nucor_steel.change_pct        } : null,
        albemarle_minerals: raw.albemarle_minerals ? { price: raw.albemarle_minerals.price, change_pct: raw.albemarle_minerals.change_pct } : null,
        copper_regime:      raw.derived.copper_regime,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
