// geopolitical-brief.js
//
// AI-synthesized geopolitical risk intelligence briefing via market-implied signals.
//
// Gathers 10 real-time market signals that reflect geopolitical risk pricing —
// no news API key required. Uses Yahoo Finance (free, no auth) to assemble
// safe-haven flows, risk proxies, and cross-asset signals, then uses
// gpt-4o-mini to produce a structured ~200-word geopolitical risk assessment.
//
// Signals assembled (all market-implied, no news API needed):
//   1. VIX (CBOE Volatility Index)  — global fear gauge
//   2. GLD (Gold ETF)               — safe-haven demand proxy
//   3. TLT (20Y Treasury ETF)       — flight-to-safety signal
//   4. UUP (USD Index ETF)          — dollar safe-haven demand
//   5. EEM (Emerging Markets ETF)   — EM risk-off proxy
//   6. FXI (China Large-Cap ETF)    — China geopolitical proxy
//   7. EWJ (Japan ETF)              — Asia stability proxy
//   8. CL=F (WTI Crude Futures)     — energy supply disruption risk
//   9. HG=F (Copper Futures)        — global demand / supply chain proxy
//  10. GC=F (Gold Futures)          — institutional safe-haven vs GLD ETF
//
// Derived: gold/copper ratio (geopolitical fear vs growth), VIX regime,
//   safe-haven composite (gold + TLT + USD), EM stress signal.
//
// Seam: agents modeling geopolitical risk for portfolio allocation, supply
// chain disruption assessment, or macro scenario planning. No news API needed.
// Priced at $0.35 — brief-family pattern.
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
  const SYMS    = ["^VIX", "GLD", "TLT", "UUP", "EEM", "FXI", "EWJ", "CL=F", "HG=F", "GC=F"];
  const results = await Promise.allSettled(SYMS.map(s => fetchQuote(s)));
  const Q       = {};
  SYMS.forEach((s, i) => { Q[s] = results[i].status === "fulfilled" ? results[i].value : null; });

  const vix = Q["^VIX"];
  const gld = Q["GLD"];
  const hg  = Q["HG=F"];
  const gc  = Q["GC=F"];

  return {
    vix_fear_gauge:    Q["^VIX"],
    gold_etf:          Q["GLD"],
    treasury_tlt:      Q["TLT"],
    usd_index_uup:     Q["UUP"],
    emerging_markets:  Q["EEM"],
    china_fxi:         Q["FXI"],
    japan_ewj:         Q["EWJ"],
    crude_oil:         Q["CL=F"],
    copper_futures:    Q["HG=F"],
    gold_futures:      Q["GC=F"],
    derived: {
      vix_level:          vix?.price ?? null,
      vix_regime:         !vix ? "unknown"
        : vix.price > 35   ? "extreme_fear"
        : vix.price > 25   ? "elevated_fear"
        : vix.price > 18   ? "normal"
        :                    "complacency",
      gold_copper_ratio:  (gc?.price && hg?.price) ? r2(gc.price / hg.price) : null,
      safe_haven_signal:  (() => {
        const pos = [gld?.change_pct, Q["TLT"]?.change_pct, Q["UUP"]?.change_pct].filter(v => v != null);
        if (!pos.length) return "unknown";
        const avg = pos.reduce((a, b) => a + b, 0) / pos.length;
        return avg > 0.3 ? "strong_safe_haven_bid" : avg > 0 ? "mild_safe_haven_bid" : "risk_on";
      })(),
    },
  };
}

