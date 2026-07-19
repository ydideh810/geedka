// retail-sector-brief.js
//
// AI-synthesized US retail sector situation briefing.
//
// Gathers 10 real-time signals from Yahoo Finance (free, no key), then uses
// gpt-4o-mini to produce a structured ~180-word retail sector assessment.
// One call replaces manual assembly of 10 live tickers + LLM synthesis.
//
// Signals assembled:
//   1. XRT (S&P Retail ETF)          — broad retail benchmark
//   2. XLY (Consumer Discretionary)  — cyclical consumer sector
//   3. XLP (Consumer Staples)        — defensive consumer (spread anchor)
//   4. SPY (S&P 500)                 — market baseline for relative calc
//   5. AMZN (Amazon)                 — e-commerce / dominant online retail
//   6. WMT  (Walmart)               — value / grocery / omnichannel bellwether
//   7. TGT  (Target)                — mid-tier general merchandise
//   8. COST (Costco)                — warehouse club / value discretionary
//   9. HD   (Home Depot)            — home improvement (housing-linked)
//  10. LOW  (Lowe's)               — home improvement confirmation
//
// Derived: XLY/XLP spread (risk-on vs defensive), XRT vs SPY alpha,
//          retailer composite momentum, home improvement avg, e-comm/physical gap.
//
// Seam: agents tracking consumer discretionary, sector rotation, recession
// probability, or retail earnings season chain through 8+ Yahoo Finance lookups
// + LLM synthesis; this collapses into one $0.350 call with AI interpretation.
// Companion to consumer-brief (FRED macro signals) — this covers equity signals.
//
// Upstreams: Yahoo Finance v8 chart (free, no auth) + gpt-4o-mini (OPENAI_API_KEY).

const YF_BASE    = "https://query1.finance.yahoo.com/v8/finance/chart";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL      = "gpt-4o-mini";
const UA         = "Mozilla/5.0 (compatible; myriad/4.82; +https://synaptiic.org)";
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
  const SYMS    = ["XRT", "XLY", "XLP", "SPY", "AMZN", "WMT", "TGT", "COST", "HD", "LOW"];
  const results = await Promise.allSettled(SYMS.map(s => fetchQuote(s)));
  const Q       = {};
  SYMS.forEach((s, i) => { Q[s] = results[i].status === "fulfilled" ? results[i].value : null; });

  // Derived signals
  const xly = Q["XLY"], xlp = Q["XLP"], xrt = Q["XRT"], spy = Q["SPY"];

  const xly_xlp_spread   = (xly?.change_pct != null && xlp?.change_pct != null)
    ? r2(xly.change_pct - xlp.change_pct) : null;

  const xrt_vs_spy_alpha = (xrt?.change_pct != null && spy?.change_pct != null)
    ? r2(xrt.change_pct - spy.change_pct) : null;

  const retailerChanges = ["AMZN","WMT","TGT","COST","HD"].map(s => Q[s]?.change_pct).filter(v => v != null);
  const retailer_composite_avg = retailerChanges.length
    ? r2(retailerChanges.reduce((a, b) => a + b, 0) / retailerChanges.length) : null;

  const home_improvement_avg = (Q["HD"]?.change_pct != null && Q["LOW"]?.change_pct != null)
    ? r2((Q["HD"].change_pct + Q["LOW"].change_pct) / 2) : null;

  const ecomm_vs_physical = (Q["AMZN"]?.change_pct != null && Q["TGT"]?.change_pct != null)
    ? r2(Q["AMZN"].change_pct - Q["TGT"].change_pct) : null;

  return {
    xrt_retail_etf:       Q["XRT"],
    xly_consumer_disc:    Q["XLY"],
    xlp_consumer_staples: Q["XLP"],
    spy_benchmark:        Q["SPY"],
    amzn_amazon:          Q["AMZN"],
    wmt_walmart:          Q["WMT"],
    tgt_target:           Q["TGT"],
    cost_costco:          Q["COST"],
    hd_home_depot:        Q["HD"],
    low_lowes:            Q["LOW"],
    derived: {
      xly_xlp_spread,
      xrt_vs_spy_alpha,
      retailer_composite_avg,
      home_improvement_avg,
      ecomm_vs_physical,
    },
  };
}

function interpretSignals(s) {
  const d = s.derived;

  const risk_appetite =
    d.xly_xlp_spread == null ? "unknown"
    : d.xly_xlp_spread > 0.5  ? "risk_on"
    : d.xly_xlp_spread > -0.5 ? "neutral"
    :                            "defensive";

  const retail_alpha =
    d.xrt_vs_spy_alpha == null ? "unknown"
    : d.xrt_vs_spy_alpha > 0.5  ? "outperforming"
    : d.xrt_vs_spy_alpha > -0.5 ? "in_line"
    :                              "underperforming";

  const retail_regime =
    risk_appetite === "risk_on" && retail_alpha === "outperforming" ? "EXPANDING"
    : risk_appetite === "defensive" && retail_alpha === "underperforming" ? "CONTRACTING"
    : retail_alpha === "outperforming" ? "OUTPERFORMING"
    : retail_alpha === "underperforming" ? "UNDERPERFORMING"
    : "STABLE";

  return { risk_appetite, retail_alpha, retail_regime };
}

