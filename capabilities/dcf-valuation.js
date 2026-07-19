// dcf-valuation.js
//
// Discounted Cash Flow (DCF) intrinsic value model for any US public company.
// Returns a 5-year FCF projection, terminal value, and per-share intrinsic value
// vs current price — the margin of safety at a glance.
//
// Seam: agents using wacc-calculator + earnings-estimates + equity-fundamentals
// to build stock theses have all the inputs for a DCF but no cap that runs the
// model. This cap fetches all data in one round and computes the full DCF.
//
// Methodology:
//   1. FCF history  — last 3 fiscal years (YF cashflowStatementHistory)
//   2. Growth rate  — analyst consensus 5Y EPS CAGR from YF earningsTrend,
//                     or caller-supplied override
//   3. WACC         — CAPM cost of equity + after-tax cost of debt (same
//                     formula as wacc-calculator, fetched in same API call)
//   4. DCF          — 5 projected FCFs discounted at WACC
//   5. Terminal val — Gordon Growth Model: FCF_6 / (WACC - terminal_g)
//   6. Equity value — (PV of FCFs + terminal PV − net debt) / diluted shares
//
// All data: Yahoo Finance (free, no API key). 10Y yield via YF chart (^TNX).
// ERP default: Damodaran mature market estimate (5.5%).
//
// Price: $0.025

const UA           = "Mozilla/5.0 (compatible; myriad/5.0; +https://synaptiic.org)";
const YF_CRUMB_SRC = "https://fc.yahoo.com";
const YF_CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb";
const YF_SUMMARY   = "https://query2.finance.yahoo.com/v10/finance/quoteSummary";
const YF_CHART     = "https://query2.finance.yahoo.com/v8/finance/chart";
const YF_TS_URL    = "https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";
const TMO          = 20_000;
const CRUMB_TTL    = 30 * 60 * 1000;

let _crumbCache = null;

function r2(n) { return n != null ? Math.round(n * 100) / 100 : null; }
function r4(n) { return n != null ? Math.round(n * 10000) / 10000 : null; }

function rawVal(field) {
  if (field === null || field === undefined) return null;
  if (typeof field === "number") return field;
  return field?.raw ?? null;
}

async function refreshCrumb() {
  const seedResp = await fetch(YF_CRUMB_SRC, {
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(TMO),
  });
  const cookies = (seedResp.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ");
  const crumbResp = await fetch(YF_CRUMB_URL, {
    headers: { "User-Agent": UA, "Cookie": cookies },
    signal: AbortSignal.timeout(TMO),
  });
  if (!crumbResp.ok) throw new Error(`crumb fetch failed: ${crumbResp.status}`);
  const crumb = (await crumbResp.text()).trim();
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
    "defaultKeyStatistics",
    "financialData",
    "summaryDetail",
    "incomeStatementHistory",
    "earningsTrend",
  ].join(",");
  const url = `${YF_SUMMARY}/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "application/json" },
    signal: AbortSignal.timeout(TMO),
  });
  if (resp.status === 401 && retry) {
    _crumbCache = null;
    return fetchSummary(ticker, false);
  }
  if (!resp.ok) throw new Error(`Yahoo Finance quoteSummary returned ${resp.status}`);
  return resp.json();
}

async function fetchFCFHistory(ticker) {
  const { crumb, cookies } = await getCrumb();
  const past = Math.floor(Date.now() / 1000) - 5 * 365 * 24 * 3600; // 5 years back
  const now  = Math.floor(Date.now() / 1000);
  const types = ["annualFreeCashFlow", "annualOperatingCashFlow", "annualCapitalExpenditure"];
  const url = `${YF_TS_URL}/${encodeURIComponent(ticker)}?type=${types.join(",")}&period1=${past}&period2=${now}&crumb=${encodeURIComponent(crumb)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "application/json" },
    signal: AbortSignal.timeout(TMO),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  const results = data?.timeseries?.result ?? [];

  // Build map of date → FCF
  const fcfMap = {};
  for (const series of results) {
    const type = series.meta?.type?.[0] ?? "";
    const vals = series[type] ?? [];
    for (const v of vals) {
      const date = v.asOfDate?.slice(0, 7); // YYYY-MM
      if (!date) continue;
      if (!fcfMap[date]) fcfMap[date] = {};
      if (type === "annualFreeCashFlow" && v.reportedValue?.raw != null) {
        fcfMap[date].fcf = v.reportedValue.raw;
      }
      if (type === "annualOperatingCashFlow" && v.reportedValue?.raw != null) {
        fcfMap[date].ocf = v.reportedValue.raw;
      }
      if (type === "annualCapitalExpenditure" && v.reportedValue?.raw != null) {
        fcfMap[date].capex = v.reportedValue.raw;
      }
    }
  }

  // Convert to sorted array, compute FCF if not directly available
  return Object.entries(fcfMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      year: date,
      fcf_usd: v.fcf ?? (v.ocf != null ? v.ocf - Math.abs(v.capex ?? 0) : null),
    }))
    .filter(x => x.fcf_usd != null);
}

