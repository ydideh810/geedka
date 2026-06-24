// tech-brief.js
//
// AI-synthesized US technology sector intelligence briefing.
//
// Gathers 10 real-time signals from Yahoo Finance (free, no key), then uses
// gpt-4o-mini to produce a structured ~200-word technology market assessment.
// One call replaces manual assembly of 10 live tickers + LLM synthesis.
//
// Signals assembled:
//   1. QQQ (Nasdaq-100 ETF)      — broad tech/growth benchmark
//   2. XLK (Tech sector ETF)     — pure-play tech equity performance
//   3. SMH (Semiconductor ETF)   — chip cycle proxy
//   4. NVIDIA         (NVDA)     — AI / GPU bellwether
//   5. Apple          (AAPL)     — consumer tech + services
//   6. Microsoft      (MSFT)     — cloud + enterprise AI
//   7. Alphabet       (GOOG)     — search + cloud + AI
//   8. Meta           (META)     — social + AI compute
//   9. AMD            (AMD)      — GPU / CPU competitive proxy
//  10. Intel          (INTC)     — legacy semiconductor health
//
// Derived: Nasdaq vs 52w high spread, SMH/QQQ ratio (semiconductor leadership).
//
// Seam: agents running tech research, AI infrastructure, or equity analysis
// pipelines need a single synthesized tech-sector signal. Priced at $0.35 —
// same brief-family pattern as energy-brief ($0.65) and equity-brief ($0.35).
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
  const SYMS    = ["QQQ", "XLK", "SMH", "NVDA", "AAPL", "MSFT", "GOOG", "META", "AMD", "INTC"];
  const results = await Promise.allSettled(SYMS.map(s => fetchQuote(s)));
  const Q       = {};
  SYMS.forEach((s, i) => { Q[s] = results[i].status === "fulfilled" ? results[i].value : null; });

  const qqq = Q["QQQ"];
  const smh = Q["SMH"];

  return {
    qqq_nasdaq100:     Q["QQQ"],
    xlk_tech_etf:      Q["XLK"],
    smh_semis_etf:     Q["SMH"],
    nvidia:            Q["NVDA"],
    apple:             Q["AAPL"],
    microsoft:         Q["MSFT"],
    alphabet:          Q["GOOG"],
    meta:              Q["META"],
    amd:               Q["AMD"],
    intel:             Q["INTC"],
    derived: {
      qqq_pct_from_52w_high: qqq?.pct_from_52w_high ?? null,
      smh_vs_qqq_ratio:      (smh?.price && qqq?.price) ? r2(smh.price / qqq.price) : null,
      semi_leadership:       (smh?.change_pct != null && qqq?.change_pct != null)
        ? (smh.change_pct > qqq.change_pct ? "semis_outperforming" : "semis_lagging")
        : null,
    },
  };
}

function interpretSignals(s) {
  const qqq = s.qqq_nasdaq100;
  const regime =
    !qqq                         ? "unknown"
    : qqq.pct_from_52w_high > -5 ? "near_peak"
    : qqq.pct_from_52w_high > -15 ? "pullback"
    : qqq.pct_from_52w_high > -30 ? "correction"
    :                               "bear_market";
  return { tech_regime: regime };
}

