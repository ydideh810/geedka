// metals-brief.js
//
// AI-synthesized precious and industrial metals market intelligence brief.
//
// Gathers 9 real-time signals from Yahoo Finance (free, no key), then uses
// gpt-4o-mini to produce a structured ~200-word metals market assessment.
// One call replaces manual assembly of 9 live tickers + LLM synthesis.
//
// Signals assembled:
//   1. Gold futures        (GC=F) — safe-haven + inflation indicator
//   2. Silver futures      (SI=F) — dual safe-haven/industrial; G/S ratio derived
//   3. Copper futures      (HG=F) — "Dr. Copper" economic leading indicator
//   4. Platinum futures    (PL=F) — automotive + hydrogen economy signal
//   5. Gold ETF            (GLD)  — equity market view on gold
//   6. Silver ETF          (SLV)  — equity market view on silver
//   7. Copper Miners ETF   (COPX) — mining activity + margins proxy
//   8. Newmont Mining      (NEM)  — gold major bellwether
//   9. Freeport-McMoRan    (FCX)  — copper/gold major; economic cycle proxy
//
// Derived: Gold/Silver ratio, metals regime classification, 52-week positioning.
//
// Seam: Bloomberg/Refinitiv charge $50-200/mo for structured metals data.
//       STALL delivers real-time Yahoo Finance + GPT synthesis at $0.35/call.
//
// Upstreams: Yahoo Finance v8 chart (free, no auth) + gpt-4o-mini (OPENAI_API_KEY).

const YF_BASE    = "https://query1.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; the-stall/4.64; +https://intuitek.ai)";
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
  const SYMS    = ["GC=F", "SI=F", "HG=F", "PL=F", "GLD", "SLV", "COPX", "NEM", "FCX"];
  const results = await Promise.allSettled(SYMS.map(s => fetchQuote(s)));
  const Q       = {};
  SYMS.forEach((s, i) => { Q[s] = results[i].status === "fulfilled" ? results[i].value : null; });

  const gold   = Q["GC=F"];
  const silver = Q["SI=F"];
  const copper = Q["HG=F"];

  const goldSilverRatio = (gold?.price && silver?.price && silver.price > 0)
    ? r2(gold.price / silver.price)
    : null;

  // Regime: based on gold performance + copper performance
  let metals_regime = "MIXED";
  const goldUp   = gold?.change_pct  != null && gold.change_pct  > 0;
  const silverUp = silver?.change_pct != null && silver.change_pct > 0;
  const copperUp = copper?.change_pct != null && copper.change_pct > 0;

  if (goldUp && silverUp && copperUp)           metals_regime = "BROAD_METALS_RALLY";
  else if (goldUp && silverUp && !copperUp)     metals_regime = "PRECIOUS_RALLY";
  else if (!goldUp && copperUp)                 metals_regime = "INDUSTRIAL_RALLY";
  else if (!goldUp && !silverUp && !copperUp)   metals_regime = "METALS_RISK_OFF";
  else if (gold?.pct_from_52w_high != null && gold.pct_from_52w_high > -5) metals_regime = "GOLD_NEAR_HIGH";

  return {
    gold_futures:    gold,
    silver_futures:  silver,
    copper_futures:  copper,
    platinum_futures: Q["PL=F"],
    gold_etf_gld:    Q["GLD"],
    silver_etf_slv:  Q["SLV"],
    copper_miners_copx: Q["COPX"],
    newmont_nem:     Q["NEM"],
    freeport_fcx:    Q["FCX"],
    derived: {
      gold_silver_ratio: goldSilverRatio,
      metals_regime,
      gold_pct_from_52w_high:   gold?.pct_from_52w_high,
      copper_pct_from_52w_high: copper?.pct_from_52w_high,
    },
  };
}