async function synthesize(signals, interp, style) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const d = signals.derived;
  const block = [
    `Retail ETF (XRT): ${signals.xrt_retail_etf ? `${signals.xrt_retail_etf.price} (${signals.xrt_retail_etf.change_pct}% today, ${signals.xrt_retail_etf.pct_from_52w_high}% from 52w high)` : "N/A"}`,
    `Consumer Discretionary (XLY): ${signals.xly_consumer_disc ? `${signals.xly_consumer_disc.change_pct}% today` : "N/A"}`,
    `Consumer Staples (XLP): ${signals.xlp_consumer_staples ? `${signals.xlp_consumer_staples.change_pct}% today` : "N/A"}`,
    `XLY/XLP spread: ${d.xly_xlp_spread != null ? `${d.xly_xlp_spread}% (risk appetite: ${interp.risk_appetite})` : "N/A"}`,
    `XRT vs S&P 500 alpha: ${d.xrt_vs_spy_alpha != null ? `${d.xrt_vs_spy_alpha}% (${interp.retail_alpha})` : "N/A"}`,
    `Major retailer composite (AMZN/WMT/TGT/COST/HD avg): ${d.retailer_composite_avg != null ? `${d.retailer_composite_avg}% today` : "N/A"}`,
    `Amazon (AMZN): ${signals.amzn_amazon ? `${signals.amzn_amazon.price} (${signals.amzn_amazon.change_pct}%)` : "N/A"}`,
    `Walmart (WMT): ${signals.wmt_walmart ? `${signals.wmt_walmart.price} (${signals.wmt_walmart.change_pct}%)` : "N/A"}`,
    `Target (TGT): ${signals.tgt_target ? `${signals.tgt_target.price} (${signals.tgt_target.change_pct}%)` : "N/A"}`,
    `Costco (COST): ${signals.cost_costco ? `${signals.cost_costco.price} (${signals.cost_costco.change_pct}%)` : "N/A"}`,
    `Home Depot (HD): ${signals.hd_home_depot ? `${signals.hd_home_depot.price} (${signals.hd_home_depot.change_pct}%)` : "N/A"}`,
    `Lowe's (LOW): ${signals.low_lowes ? `${signals.low_lowes.price} (${signals.low_lowes.change_pct}%)` : "N/A"}`,
    `Home improvement avg (HD+LOW): ${d.home_improvement_avg != null ? `${d.home_improvement_avg}%` : "N/A"}`,
    `E-commerce vs physical gap (AMZN-TGT): ${d.ecomm_vs_physical != null ? `${d.ecomm_vs_physical}%` : "N/A"}`,
    `Regime classification: ${interp.retail_regime}`,
  ].join("\n");

  const toneClause = style === "concise"
    ? "Write concisely — 100-130 words maximum."
    : "Write clearly — 160-200 words.";

  const prompt = `You are a senior retail sector strategist writing a daily situation briefing for AI financial agents. Synthesize the retail equity signal data below into a coherent, actionable assessment.

CURRENT SIGNAL DATA (sourced from Yahoo Finance live quotes):
${block}

${toneClause} Focus on: (1) what the signals collectively say about retail sector health and consumer demand, (2) the single most important driver or risk, and (3) one concrete implication for an AI agent tracking retail exposure or consumer spending.

Write in plain professional prose. Do not use bullet points. Do not repeat raw numbers unless necessary. Do not start with "Based on".

Respond ONLY with a JSON object (no markdown, no text outside JSON):
{
  "retail_regime": "one of: EXPANDING | OUTPERFORMING | STABLE | UNDERPERFORMING | CONTRACTING",
  "situation": "one sentence: the core retail sector condition right now",
  "dominant_driver": "one sentence: the primary force driving retail performance",
  "key_risk": "one sentence: the biggest risk to the retail sector outlook",
  "agent_implication": "one sentence: concrete relevance for an AI agent making retail/consumer allocation decisions",
  "narrative": "full ${style === "concise" ? "110-130" : "160-200"}-word synthesis",
  "confidence": <0.0 to 1.0 based on data completeness and signal clarity>
}`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model:       MODEL,
      messages:    [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens:  600,
    }),
    signal: AbortSignal.timeout(GPT_TMO),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI HTTP ${resp.status}: ${err.slice(0, 200)}`);
  }

  const body = await resp.json();
  const raw  = body.choices?.[0]?.message?.content?.trim() ?? "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("OpenAI returned non-JSON response");
    parsed = JSON.parse(m[0]);
  }
  return parsed;
}

export default {
  name:  "retail-sector-brief",
  price: "$0.350",

  description:
    "AI-synthesized US retail sector briefing: XRT/XLY/XLP ETF signals, major retailer stock performance (AMZN/WMT/TGT/COST/HD/LOW), derived risk-appetite and sector-alpha scores, and GPT-4o-mini synthesis into regime classification + narrative. Companion to consumer-brief (macro signals) — this covers real-time equity signals. $0.35/call vs assembling 10+ Yahoo Finance lookups manually.",

  inputSchema: {
    type: "object",
    properties: {
      style: {
        type: "string",
        enum: ["standard", "concise"],
        description: "Output length. 'standard' = 160-200 word narrative (default). 'concise' = 110-130 word summary.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      retail_regime:     { type: "string", description: "EXPANDING | OUTPERFORMING | STABLE | UNDERPERFORMING | CONTRACTING" },
      situation:         { type: "string", description: "One-sentence retail sector summary." },
      dominant_driver:   { type: "string", description: "Primary driver of retail performance." },
      key_risk:          { type: "string", description: "Biggest risk to retail sector outlook." },
      agent_implication: { type: "string", description: "Concrete relevance for AI agents tracking retail/consumer." },
      narrative:         { type: "string", description: "Full synthesis narrative." },
      confidence:        { type: "number", description: "Synthesis confidence 0–1." },
      etfs: {
        type: "object",
        description: "Retail and consumer sector ETF performance.",
        properties: {
          xrt_retail:     { type: "object" },
          xly_disc:       { type: "object" },
          xlp_staples:    { type: "object" },
        },
      },
      retailers: {
        type: "object",
        description: "Major retailer stock performance.",
        properties: {
          amzn_amazon:    { type: "object" },
          wmt_walmart:    { type: "object" },
          tgt_target:     { type: "object" },
          cost_costco:    { type: "object" },
          hd_home_depot:  { type: "object" },
          low_lowes:      { type: "object" },
        },
      },
      derived: {
        type: "object",
        description: "Composite heuristic signals.",
        properties: {
          xly_xlp_spread:        { type: "number", description: "Discretionary minus staples daily % (risk appetite proxy)" },
          xrt_vs_spy_alpha:      { type: "number", description: "XRT minus SPY daily % (retail alpha)" },
          retailer_composite:    { type: "number", description: "Avg daily % of AMZN+WMT+TGT+COST+HD" },
          home_improvement_avg:  { type: "number", description: "Avg daily % of HD+LOW (housing-linked)" },
          ecomm_vs_physical:     { type: "number", description: "AMZN minus TGT daily % (online vs in-store)" },
          risk_appetite:         { type: "string", description: "risk_on | neutral | defensive" },
          retail_alpha:          { type: "string", description: "outperforming | in_line | underperforming" },
        },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const style = query.style || "standard";

    const raw = await gatherSignals();
    const etfCount = ["XRT","XLY","XLP"].filter(s => raw[`${s === "XRT" ? "xrt_retail_etf" : s === "XLY" ? "xly_consumer_disc" : "xlp_consumer_staples"}`]?.price != null).length;
    if (etfCount === 0) {
      throw Object.assign(
        new Error("Yahoo Finance rate-limited — retail ETF signals unavailable. Please retry in 5 minutes."),
        { status: 503 }
      );
    }

    const interp = interpretSignals(raw);
    const synth  = await synthesize(raw, interp, style);

    const q = (key) => raw[key];

    return {
      ...synth,
      etfs: {
        xrt_retail:  q("xrt_retail_etf")  ? { price: q("xrt_retail_etf").price,  change_pct: q("xrt_retail_etf").change_pct,  pct_from_52w_high: q("xrt_retail_etf").pct_from_52w_high  } : null,
        xly_disc:    q("xly_consumer_disc") ? { price: q("xly_consumer_disc").price, change_pct: q("xly_consumer_disc").change_pct } : null,
        xlp_staples: q("xlp_consumer_staples") ? { price: q("xlp_consumer_staples").price, change_pct: q("xlp_consumer_staples").change_pct } : null,
      },
      retailers: {
        amzn_amazon:   q("amzn_amazon")  ? { price: q("amzn_amazon").price,  change_pct: q("amzn_amazon").change_pct  } : null,
        wmt_walmart:   q("wmt_walmart")  ? { price: q("wmt_walmart").price,  change_pct: q("wmt_walmart").change_pct  } : null,
        tgt_target:    q("tgt_target")   ? { price: q("tgt_target").price,   change_pct: q("tgt_target").change_pct   } : null,
        cost_costco:   q("cost_costco")  ? { price: q("cost_costco").price,  change_pct: q("cost_costco").change_pct  } : null,
        hd_home_depot: q("hd_home_depot") ? { price: q("hd_home_depot").price, change_pct: q("hd_home_depot").change_pct } : null,
        low_lowes:     q("low_lowes")    ? { price: q("low_lowes").price,    change_pct: q("low_lowes").change_pct    } : null,
      },
      derived: {
        xly_xlp_spread:       raw.derived.xly_xlp_spread,
        xrt_vs_spy_alpha:     raw.derived.xrt_vs_spy_alpha,
        retailer_composite:   raw.derived.retailer_composite_avg,
        home_improvement_avg: raw.derived.home_improvement_avg,
        ecomm_vs_physical:    raw.derived.ecomm_vs_physical,
        risk_appetite:        interp.risk_appetite,
        retail_alpha:         interp.retail_alpha,
      },
      generated_at: new Date().toISOString(),
    };
  },
};
