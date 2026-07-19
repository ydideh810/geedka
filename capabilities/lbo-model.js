// lbo-model.js
//
// Leveraged Buyout model for any US public company.
//
// Models the full LBO transaction: entry valuation, debt structure, 5-year
// operating model with debt paydown, exit valuation, and sponsor returns.
// Returns IRR, MOIC, entry/exit waterfall, and a sensitivity table of IRR
// across entry EV/EBITDA multiples × exit EV/EBITDA multiples.
//
// Methodology:
//   1. Fetch EBITDA, FCF, revenue, debt, shares via Yahoo Finance
//   2. Entry: EV = EBITDA × entry_ev_ebitda (default: current market EV/EBITDA)
//   3. Structure: debt = EV × (debt_pct / 100), equity check = EV - debt
//   4. Operating model: project EBITDA at growth_pct × hold_years
//   5. Debt schedule: annual paydown from projected FCF (cash sweep)
//   6. Exit: EV = year-N EBITDA × exit_ev_ebitda (default: entry_ev_ebitda)
//   7. Returns: MOIC = exit equity / entry equity; IRR = MOIC^(1/N) - 1
//   8. Sensitivity: 5×5 grid across entry multiples and exit multiples
//   9. GPT-4o-mini deal narrative: verdict, key risks, strategic rationale
//
// Data: Yahoo Finance free APIs. No API key required for financials.
// LLM: gpt-4o-mini for deal synthesis.
//
// Price: $3.42

const YF_SUMMARY   = "https://query2.finance.yahoo.com/v10/finance/quoteSummary";
const YF_CRUMB_SRC = "https://fc.yahoo.com";
const YF_CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb";
const YF_TS_URL    = "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";
const OPENAI_URL   = "https://api.openai.com/v1/chat/completions";
const MODEL        = "gpt-4o-mini";
const UA           = "Mozilla/5.0 (compatible; myriad/5.0; +https://synaptiic.org)";
const TMO          = 20_000;
const CRUMB_TTL    = 30 * 60 * 1000;

let _crumbCache = null;

function r2(n) { return n != null ? Math.round(n * 100) / 100 : null; }
function r0(n) { return n != null ? Math.round(n) : null; }
function pct(n) { return n != null ? r2(n * 100) : null; }
function rawVal(f) {
  if (f == null) return null;
  if (typeof f === "number") return f;
  return f?.raw ?? null;
}

