// healthcare-brief.js
//
// AI-synthesized US healthcare & biotech sector intelligence briefing.
//
// Gathers 10 real-time signals from Yahoo Finance (free, no key), then uses
// gpt-4o-mini to produce a structured ~200-word healthcare market assessment.
// One call replaces manual assembly of 10 live tickers + LLM synthesis.
//
// Signals assembled:
//   1. XLV  (Healthcare sector ETF) — broad healthcare benchmark
//   2. IBB  (Biotech ETF)           — large-cap biotech performance
//   3. XBI  (Biotech ETF small-cap) — small/mid biotech risk appetite
//   4. Eli Lilly       (LLY)        — GLP-1/obesity/diabetes bellwether
//   5. UnitedHealth    (UNH)        — managed care / payer health
//   6. Johnson & Johnson (JNJ)      — diversified pharma + medtech
//   7. AbbVie          (ABBV)       — biopharma / immunology
//   8. Moderna         (MRNA)       — mRNA / vaccine risk proxy
//   9. Pfizer          (PFE)        — established pharma pipeline proxy
//  10. Medtronic       (MDT)        — medical devices
//
// Derived: XBI/IBB ratio (small-cap risk appetite), LLY dominance flag.
//
// Seam: agents analyzing pharma/biotech exposure, drug pipeline risk, managed
// care margins, or FDA approval calendars need a synthesized healthcare signal.
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
  const SYMS    = ["XLV", "IBB", "XBI", "LLY", "UNH", "JNJ", "ABBV", "MRNA", "PFE", "MDT"];
  const results = await Promise.allSettled(SYMS.map(s => fetchQuote(s)));
  const Q       = {};
  SYMS.forEach((s, i) => { Q[s] = results[i].status === "fulfilled" ? results[i].value : null; });

  const ibb = Q["IBB"];
  const xbi = Q["XBI"];

  return {
    xlv_healthcare:    Q["XLV"],
    ibb_biotech:       Q["IBB"],
    xbi_biotech_sm:    Q["XBI"],
    eli_lilly:         Q["LLY"],
    unitedhealth:      Q["UNH"],
    jnj:               Q["JNJ"],
    abbvie:            Q["ABBV"],
    moderna:           Q["MRNA"],
    pfizer:            Q["PFE"],
    medtronic:         Q["MDT"],
    derived: {
      xbi_vs_ibb_ratio:       (xbi?.price && ibb?.price) ? r2(xbi.price / ibb.price) : null,
      small_cap_risk_appetite: (xbi?.change_pct != null && ibb?.change_pct != null)
        ? (xbi.change_pct > ibb.change_pct ? "risk_on_biotech" : "risk_off_biotech")
        : null,
    },
  };
}

function interpretSignals(s) {
  const xlv = s.xlv_healthcare;
  const regime =
    !xlv                          ? "unknown"
    : xlv.pct_from_52w_high > -5  ? "near_peak"
    : xlv.pct_from_52w_high > -15 ? "pullback"
    : xlv.pct_from_52w_high > -30 ? "correction"
    :                               "distressed";
  return { healthcare_regime: regime };
}