async function synthesize(raw, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const wordTarget = style === "concise" ? 100 : 200;

  const prompt = `You are a metals market intelligence analyst. Given real-time spot and equity data, produce a structured JSON briefing for AI agents managing commodity exposure or macro portfolios.

LIVE DATA:
${JSON.stringify(raw, null, 2)}

RESPOND WITH VALID JSON ONLY (no markdown fences):
{
  "metals_regime": "${raw.derived.metals_regime}",
  "situation": "<one-sentence metals market summary>",
  "dominant_driver": "<main force moving metals today — geopolitical, inflation, industrial demand, dollar strength, etc.>",
  "agent_implication": "<concrete relevance for AI agents — portfolio hedge, commodity allocation, risk signal>",
  "narrative": "<${wordTarget}-word briefing covering gold/silver safe-haven dynamics, copper economic signal, gold/silver ratio context, and regime implications>",
  "confidence": <0.0–1.0>
}`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(GPT_TMO),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${err.slice(0, 120)}`);
  }

  const data  = await resp.json();
  const raw2  = data.choices?.[0]?.message?.content || "";
  const clean = raw2.replace(/```json\n?|\n?```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  name:  "metals-brief",
  price: "$0.35",

  description:
    "AI-synthesized precious and industrial metals market brief. Assembles 9 real-time signals from Yahoo Finance: gold futures (GC=F), silver futures with G/S ratio, copper futures (Dr. Copper economic indicator), platinum futures, GLD/SLV ETFs, copper miners ETF (COPX), Newmont Mining (NEM), and Freeport-McMoRan (FCX). Returns 52-week positioning, gold/silver ratio, metals regime classification (PRECIOUS_RALLY/INDUSTRIAL_RALLY/BROAD_RALLY/RISK_OFF), and ~200-word GPT-4o-mini briefing covering safe-haven dynamics, industrial demand signal, and agent portfolio implications.",

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
      metals_regime:     { type: "string", description: "BROAD_METALS_RALLY | PRECIOUS_RALLY | INDUSTRIAL_RALLY | GOLD_NEAR_HIGH | METALS_RISK_OFF | MIXED" },
      situation:         { type: "string", description: "One-sentence metals market summary." },
      dominant_driver:   { type: "string", description: "Main force moving metals today." },
      agent_implication: { type: "string", description: "Concrete action relevance for AI agents." },
      narrative:         { type: "string", description: "Full ~200-word briefing narrative." },
      confidence:        { type: "number", description: "Synthesis confidence 0–1." },
      precious: {
        type: "object",
        description: "Precious metals spot prices.",
        properties: {
          gold_oz:     { type: "object" },
          silver_oz:   { type: "object" },
          platinum_oz: { type: "object" },
        },
      },
      industrial: {
        type: "object",
        description: "Industrial metals.",
        properties: {
          copper_lb: { type: "object" },
        },
      },
      ratios: {
        type: "object",
        description: "Derived ratios.",
        properties: {
          gold_silver_ratio: { type: "number" },
        },
      },
      equities: {
        type: "object",
        description: "Mining equity performance.",
        properties: {
          gld_etf:    { type: "object" },
          slv_etf:    { type: "object" },
          copx_etf:   { type: "object" },
          nem_newmont: { type: "object" },
          fcx_freeport: { type: "object" },
        },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const style = query.style || "standard";

    const raw    = await gatherSignals();
    const signalCount = Object.values(raw)
      .filter(v => v && typeof v === "object" && v.price != null).length;
    if (signalCount === 0) {
      throw Object.assign(
        new Error("Yahoo Finance rate-limited — all metals signals unavailable. Retry in 5 minutes."),
        { status: 503 },
      );
    }

    const synth = await synthesize(raw, style);

    return {
      ...synth,
      precious: {
        gold_oz:     raw.gold_futures     ? { price: raw.gold_futures.price,     change_pct: raw.gold_futures.change_pct,     week_52_high: raw.gold_futures.week_52_high,     pct_from_52w_high: raw.gold_futures.pct_from_52w_high     } : null,
        silver_oz:   raw.silver_futures   ? { price: raw.silver_futures.price,   change_pct: raw.silver_futures.change_pct,   week_52_high: raw.silver_futures.week_52_high,   pct_from_52w_high: raw.silver_futures.pct_from_52w_high   } : null,
        platinum_oz: raw.platinum_futures ? { price: raw.platinum_futures.price, change_pct: raw.platinum_futures.change_pct, week_52_high: raw.platinum_futures.week_52_high                                                                  } : null,
      },
      industrial: {
        copper_lb: raw.copper_futures ? { price: raw.copper_futures.price, change_pct: raw.copper_futures.change_pct, pct_from_52w_high: raw.copper_futures.pct_from_52w_high } : null,
      },
      ratios: {
        gold_silver_ratio: raw.derived.gold_silver_ratio,
      },
      equities: {
        gld_etf:      raw.gold_etf_gld      ? { price: raw.gold_etf_gld.price,      change_pct: raw.gold_etf_gld.change_pct      } : null,
        slv_etf:      raw.silver_etf_slv    ? { price: raw.silver_etf_slv.price,    change_pct: raw.silver_etf_slv.change_pct    } : null,
        copx_etf:     raw.copper_miners_copx ? { price: raw.copper_miners_copx.price, change_pct: raw.copper_miners_copx.change_pct } : null,
        nem_newmont:  raw.newmont_nem        ? { price: raw.newmont_nem.price,        change_pct: raw.newmont_nem.change_pct        } : null,
        fcx_freeport: raw.freeport_fcx      ? { price: raw.freeport_fcx.price,      change_pct: raw.freeport_fcx.change_pct      } : null,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