async function refreshCrumb() {
  const seed = await fetch(YF_CRUMB_SRC, {
    headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(TMO),
  });
  const cookies = (seed.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ");
  const cr = await fetch(YF_CRUMB_URL, {
    headers: { "User-Agent": UA, "Cookie": cookies }, signal: AbortSignal.timeout(TMO),
  });
  if (!cr.ok) throw new Error(`crumb fetch ${cr.status}`);
  const crumb = (await cr.text()).trim();
  if (!crumb) throw new Error("empty crumb");
  _crumbCache = { crumb, cookies, ts: Date.now() };
  return _crumbCache;
}

async function getCrumb() {
  if (_crumbCache && (Date.now() - _crumbCache.ts) < CRUMB_TTL) return _crumbCache;
  return refreshCrumb();
}

async function fetchSummary(ticker, retry = true) {
  const { crumb, cookies } = await getCrumb();
  const modules = [
    "defaultKeyStatistics", "financialData", "summaryDetail",
    "incomeStatementHistory", "balanceSheetHistory", "cashflowStatementHistory",
    "earningsTrend",
  ].join(",");
  const url = `${YF_SUMMARY}/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "application/json" },
    signal: AbortSignal.timeout(TMO),
  });
  if (resp.status === 401 && retry) { _crumbCache = null; return fetchSummary(ticker, false); }
  if (!resp.ok) throw new Error(`YF quoteSummary ${resp.status} for ${ticker}`);
  return resp.json();
}

async function fetchFCFHistory(ticker, cookies, crumb) {
  const fields = [
    "annualFreeCashFlow",
    "annualOperatingCashFlow",
    "annualCapitalExpenditure",
  ].join(",");
  const url = `${YF_TS_URL}/${encodeURIComponent(ticker)}?type=${fields}&period1=0&period2=9999999999&crumb=${encodeURIComponent(crumb)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "application/json" },
    signal: AbortSignal.timeout(TMO),
  });
  if (!resp.ok) return null;
  const j = await resp.json();
  const ts = j?.timeseries?.result ?? [];
  const fcfSeries = ts.find(s => s.meta?.type?.[0] === "annualFreeCashFlow");
  if (!fcfSeries?.annualFreeCashFlow?.length) return null;
  return fcfSeries.annualFreeCashFlow
    .filter(d => d?.reportedValue?.raw != null)
    .map(d => ({ year: d.asOfDate?.slice(0, 4), fcf: d.reportedValue.raw }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

function calcIRR(equity, exitEquity, holdYears) {
  if (equity <= 0) return null;
  const moic = exitEquity / equity;
  const irr = Math.pow(moic, 1 / holdYears) - 1;
  return { irr_pct: r2(irr * 100), moic: r2(moic) };
}

function sensitivityTable(ebitda, ltmFcf, totalDebt, debtPct, growthPct, holdYears, entryMultiples, exitMultiples, openaiKey) {
  // Returns IRR grid: rows = entry multiples, cols = exit multiples
  const rows = [];
  for (const entryMult of entryMultiples) {
    const row = { entry_mult: entryMult, irrs: [] };
    const entryEV = ebitda * entryMult;
    const debt = entryEV * (debtPct / 100);
    const equityCheck = entryEV - debt;

    // Project EBITDA and debt over hold period
    const g = growthPct / 100;
    let yr5_ebitda = ebitda;
    let outstanding = debt;
    for (let yr = 1; yr <= holdYears; yr++) {
      yr5_ebitda *= (1 + g);
      const annualFCF = ltmFcf * Math.pow(1 + g, yr) * 0.8; // 80% of FCF to debt service
      outstanding = Math.max(0, outstanding - annualFCF);
    }

    for (const exitMult of exitMultiples) {
      const exitEV = yr5_ebitda * exitMult;
      const exitEquity = Math.max(0, exitEV - outstanding);
      const ret = calcIRR(equityCheck, exitEquity, holdYears);
      row.irrs.push(ret?.irr_pct ?? null);
    }
    rows.push(row);
  }
  return rows;
}

async function synthesizeDeal(ticker, name, entryEV, equityCheck, debt, ebitda, ltmFcf, revenue, growthPct, holdYears, exitEquity, irr, moic, openaiKey) {
  if (!openaiKey) return { verdict: "NO_LLM", narrative: "OpenAI key not configured — set OPENAI_API_KEY for AI synthesis.", deal_risks: [], strategic_rationale: null };

  const prompt = `You are a private equity associate writing a deal brief for an LBO of ${name} (${ticker}).

Deal facts:
- Entry EV: $${(entryEV / 1e9).toFixed(2)}B at current market multiple
- Equity check: $${(equityCheck / 1e9).toFixed(2)}B (${r2((equityCheck / entryEV) * 100)}% equity)
- Total debt: $${(debt / 1e9).toFixed(2)}B (${r2((debt / entryEV) * 100)}% of EV)
- Leverage: ${r2(debt / ebitda)}× EBITDA
- LTM EBITDA: $${r0(ebitda / 1e6)}M
- LTM FCF: $${r0(ltmFcf / 1e6)}M
- Revenue: $${r0(revenue / 1e6)}M
- Projected EBITDA growth: ${growthPct}% per year (${holdYears}-year hold)
- Projected exit equity: $${(exitEquity / 1e9).toFixed(2)}B
- Sponsor returns: ${irr}% IRR / ${moic}× MOIC

Write a tight deal brief in structured JSON with:
1. "verdict": one of "ATTRACTIVE", "BORDERLINE", "UNATTRACTIVE" — based on returns vs typical PE hurdle (>20% IRR)
2. "strategic_rationale": 2-sentence investment thesis
3. "deal_risks": array of 3 specific risks (leverage, market, operational)
4. "narrative": 150-word deal memo paragraph summarizing the opportunity and risk/return

Return ONLY valid JSON.`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
  const data = await resp.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch {
    return { verdict: "PARSE_ERROR", narrative: data.choices[0].message.content.slice(0, 500), deal_risks: [], strategic_rationale: null };
  }
}

export default {
name:        "lbo-model",
price:       "$3.42",
description: "Full leveraged buyout model for any US public company: entry valuation, debt structure, 5-year operating model with FCF-driven debt paydown, exit waterfall, IRR and MOIC. Includes sensitivity table across entry/exit EV/EBITDA multiples and AI-synthesized deal brief with verdict, investment thesis, and key risks.",

inputSchema: {
  type: "object",
  properties: {
    ticker: {
      type: "string",
      description: "US stock ticker (e.g. AAPL, NVDA). Case-insensitive.",
    },
    entry_ev_ebitda: {
      type: "number",
      description: "Entry EV/EBITDA purchase multiple. Default: current market EV/EBITDA.",
    },
    exit_ev_ebitda: {
      type: "number",
      description: "Exit EV/EBITDA multiple at end of hold period. Default: same as entry.",
    },
    debt_pct: {
      type: "number",
      description: "Total debt as % of entry EV (default 60 = 60% leverage). Typical range 50–70%.",
    },
    ebitda_growth_pct: {
      type: "number",
      description: "Annual EBITDA growth assumption in % (default: analyst 5Y consensus or historical).",
    },
    hold_years: {
      type: "number",
      description: "Investment hold period in years (default 5).",
    },
  },
  required: ["ticker"],
  additionalProperties: false,
},

outputSchema: {
  type: "object",
  properties: {
    ticker:           { type: "string" },
    name:             { type: "string" },
    entry: {
      type: "object",
      description: "Entry transaction metrics.",
      properties: {
        ev_usd:            { type: "number", description: "Entry enterprise value (USD)." },
        ev_ebitda_mult:    { type: "number", description: "Entry EV/EBITDA purchase multiple." },
        total_debt_usd:    { type: "number", description: "Total acquisition debt (USD)." },
        equity_check_usd:  { type: "number", description: "Equity check (USD)." },
        equity_pct:        { type: "number", description: "Equity as % of total capitalization." },
        leverage_x_ebitda: { type: "number", description: "Leverage in turns of EBITDA." },
        ebitda_usd:        { type: "number", description: "LTM EBITDA used for entry sizing." },
      },
    },
    exit: {
      type: "object",
      description: "Exit transaction metrics.",
      properties: {
        ev_usd:             { type: "number" },
        ev_ebitda_mult:     { type: "number" },
        ebitda_usd:         { type: "number", description: "EBITDA at exit (after growth)." },
        remaining_debt_usd: { type: "number" },
        exit_equity_usd:    { type: "number" },
      },
    },
    returns: {
      type: "object",
      properties: {
        irr_pct:     { type: "number", description: "Sponsor IRR over hold period (%)." },
        moic:        { type: "number", description: "Multiple on invested capital." },
        hold_years:  { type: "number" },
      },
    },
    sensitivity: {
      type: "object",
      description: "IRR sensitivity across entry and exit EV/EBITDA multiples.",
      properties: {
        entry_multiples: { type: "array", items: { type: "number" } },
        exit_multiples:  { type: "array", items: { type: "number" } },
        irr_grid:        { type: "array", description: "Row per entry multiple; each row = IRR% per exit multiple.", items: { type: "object" } },
      },
    },
    assumptions: {
      type: "object",
      properties: {
        ebitda_growth_pct:  { type: "number" },
        debt_pct:           { type: "number" },
        growth_source:      { type: "string" },
        ltm_fcf_usd:        { type: "number" },
        ltm_revenue_usd:    { type: "number" },
        ebitda_margin_pct:  { type: "number" },
      },
    },
    deal_brief: {
      type: "object",
      description: "AI-synthesized deal verdict and narrative.",
      properties: {
        verdict:             { type: "string" },
        strategic_rationale: { type: "string" },
        deal_risks:          { type: "array", items: { type: "string" } },
        narrative:           { type: "string" },
      },
    },
    generated_at: { type: "string" },
  },
},

async handler(query) {
  const ticker    = (query.ticker || "").toUpperCase().trim();
  if (!ticker) throw Object.assign(new Error("provide ticker parameter"), { status: 400 });

  const holdYears = Number(query.hold_years) || 5;
  const debtPct   = Number(query.debt_pct) || 60;
  const openaiKey = process.env.OPENAI_API_KEY ?? null;

  // ── Fetch financials ───────────────────────────────────────────────────────
  const summary = await fetchSummary(ticker);
  const result  = summary?.quoteSummary?.result?.[0];
  if (!result) throw new Error(`No data for "${ticker}"`);

  const ks  = result.defaultKeyStatistics ?? {};
  const fd  = result.financialData ?? {};
  const sd  = result.summaryDetail ?? {};
  const ish = result.incomeStatementHistory?.incomeStatementHistory ?? [];
  const bsh = result.balanceSheetHistory?.balanceSheetStatements ?? [];
  const cfh = result.cashflowStatementHistory?.cashflowStatements ?? [];
  const et  = result.earningsTrend?.trend ?? [];

  const companyName = fd.financialCurrency ? ticker : ticker;

  // Price and market cap
  const price_usd  = rawVal(fd.currentPrice) ?? rawVal(sd.previousClose) ?? 0;
  const marketCap  = rawVal(ks.marketCap) ?? (price_usd * (rawVal(ks.sharesOutstanding) ?? 0));
  const totalDebt  = rawVal(fd.totalDebt) ?? 0;
  const totalCash  = rawVal(fd.totalCash) ?? 0;
  const netDebt    = totalDebt - totalCash;
  const currentEV  = marketCap + netDebt;

  // EBITDA: prefer financialData.ebitda; fallback: operating income + D&A from CF
  let ebitda = rawVal(fd.ebitda);
  if (!ebitda || ebitda === 0) {
    const inc0 = ish[0];
    const cf0  = cfh[0];
    const ebit = rawVal(inc0?.ebit) ?? rawVal(inc0?.operatingIncome);
    const da   = rawVal(cf0?.depreciation) ?? 0;
    if (ebit != null) {
      ebitda = ebit + da;
    }
  }
  if (!ebitda || ebitda === 0) throw new Error(`EBITDA unavailable for "${ticker}" — LBO not computable`);

  // LTM FCF
  const cf0   = cfh[0];
  const opCF  = rawVal(cf0?.totalCashFromOperatingActivities) ?? 0;
  const capex = Math.abs(rawVal(cf0?.capitalExpenditures) ?? 0);
  let ltmFcf  = rawVal(fd.freeCashflow) ?? (opCF - capex);

  // Revenue
  const inc0    = ish[0];
  const revenue = rawVal(inc0?.totalRevenue) ?? rawVal(fd.totalRevenue) ?? 0;

  // ── Growth rate ────────────────────────────────────────────────────────────
  let growthPct, growthSource;
  if (typeof query.ebitda_growth_pct === "number") {
    growthPct   = query.ebitda_growth_pct;
    growthSource = "caller_override";
  } else {
    const trend5y    = et.find(t => t.period === "+5y");
    const consensus5 = trend5y ? rawVal(trend5y.growth) : null;
    if (consensus5 != null) {
      growthPct   = Math.min(Math.max(consensus5 * 100, 3), 35);
      growthSource = "analyst_consensus";
    } else {
      // Fall back to EBITDA margin × revenue growth approximation
      const inc1 = ish[1];
      const rev1 = rawVal(inc1?.totalRevenue);
      if (rev1 && revenue && rev1 > 0) {
        const revGrowth = ((revenue / rev1) - 1) * 100;
        growthPct   = Math.min(Math.max(revGrowth, 3), 30);
        growthSource = "revenue_cagr_proxy";
      } else {
        growthPct   = 8.0;
        growthSource = "default";
      }
    }
  }

  // ── Entry multiples ────────────────────────────────────────────────────────
  const currentEvEbitda = ebitda > 0 ? currentEV / ebitda : 12;
  const entryMult = typeof query.entry_ev_ebitda === "number"
    ? query.entry_ev_ebitda
    : r2(Math.max(currentEvEbitda, 6));
  const exitMult  = typeof query.exit_ev_ebitda === "number"
    ? query.exit_ev_ebitda
    : entryMult;

  // ── LBO mechanics ─────────────────────────────────────────────────────────
  const entryEV     = ebitda * entryMult;
  const debt        = entryEV * (debtPct / 100);
  const equityCheck = entryEV - debt;
  const levX        = ebitda > 0 ? r2(debt / ebitda) : null;

  if (equityCheck <= 0) throw new Error(`Debt structure (${debtPct}% of EV) leaves no equity — reduce debt_pct`);

  // Annual debt paydown: min(projected FCF × 80%, outstanding debt)
  const g = growthPct / 100;
  let outstandingDebt = debt;
  let projEbitda = ebitda;
  const debtSchedule = [];

  for (let yr = 1; yr <= holdYears; yr++) {
    projEbitda *= (1 + g);
    const projFCF     = ltmFcf > 0 ? ltmFcf * Math.pow(1 + g, yr) : projEbitda * 0.35;
    const paydown     = Math.min(projFCF * 0.8, outstandingDebt);
    outstandingDebt   = Math.max(0, outstandingDebt - paydown);
    debtSchedule.push({
      year:              yr,
      ebitda_usd:        r0(projEbitda),
      fcf_usd:           r0(projFCF),
      debt_paydown_usd:  r0(paydown),
      remaining_debt_usd: r0(outstandingDebt),
    });
  }

  // Exit
  const exitEbitda   = debtSchedule[holdYears - 1].ebitda_usd;
  const exitEV       = exitEbitda * exitMult;
  const exitEquity   = Math.max(0, exitEV - outstandingDebt);
  const { irr_pct, moic } = calcIRR(equityCheck, exitEquity, holdYears) ?? { irr_pct: 0, moic: 0 };

  // ── Sensitivity table ──────────────────────────────────────────────────────
  const range = (center, n, step) =>
    Array.from({ length: n }, (_, i) => r2(center + (i - Math.floor(n / 2)) * step));
  const entryRange = range(entryMult, 5, 1.0).filter(x => x > 0);
  const exitRange  = range(exitMult,  5, 1.0).filter(x => x > 0);

  const grid = sensitivityTable(ebitda, ltmFcf > 0 ? ltmFcf : projEbitda * 0.35, totalDebt, debtPct, growthPct, holdYears, entryRange, exitRange);

  // ── AI synthesis ───────────────────────────────────────────────────────────
  const dealBrief = await synthesizeDeal(
    ticker, companyName, entryEV, equityCheck, debt, ebitda, ltmFcf,
    revenue, growthPct, holdYears, exitEquity, irr_pct, moic, openaiKey,
  ).catch(() => ({ verdict: "SYNTHESIS_UNAVAILABLE", narrative: "LLM synthesis failed.", deal_risks: [], strategic_rationale: null }));

  return {
    ticker,
    name:    companyName,
    entry: {
      ev_usd:             r0(entryEV),
      ev_ebitda_mult:     entryMult,
      total_debt_usd:     r0(debt),
      equity_check_usd:   r0(equityCheck),
      equity_pct:         r2((equityCheck / entryEV) * 100),
      leverage_x_ebitda:  levX,
      ebitda_usd:         r0(ebitda),
    },
    exit: {
      ev_usd:             r0(exitEV),
      ev_ebitda_mult:     exitMult,
      ebitda_usd:         exitEbitda,
      remaining_debt_usd: r0(outstandingDebt),
      exit_equity_usd:    r0(exitEquity),
    },
    returns: {
      irr_pct,
      moic,
      hold_years: holdYears,
    },
    debt_schedule: debtSchedule,
    sensitivity: {
      entry_multiples: entryRange,
      exit_multiples:  exitRange,
      irr_grid:        grid,
    },
    assumptions: {
      ebitda_growth_pct:  r2(growthPct),
      debt_pct:           debtPct,
      growth_source:      growthSource,
      ltm_fcf_usd:        r0(ltmFcf),
      ltm_revenue_usd:    r0(revenue),
      ebitda_margin_pct:  revenue > 0 ? r2((ebitda / revenue) * 100) : null,
      current_ev_ebitda:  r2(currentEvEbitda),
    },
    deal_brief: dealBrief,
    generated_at: new Date().toISOString(),
  };
},
};