async function fetch10YYield() {
  try {
    const url = `${YF_CHART}/${encodeURIComponent("^TNX")}?interval=1d&range=1d`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price != null ? price / 100 : null;
  } catch {
    return null;
  }
}

export default {
  name:  "dcf-valuation",
  price: "$0.025",

  description:
    "5-year Discounted Cash Flow model for any US public company. Fetches free cash flow history, consensus EPS growth, and WACC (CAPM), then projects 5 years of FCF, adds a Gordon Growth terminal value, subtracts net debt, and divides by diluted shares to produce intrinsic value per share vs current price. Returns margin of safety, upside/downside %, and full DCF schedule. No API key required.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US stock ticker (e.g. AAPL, NVDA, MSFT). Case-insensitive.",
      },
      growth_rate: {
        type: "number",
        description: "Annual FCF growth rate for 5-year projection in % (e.g. 15.0 = 15%). Overrides auto-detected analyst consensus EPS CAGR. Default: analyst 5Y consensus or FCF 3Y CAGR.",
      },
      terminal_growth_rate: {
        type: "number",
        description: "Perpetuity growth rate after year 5 in % (default 3.0 — long-run GDP growth). Use 2.0–3.5 for mature companies, 0–2.0 for declining businesses.",
      },
      erp: {
        type: "number",
        description: "Equity risk premium in % (default 5.5 — Damodaran mature market ERP). Override for emerging market exposure.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:               { type: "string" },
      name:                 { type: "string" },
      current_price_usd:    { type: "number", description: "Current market price per share." },
      intrinsic_value_usd:  { type: "number", description: "DCF intrinsic value per share." },
      margin_of_safety_pct: { type: "number", description: "Margin of safety: (intrinsic − price) / intrinsic × 100. Positive = undervalued, negative = overvalued." },
      upside_pct:           { type: "number", description: "Upside from current price to intrinsic value in %." },
      verdict:              { type: "string", description: "UNDERVALUED | FAIRLY_VALUED | OVERVALUED based on margin of safety." },
      assumptions: {
        type: "object",
        description: "DCF assumptions used.",
        properties: {
          wacc_pct:             { type: "number" },
          growth_rate_pct:      { type: "number" },
          terminal_growth_pct:  { type: "number" },
          projection_years:     { type: "integer" },
          growth_source:        { type: "string", description: "analyst_consensus | historical_cagr | caller_override" },
        },
      },
      fcf_history: {
        type: "array",
        description: "Historical free cash flows (operating CF − capex) by fiscal year.",
        items: {
          type: "object",
          properties: {
            year:       { type: "string" },
            fcf_usd:    { type: "number" },
          },
        },
      },
      dcf_schedule: {
        type: "array",
        description: "Projected FCF and present value by year.",
        items: {
          type: "object",
          properties: {
            year:       { type: "integer" },
            fcf_usd:    { type: "number" },
            pv_usd:     { type: "number" },
          },
        },
      },
      terminal_value: {
        type: "object",
        properties: {
          terminal_fcf_usd: { type: "number" },
          tv_usd:           { type: "number", description: "Undiscounted terminal value." },
          tv_pv_usd:        { type: "number", description: "Present value of terminal value." },
        },
      },
      equity_bridge: {
        type: "object",
        properties: {
          pv_fcfs_usd:           { type: "number" },
          pv_terminal_usd:       { type: "number" },
          enterprise_value_usd:  { type: "number" },
          minus_net_debt_usd:    { type: "number" },
          equity_value_usd:      { type: "number" },
          diluted_shares:        { type: "number" },
        },
      },
      ts: { type: "string" },
    },
  },

  async handler(query) {
    const rawTicker = (query.ticker || "AAPL").trim().toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
    if (!rawTicker) throw new Error("invalid ticker");

    const tgPct = typeof query.terminal_growth_rate === "number" ? query.terminal_growth_rate : 3.0;
    const erpPct = typeof query.erp === "number" ? query.erp : 5.5;
    const tg = tgPct / 100;
    const erp = erpPct / 100;

    // Parallel fetch: summary data + FCF history + 10Y yield
    const [summaryData, fcfHistory, rfRaw] = await Promise.all([
      fetchSummary(rawTicker),
      fetchFCFHistory(rawTicker),
      fetch10YYield(),
    ]);

    const rf = rfRaw ?? 0.0425; // fallback 4.25% if TNX unavailable

    const r = summaryData?.quoteSummary?.result?.[0];
    if (!r) throw new Error(`No data found for ticker "${rawTicker}"`);

    const ks  = r.defaultKeyStatistics  || {};
    const fd  = r.financialData         || {};
    const sd  = r.summaryDetail         || {};
    const ish = r.incomeStatementHistory?.incomeStatementHistory || [];
    const et  = r.earningsTrend?.trend  || [];

    const price = rawVal(fd.currentPrice) ?? rawVal(sd.previousClose);
    if (!price) throw new Error(`Could not determine current price for "${rawTicker}"`);

    if (fcfHistory.length === 0) throw new Error(`No free cash flow data for "${rawTicker}"`);

    const baseFCF = fcfHistory[fcfHistory.length - 1].fcf_usd;
    if (baseFCF == null || baseFCF === 0) throw new Error("Most recent FCF is zero or unavailable — DCF not meaningful");

    // ── Growth rate ──────────────────────────────────────────────────────────
    let growthPct, growthSource;

    if (typeof query.growth_rate === "number") {
      growthPct = query.growth_rate;
      growthSource = "caller_override";
    } else {
      // Try analyst 5Y EPS CAGR from earningsTrend
      const trend5y = et.find(t => t.period === "+5y");
      const consensus5y = trend5y ? rawVal(trend5y.growth) : null;
      if (consensus5y != null) {
        growthPct = consensus5y * 100;
        growthSource = "analyst_consensus";
      } else if (fcfHistory.length >= 2) {
        // Fallback: 3Y FCF CAGR
        const oldest = fcfHistory[0].fcf_usd;
        const newest = baseFCF;
        const years  = fcfHistory.length - 1;
        if (oldest > 0 && newest > 0) {
          growthPct = (Math.pow(newest / oldest, 1 / years) - 1) * 100;
          growthSource = "historical_cagr";
        } else {
          growthPct = 5.0;
          growthSource = "historical_cagr";
        }
      } else {
        growthPct = 5.0;
        growthSource = "historical_cagr";
      }
      // Cap growth: max 40%, floor at terminal growth
      growthPct = Math.min(Math.max(growthPct, tgPct + 0.1), 40.0);
    }
    const g = growthPct / 100;

    // ── WACC ─────────────────────────────────────────────────────────────────
    const beta        = rawVal(ks.beta) ?? 1.0;
    const marketCap   = rawVal(ks.marketCap);
    const totalDebt   = rawVal(fd.totalDebt) ?? 0;
    const interestExp = ks.interestExpense ? Math.abs(rawVal(ks.interestExpense) ?? 0) : 0;
    const taxRate     = (() => {
      const inc = ish[0];
      if (!inc) return 0.25;
      const taxExp  = Math.abs(rawVal(inc.incomeTaxExpense) ?? 0);
      const preTax  = rawVal(inc.pretaxIncome) ?? 0;
      return preTax > 0 ? Math.min(taxExp / preTax, 0.40) : 0.25;
    })();

    const ke = rf + beta * erp; // CAPM cost of equity
    const kd = totalDebt > 0 && interestExp > 0
      ? (interestExp / totalDebt) * (1 - taxRate)
      : rf * (1 - taxRate);

    const E  = marketCap ?? (price * (rawVal(ks.sharesOutstanding) ?? 1));
    const D  = totalDebt;
    const V  = E + D;
    const wacc = V > 0 ? (E / V) * ke + (D / V) * kd : ke;
    const waccPct = r2(wacc * 100);

    if (wacc <= tg) throw new Error(`WACC (${r2(wacc*100)}%) must exceed terminal growth rate (${tgPct}%) for a finite valuation`);

    // ── 5-year DCF projection ─────────────────────────────────────────────
    const YEARS = 5;
    let fcf = baseFCF > 0 ? baseFCF : Math.abs(baseFCF); // use abs if negative (rare)
    const schedule = [];
    let pvFCFs = 0;

    for (let yr = 1; yr <= YEARS; yr++) {
      fcf = fcf * (1 + g);
      const pv = fcf / Math.pow(1 + wacc, yr);
      schedule.push({ year: yr, fcf_usd: Math.round(fcf), pv_usd: Math.round(pv) });
      pvFCFs += pv;
    }

    // Terminal value (Gordon Growth Model applied to year-6 FCF)
    const terminalFCF = fcf * (1 + tg);
    const tv = terminalFCF / (wacc - tg);
    const tvPV = tv / Math.pow(1 + wacc, YEARS);

    // ── Equity value bridge ──────────────────────────────────────────────
    const cash     = rawVal(fd.totalCash) ?? 0;
    const netDebt  = D - cash;
    const ev       = pvFCFs + tvPV;
    const equityV  = ev - netDebt;
    const shares   = rawVal(ks.sharesOutstanding) ?? rawVal(ks.impliedSharesOutstanding) ?? 1;
    const intrinsic = equityV / shares;

    // ── Margin of safety & verdict ────────────────────────────────────────
    const mos = intrinsic > 0 ? ((intrinsic - price) / intrinsic) * 100 : 0;
    const upside = ((intrinsic - price) / price) * 100;
    const verdict = mos > 20 ? "UNDERVALUED" : mos < -20 ? "OVERVALUED" : "FAIRLY_VALUED";

    return {
      ticker:               rawTicker,
      name:                 fd.financialCurrency ? `${rawTicker}` : rawTicker,
      current_price_usd:    r2(price),
      intrinsic_value_usd:  r2(intrinsic),
      margin_of_safety_pct: r2(mos),
      upside_pct:           r2(upside),
      verdict,
      assumptions: {
        wacc_pct:            waccPct,
        growth_rate_pct:     r2(growthPct),
        terminal_growth_pct: tgPct,
        projection_years:    YEARS,
        erp_pct:             erpPct,
        risk_free_rate_pct:  r2(rf * 100),
        growth_source:       growthSource,
      },
      fcf_history: fcfHistory.map(x => ({ year: x.year, fcf_usd: Math.round(x.fcf_usd) })),
      dcf_schedule: schedule,
      terminal_value: {
        terminal_fcf_usd: Math.round(terminalFCF),
        tv_usd:           Math.round(tv),
        tv_pv_usd:        Math.round(tvPV),
      },
      equity_bridge: {
        pv_fcfs_usd:          Math.round(pvFCFs),
        pv_terminal_usd:      Math.round(tvPV),
        enterprise_value_usd: Math.round(ev),
        minus_net_debt_usd:   Math.round(netDebt),
        equity_value_usd:     Math.round(equityV),
        diluted_shares:       Math.round(shares),
      },
      ts: new Date().toISOString(),
    };
  },
};