async function synthesize(signals, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const vix = signals.vix_fear_gauge;
  const gld = signals.gold_etf;
  const tlt = signals.treasury_tlt;
  const eem = signals.emerging_markets;
  const fxi = signals.china_fxi;
  const oil = signals.crude_oil;
  const d   = signals.derived;

  const block = [
    `VIX fear gauge: ${vix?.price ?? "N/A"} (${vix?.change_pct ?? "N/A"}% today) — regime: ${d.vix_regime ?? "unknown"}`,
    `Safe-haven composite: Gold ETF (GLD) ${gld?.change_pct ?? "N/A"}% | 20Y Treasury (TLT) ${tlt?.change_pct ?? "N/A"}% | USD ETF (UUP) ${signals.usd_index_uup?.change_pct ?? "N/A"}% → ${d.safe_haven_signal}`,
    `Gold/copper ratio: ${d.gold_copper_ratio ?? "N/A"} (higher = more fear vs growth)`,
    `Geopolitical proxies: Emerging Markets (EEM) ${eem?.change_pct ?? "N/A"}% | China (FXI) ${fxi?.change_pct ?? "N/A"}% | Japan (EWJ) ${signals.japan_ewj?.change_pct ?? "N/A"}%`,
    `Energy supply risk: WTI crude $${oil?.price ?? "N/A"}/bbl (${oil?.change_pct ?? "N/A"}% today, ${oil?.pct_from_52w_high ?? "N/A"}% from 52w high)`,
    `Copper futures: $${signals.copper_futures?.price ?? "N/A"}/lb (${signals.copper_futures?.change_pct ?? "N/A"}% today — global demand proxy)`,
  ].join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 180-220 words.";

  const prompt = `You are a senior geopolitical risk analyst writing a daily situation briefing for AI agents. Synthesize the market-implied geopolitical risk signals below into a coherent assessment. These are all market signals — no direct news — so reason from what markets are pricing in.

CURRENT SIGNAL DATA (Yahoo Finance real-time):
${block}

${toneClause} Focus on: (1) what the combined signals imply about current geopolitical risk level and where it is concentrated, (2) the single most important market-implied warning signal, and (3) one concrete implication for agent decision-making (portfolio, supply chain, or macro planning).

Write in plain professional prose. Do not use bullet points. Do not repeat raw numbers unless critical. Do not start with "Based on". Acknowledge the signals are market-implied (not news).

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "situation": "one sentence: current geopolitical risk regime implied by markets",
  "dominant_signal": "one sentence: the most important market-implied warning",
  "agent_implication": "one sentence: concrete action relevance for AI agents",
  "narrative": "the full briefing paragraph",
  "geopolitical_regime": "calm" | "elevated" | "stressed" | "crisis" | "uncertain",
  "safe_haven_signal": "strong_bid" | "mild_bid" | "risk_on" | "mixed" | "unknown",
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
  name:  "geopolitical-brief",
  price: "$0.35",

  description:
    "AI-synthesized geopolitical risk intelligence brief via market-implied signals. No news API required. Assembles 10 market signals from Yahoo Finance: VIX fear gauge, gold ETF (GLD), 20Y Treasury ETF (TLT), USD index ETF (UUP), emerging markets (EEM), China ETF (FXI), Japan ETF (EWJ), WTI crude futures, copper futures, and gold futures. Derives gold/copper ratio, VIX regime, and safe-haven composite. Returns a 200-word GPT-4o-mini geopolitical risk assessment with regime classification and agent implications.",

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
      geopolitical_regime: { type: "string", description: "calm | elevated | stressed | crisis | uncertain" },
      situation:           { type: "string", description: "One-sentence geopolitical risk summary." },
      dominant_signal:     { type: "string", description: "Most important market-implied warning." },
      agent_implication:   { type: "string", description: "Concrete action relevance for AI agents." },
      narrative:           { type: "string", description: "Full ~200-word briefing narrative." },
      safe_haven_signal:   { type: "string", description: "strong_bid | mild_bid | risk_on | mixed | unknown" },
      confidence:          { type: "number", description: "Synthesis confidence 0–1." },
      fear_indicators: {
        type: "object",
        description: "Core fear and safe-haven signals.",
        properties: {
          vix:         { type: "object" },
          gold_etf:    { type: "object" },
          treasury_tlt: { type: "object" },
          usd_uup:     { type: "object" },
        },
      },
      geopolitical_proxies: {
        type: "object",
        description: "Regional and risk-asset proxies.",
        properties: {
          emerging_markets: { type: "object" },
          china_fxi:        { type: "object" },
          japan_ewj:        { type: "object" },
          crude_oil:        { type: "object" },
          copper_futures:   { type: "object" },
        },
      },
      derived: {
        type: "object",
        description: "Derived composite signals.",
        properties: {
          vix_regime:        { type: "string" },
          gold_copper_ratio: { type: "number" },
          safe_haven_signal: { type: "string" },
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
      throw Object.assign(new Error("Yahoo Finance rate-limited (HTTP 429) — all geopolitical signals unavailable. Please retry in 5 minutes."), { status: 503 });
    }
    const synth = await synthesize(raw, style);

    return {
      ...synth,
      fear_indicators: {
        vix:          raw.vix_fear_gauge   ? { price: raw.vix_fear_gauge.price,   change_pct: raw.vix_fear_gauge.change_pct,   regime: raw.derived.vix_regime  } : null,
        gold_etf:     raw.gold_etf         ? { price: raw.gold_etf.price,         change_pct: raw.gold_etf.change_pct,         pct_from_52w_high: raw.gold_etf.pct_from_52w_high          } : null,
        treasury_tlt: raw.treasury_tlt     ? { price: raw.treasury_tlt.price,     change_pct: raw.treasury_tlt.change_pct     } : null,
        usd_uup:      raw.usd_index_uup    ? { price: raw.usd_index_uup.price,    change_pct: raw.usd_index_uup.change_pct    } : null,
      },
      geopolitical_proxies: {
        emerging_markets: raw.emerging_markets ? { price: raw.emerging_markets.price, change_pct: raw.emerging_markets.change_pct } : null,
        china_fxi:        raw.china_fxi        ? { price: raw.china_fxi.price,        change_pct: raw.china_fxi.change_pct        } : null,
        japan_ewj:        raw.japan_ewj        ? { price: raw.japan_ewj.price,        change_pct: raw.japan_ewj.change_pct        } : null,
        crude_oil:        raw.crude_oil        ? { price: raw.crude_oil.price,        change_pct: raw.crude_oil.change_pct,       pct_from_52w_high: raw.crude_oil.pct_from_52w_high        } : null,
        copper_futures:   raw.copper_futures   ? { price: raw.copper_futures.price,   change_pct: raw.copper_futures.change_pct   } : null,
      },
      derived: {
        vix_regime:        raw.derived.vix_regime,
        gold_copper_ratio: raw.derived.gold_copper_ratio,
        safe_haven_signal: raw.derived.safe_haven_signal,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