async function synthesize(signals, interp, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const q = signals.qqq_nasdaq100;
  const x = signals.xlk_tech_etf;
  const s = signals.smh_semis_etf;
  const d = signals.derived;

  const block = [
    `Nasdaq-100 (QQQ): $${q?.price ?? "N/A"} (${q?.change_pct ?? "N/A"}% today, ${q?.pct_from_52w_high ?? "N/A"}% from 52w high) — regime: ${interp.tech_regime}`,
    `Tech sector ETF (XLK): ${x?.change_pct ?? "N/A"}% today`,
    `Semiconductor ETF (SMH): ${s?.change_pct ?? "N/A"}% today — ${d.semi_leadership ?? "unknown vs Nasdaq"}`,
    `NVIDIA: ${signals.nvidia?.change_pct ?? "N/A"}% | Apple: ${signals.apple?.change_pct ?? "N/A"}% | Microsoft: ${signals.microsoft?.change_pct ?? "N/A"}%`,
    `Alphabet: ${signals.alphabet?.change_pct ?? "N/A"}% | Meta: ${signals.meta?.change_pct ?? "N/A"}%`,
    `AMD: ${signals.amd?.change_pct ?? "N/A"}% | Intel: ${signals.intel?.change_pct ?? "N/A"}%`,
  ].join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 180-220 words.";

  const prompt = `You are a senior technology sector analyst writing a daily situation briefing for AI agents. Synthesize the technology market signal data below into a coherent, actionable assessment of current US technology sector conditions.

CURRENT SIGNAL DATA (Yahoo Finance real-time):
${block}

${toneClause} Focus on: (1) the overall tech sector regime and what is driving it, (2) the single most important signal for agents relying on tech assumptions (AI capex, chip cycle, consumer demand, enterprise spend), and (3) one concrete implication for agent decision-making.

Write in plain professional prose. Do not use bullet points. Do not repeat raw numbers unless critical. Do not start with "Based on".

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "situation": "one sentence: the core tech market regime in plain language",
  "dominant_signal": "one sentence: the single most important signal from the data",
  "agent_implication": "one sentence: concrete action relevance for AI agents",
  "narrative": "the full briefing paragraph",
  "tech_regime": "near_peak" | "pullback" | "correction" | "bear_market" | "uncertain",
  "semi_leadership": "outperforming" | "lagging" | "neutral" | "unknown",
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
  name:  "tech-brief",
  price: "$0.35",

  description:
    "AI-synthesized US technology sector intelligence brief. Assembles 10 real-time signals from Yahoo Finance: Nasdaq-100 (QQQ), tech sector ETF (XLK), semiconductor ETF (SMH), NVIDIA, Apple, Microsoft, Alphabet, Meta, AMD, and Intel. Returns 52-week context, semiconductor leadership signal, tech-regime classification, and a 200-word GPT-4o-mini narrative covering sector momentum, dominant risk, and agent decision implications.",

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
      tech_regime:       { type: "string", description: "near_peak | pullback | correction | bear_market | uncertain" },
      situation:         { type: "string", description: "One-sentence tech sector summary." },
      dominant_signal:   { type: "string", description: "Most important signal from the data." },
      agent_implication: { type: "string", description: "Concrete action relevance for AI agents." },
      narrative:         { type: "string", description: "Full ~200-word briefing narrative." },
      semi_leadership:   { type: "string", description: "Whether semiconductors are outperforming or lagging." },
      confidence:        { type: "number", description: "Synthesis confidence 0–1." },
      benchmarks: {
        type: "object",
        description: "Core tech benchmark performance.",
        properties: {
          qqq_nasdaq100: { type: "object" },
          xlk_tech_etf:  { type: "object" },
          smh_semis_etf: { type: "object" },
        },
      },
      megacaps: {
        type: "object",
        description: "Mega-cap tech individual performance.",
        properties: {
          nvidia:    { type: "object" },
          apple:     { type: "object" },
          microsoft: { type: "object" },
          alphabet:  { type: "object" },
          meta:      { type: "object" },
          amd:       { type: "object" },
          intel:     { type: "object" },
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
      throw Object.assign(new Error("Yahoo Finance rate-limited (HTTP 429) — all tech signals unavailable. Please retry in 5 minutes."), { status: 503 });
    }
    const interp = interpretSignals(raw);
    const synth  = await synthesize(raw, interp, style);

    return {
      ...synth,
      benchmarks: {
        qqq_nasdaq100: raw.qqq_nasdaq100 ? { price: raw.qqq_nasdaq100.price, change_pct: raw.qqq_nasdaq100.change_pct, pct_from_52w_high: raw.qqq_nasdaq100.pct_from_52w_high } : null,
        xlk_tech_etf:  raw.xlk_tech_etf  ? { price: raw.xlk_tech_etf.price,  change_pct: raw.xlk_tech_etf.change_pct  } : null,
        smh_semis_etf: raw.smh_semis_etf ? { price: raw.smh_semis_etf.price, change_pct: raw.smh_semis_etf.change_pct, semi_leadership: raw.derived.semi_leadership } : null,
      },
      megacaps: {
        nvidia:    raw.nvidia    ? { price: raw.nvidia.price,    change_pct: raw.nvidia.change_pct    } : null,
        apple:     raw.apple     ? { price: raw.apple.price,     change_pct: raw.apple.change_pct     } : null,
        microsoft: raw.microsoft ? { price: raw.microsoft.price, change_pct: raw.microsoft.change_pct } : null,
        alphabet:  raw.alphabet  ? { price: raw.alphabet.price,  change_pct: raw.alphabet.change_pct  } : null,
        meta:      raw.meta      ? { price: raw.meta.price,      change_pct: raw.meta.change_pct      } : null,
        amd:       raw.amd       ? { price: raw.amd.price,       change_pct: raw.amd.change_pct       } : null,
        intel:     raw.intel     ? { price: raw.intel.price,     change_pct: raw.intel.change_pct     } : null,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