async function synthesize(signals, interp, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const xlv  = signals.xlv_healthcare;
  const ibb  = signals.ibb_biotech;
  const xbi  = signals.xbi_biotech_sm;
  const lly  = signals.eli_lilly;
  const unh  = signals.unitedhealth;
  const d    = signals.derived;

  const block = [
    `Healthcare sector (XLV): $${xlv?.price ?? "N/A"} (${xlv?.change_pct ?? "N/A"}% today, ${xlv?.pct_from_52w_high ?? "N/A"}% from 52w high) — regime: ${interp.healthcare_regime}`,
    `Biotech large-cap (IBB): ${ibb?.change_pct ?? "N/A"}% today | Small-cap biotech (XBI): ${xbi?.change_pct ?? "N/A"}% today — ${d.small_cap_risk_appetite ?? "unknown"}`,
    `Eli Lilly (GLP-1 bellwether): ${lly?.change_pct ?? "N/A"}% today ($${lly?.price ?? "N/A"}, ${lly?.pct_from_52w_high ?? "N/A"}% from 52w high)`,
    `UnitedHealth (payer proxy): ${unh?.change_pct ?? "N/A"}% today`,
    `J&J: ${signals.jnj?.change_pct ?? "N/A"}% | AbbVie: ${signals.abbvie?.change_pct ?? "N/A"}% | Moderna: ${signals.moderna?.change_pct ?? "N/A"}%`,
    `Pfizer: ${signals.pfizer?.change_pct ?? "N/A"}% | Medtronic: ${signals.medtronic?.change_pct ?? "N/A"}%`,
  ].join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 180-220 words.";

  const prompt = `You are a senior healthcare sector analyst writing a daily situation briefing for AI agents. Synthesize the healthcare and biotech market signal data below into a coherent, actionable assessment.

CURRENT SIGNAL DATA (Yahoo Finance real-time):
${block}

${toneClause} Focus on: (1) the overall healthcare sector regime and key driver (GLP-1 cycle, managed care margins, biotech risk appetite, FDA calendar), (2) the single most important signal for agents modeling healthcare exposure, and (3) one concrete implication for agent decision-making.

Write in plain professional prose. Do not use bullet points. Do not repeat raw numbers unless critical. Do not start with "Based on".

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "situation": "one sentence: the core healthcare market regime in plain language",
  "dominant_signal": "one sentence: the single most important signal from the data",
  "agent_implication": "one sentence: concrete action relevance for AI agents",
  "narrative": "the full briefing paragraph",
  "healthcare_regime": "near_peak" | "pullback" | "correction" | "distressed" | "uncertain",
  "biotech_risk_appetite": "risk_on" | "risk_off" | "neutral" | "unknown",
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
  name:  "healthcare-brief",
  price: "$0.35",

  description:
    "AI-synthesized US healthcare and biotech sector intelligence brief. Assembles 10 real-time signals from Yahoo Finance: healthcare sector ETF (XLV), large-cap biotech (IBB), small-cap biotech (XBI), Eli Lilly, UnitedHealth, J&J, AbbVie, Moderna, Pfizer, and Medtronic. Returns biotech risk-appetite signal, healthcare-regime classification, and a 200-word GPT-4o-mini narrative covering sector momentum, managed care vs biotech dynamics, and agent decision implications.",

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
      healthcare_regime:      { type: "string", description: "near_peak | pullback | correction | distressed | uncertain" },
      situation:              { type: "string", description: "One-sentence healthcare sector summary." },
      dominant_signal:        { type: "string", description: "Most important signal from the data." },
      agent_implication:      { type: "string", description: "Concrete action relevance for AI agents." },
      narrative:              { type: "string", description: "Full ~200-word briefing narrative." },
      biotech_risk_appetite:  { type: "string", description: "risk_on | risk_off | neutral | unknown" },
      confidence:             { type: "number", description: "Synthesis confidence 0–1." },
      sector_etfs: {
        type: "object",
        description: "Healthcare ETF performance.",
        properties: {
          xlv_healthcare: { type: "object" },
          ibb_biotech:    { type: "object" },
          xbi_biotech_sm: { type: "object" },
        },
      },
      companies: {
        type: "object",
        description: "Individual healthcare stock performance.",
        properties: {
          eli_lilly:    { type: "object" },
          unitedhealth: { type: "object" },
          jnj:          { type: "object" },
          abbvie:       { type: "object" },
          moderna:      { type: "object" },
          pfizer:       { type: "object" },
          medtronic:    { type: "object" },
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
      throw Object.assign(new Error("Yahoo Finance rate-limited (HTTP 429) — all healthcare signals unavailable. Please retry in 5 minutes."), { status: 503 });
    }
    const interp = interpretSignals(raw);
    const synth  = await synthesize(raw, interp, style);

    return {
      ...synth,
      sector_etfs: {
        xlv_healthcare: raw.xlv_healthcare ? { price: raw.xlv_healthcare.price, change_pct: raw.xlv_healthcare.change_pct, pct_from_52w_high: raw.xlv_healthcare.pct_from_52w_high } : null,
        ibb_biotech:    raw.ibb_biotech    ? { price: raw.ibb_biotech.price,    change_pct: raw.ibb_biotech.change_pct    } : null,
        xbi_biotech_sm: raw.xbi_biotech_sm ? { price: raw.xbi_biotech_sm.price, change_pct: raw.xbi_biotech_sm.change_pct, risk_appetite: raw.derived.small_cap_risk_appetite } : null,
      },
      companies: {
        eli_lilly:    raw.eli_lilly    ? { price: raw.eli_lilly.price,    change_pct: raw.eli_lilly.change_pct,    pct_from_52w_high: raw.eli_lilly.pct_from_52w_high    } : null,
        unitedhealth: raw.unitedhealth ? { price: raw.unitedhealth.price, change_pct: raw.unitedhealth.change_pct } : null,
        jnj:          raw.jnj          ? { price: raw.jnj.price,          change_pct: raw.jnj.change_pct          } : null,
        abbvie:       raw.abbvie       ? { price: raw.abbvie.price,       change_pct: raw.abbvie.change_pct       } : null,
        moderna:      raw.moderna      ? { price: raw.moderna.price,      change_pct: raw.moderna.change_pct      } : null,
        pfizer:       raw.pfizer       ? { price: raw.pfizer.price,       change_pct: raw.pfizer.change_pct       } : null,
        medtronic:    raw.medtronic    ? { price: raw.medtronic.price,    change_pct: raw.medtronic.change_pct    } : null,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
