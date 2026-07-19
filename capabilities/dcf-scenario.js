// dcf-scenario.js
//
// Three-scenario Discounted Cash Flow model for any US public company.
// Bear / base / bull growth assumptions → three intrinsic values, margin of
// safety for each, plus a probability-weighted composite and a sensitivity
// table (growth × WACC grid).
//
// Seam: agents running dcf-valuation for a single estimate immediately ask
// "what if growth is lower?" — they have to call dcf-valuation three times
// with different growth_rate params and assemble the table themselves.
// This cap does it in one call, in parallel.
//
// Methodology (same as dcf-valuation):
//   1. FCF history  — last 3 fiscal years (YF timeseries)
//   2. WACC         — CAPM cost of equity + after-tax cost of debt
//   3. Growth rates — caller-supplied per scenario, or auto-set relative to
//                     analyst 5Y consensus (bear = 50%, base = 100%, bull = 150%)
//   4. DCF          — 5 projected FCFs discounted at WACC, per scenario
//   5. Terminal val — Gordon Growth Model, per scenario
//   6. Equity value — enterprise value − net debt / diluted shares
//   7. Sensitivity  — 5 growth rates × 5 WACC offsets = 25-cell grid
//
// Data: Yahoo Finance (free, crumb-auth). 10Y yield via ^TNX.
// ERP default: Damodaran mature market (5.5%).
//
// Price: $0.045

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
    "incomeStatementHistory", "earningsTrend",
  ].join(",");
  const url = `${YF_SUMMARY}/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "application/json" },
    signal: AbortSignal.timeout(TMO),
  });
  if (resp.status === 401 && retry) { _crumbCache = null; return fetchSummary(ticker, false); }
  if (!resp.ok) throw new Error(`YF quoteSummary ${resp.status}`);
  return resp.json();
}

async function fetchFCFHistory(ticker) {
  const { crumb, cookies } = await getCrumb();
  const past = Math.floor(Date.now() / 1000) - 5 * 365 * 24 * 3600;
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
  const fcfMap = {};
  for (const series of results) {
    const type = series.meta?.type?.[0] ?? "";
    const vals = series[type] ?? [];
    for (const v of vals) {
      const date = v.asOfDate?.slice(0, 7);
      if (!date) continue;
      if (!fcfMap[date]) fcfMap[date] = {};
      if (type === "annualFreeCashFlow" && v.reportedValue?.raw != null)
        fcfMap[date].fcf = v.reportedValue.raw;
      if (type === "annualOperatingCashFlow" && v.reportedValue?.raw != null)
        fcfMap[date].ocf = v.reportedValue.raw;
      if (type === "annualCapitalExpenditure" && v.reportedValue?.raw != null)
        fcfMap[date].capex = v.reportedValue.raw;
    }
  }
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
    const resp = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price != null ? price / 100 : null;
  } catch { return null; }
}

function runDCF({ baseFCF, growthPct, terminalGrowthPct, wacc, netDebt, shares, price }) {
  const g  = growthPct / 100;
  const tg = terminalGrowthPct / 100;

  if (wacc <= tg) {
    return { error: `wacc (${r2(wacc*100)}%) must exceed terminal growth (${terminalGrowthPct}%)` };
  }

  const YEARS = 5;
  let fcf = baseFCF > 0 ? baseFCF : Math.abs(baseFCF);
  let pvFCFs = 0;
  const schedule = [];

  for (let yr = 1; yr <= YEARS; yr++) {
    fcf = fcf * (1 + g);
    const pv = fcf / Math.pow(1 + wacc, yr);
    schedule.push({ year: yr, fcf_usd: Math.round(fcf), pv_usd: Math.round(pv) });
    pvFCFs += pv;
  }

  const terminalFCF = fcf * (1 + tg);
  const tv    = terminalFCF / (wacc - tg);
  const tvPV  = tv / Math.pow(1 + wacc, YEARS);
  const ev    = pvFCFs + tvPV;
  const eqVal = ev - netDebt;
  const intrinsic = eqVal / shares;
  const mos       = intrinsic > 0 ? ((intrinsic - price) / intrinsic) * 100 : 0;
  const upside    = ((intrinsic - price) / price) * 100;
  const verdict   = mos > 20 ? "UNDERVALUED" : mos < -20 ? "OVERVALUED" : "FAIRLY_VALUED";

  return {
    growth_rate_pct:      r2(growthPct),
    intrinsic_value_usd:  r2(intrinsic),
    margin_of_safety_pct: r2(mos),
    upside_pct:           r2(upside),
    verdict,
    dcf_schedule:         schedule,
    terminal_value:       { tv_pv_usd: Math.round(tvPV) },
    equity_bridge: {
      pv_fcfs_usd:          Math.round(pvFCFs),
      pv_terminal_usd:      Math.round(tvPV),
      enterprise_value_usd: Math.round(ev),
      minus_net_debt_usd:   Math.round(netDebt),
      equity_value_usd:     Math.round(eqVal),
    },
  };
}

export default {
  name:  "dcf-scenario",
  price: "$0.045",

  description:
    "Three-scenario DCF model (bear / base / bull) for any US public company plus a sensitivity grid. Runs five-year FCF projections and Gordon Growth terminal value for each growth assumption in parallel, returns margin of safety and upside % per scenario, a probability-weighted composite intrinsic value, and a 5×5 sensitivity table across growth rates and WACC offsets. No API key required.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US stock ticker (e.g. AAPL, NVDA, MSFT). Case-insensitive.",
      },
      bear_growth_pct: {
        type: "number",
        description: "Bear-case annual FCF growth rate in % (e.g. 5.0 = 5%). Default: 50% of analyst consensus 5Y EPS CAGR.",
      },
      base_growth_pct: {
        type: "number",
        description: "Base-case annual FCF growth rate in % (e.g. 15.0 = 15%). Default: analyst consensus 5Y EPS CAGR.",
      },
      bull_growth_pct: {
        type: "number",
        description: "Bull-case annual FCF growth rate in % (e.g. 25.0 = 25%). Default: 150% of analyst consensus 5Y EPS CAGR.",
      },
      terminal_growth_pct: {
        type: "number",
        description: "Perpetuity growth rate after year 5 in % (default 3.0). Use 2.0–3.5 for mature companies.",
      },
      erp: {
        type: "number",
        description: "Equity risk premium in % (default 5.5 — Damodaran mature market ERP).",
      },
      bear_weight_pct: {
        type: "number",
        description: "Probability weight for bear scenario in % (default 25). Weights must sum to 100.",
      },
      base_weight_pct: {
        type: "number",
        description: "Probability weight for base scenario in % (default 50).",
      },
      bull_weight_pct: {
        type: "number",
        description: "Probability weight for bull scenario in % (default 25).",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:            { type: "string" },
      name:              { type: "string" },
      current_price_usd: { type: "number" },
      scenarios: {
        type: "object",
        description: "Intrinsic value and margin of safety for each scenario.",
        properties: {
          bear: { type: "object" },
          base: { type: "object" },
          bull: { type: "object" },
        },
      },
      weighted_intrinsic_usd: {
        type: "number",
        description: "Probability-weighted composite intrinsic value across all three scenarios.",
      },
      weighted_margin_of_safety_pct: { type: "number" },
      weighted_verdict: { type: "string", description: "UNDERVALUED | FAIRLY_VALUED | OVERVALUED based on weighted intrinsic." },
      scenario_weights: {
        type: "object",
        properties: {
          bear_pct: { type: "number" },
          base_pct: { type: "number" },
          bull_pct: { type: "number" },
        },
      },
      sensitivity_table: {
        type: "object",
        description: "Grid of intrinsic values: growth_rate rows × wacc_offset columns. WACC offsets from base: -2%, -1%, 0%, +1%, +2%.",
        properties: {
          growth_rates: { type: "array", items: { type: "number" } },
          wacc_offsets_pct: { type: "array", items: { type: "number" } },
          values_usd: {
            type: "array",
            description: "Row = growth rate (index into growth_rates), col = wacc offset (index into wacc_offsets_pct).",
            items: { type: "array", items: { type: "number" } },
          },
        },
      },
      assumptions: {
        type: "object",
        properties: {
          wacc_pct:            { type: "number" },
          terminal_growth_pct: { type: "number" },
          erp_pct:             { type: "number" },
          rf_rate_pct:         { type: "number" },
          growth_source:       { type: "string" },
          net_debt_usd:        { type: "number" },
          diluted_shares:      { type: "number" },
        },
      },
      ts: { type: "string" },
    },
  },

  async handler(query) {
    const rawTicker = (query.ticker || "AAPL").trim().toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
    if (!rawTicker) throw new Error("invalid ticker");

    const tgPct  = typeof query.terminal_growth_pct === "number" ? query.terminal_growth_pct : 3.0;
    const erpPct = typeof query.erp === "number" ? query.erp : 5.5;
    const erp    = erpPct / 100;
    const tg     = tgPct / 100;

    const bearW = typeof query.bear_weight_pct === "number" ? query.bear_weight_pct : 25;
    const baseW = typeof query.base_weight_pct === "number" ? query.base_weight_pct : 50;
    const bullW = typeof query.bull_weight_pct === "number" ? query.bull_weight_pct : 25;
    const totalW = bearW + baseW + bullW;
    if (Math.abs(totalW - 100) > 0.5) throw new Error(`Scenario weights must sum to 100 (got ${totalW})`);

    // Parallel fetch
    const [summaryData, fcfHistory, rfRaw] = await Promise.all([
      fetchSummary(rawTicker),
      fetchFCFHistory(rawTicker),
      fetch10YYield(),
    ]);

    const rf = rfRaw ?? 0.0425;
    const r  = summaryData?.quoteSummary?.result?.[0];
    if (!r) throw new Error(`No data for "${rawTicker}"`);

    const ks  = r.defaultKeyStatistics  || {};
    const fd  = r.financialData         || {};
    const sd  = r.summaryDetail         || {};
    const ish = r.incomeStatementHistory?.incomeStatementHistory || [];
    const et  = r.earningsTrend?.trend  || [];
    const qi  = r.quoteType            || {};

    const price = rawVal(fd.currentPrice) ?? rawVal(sd.previousClose);
    if (!price) throw new Error(`No price for "${rawTicker}"`);
    if (!fcfHistory.length) throw new Error(`No FCF history for "${rawTicker}"`);

    const baseFCF = fcfHistory[fcfHistory.length - 1].fcf_usd;
    if (!baseFCF) throw new Error("Most recent FCF is zero — DCF not meaningful");

    // Analyst 5Y EPS CAGR
    let consensusGrowthPct = null, growthSource = "caller_override";
    const trend5y = et.find(t => t.period === "+5y");
    const c5y     = trend5y ? rawVal(trend5y.growth) : null;
    if (c5y != null) {
      consensusGrowthPct = Math.min(Math.max(c5y * 100, tgPct + 0.1), 40.0);
      growthSource = "analyst_consensus";
    } else if (fcfHistory.length >= 2) {
      const oldest = fcfHistory[0].fcf_usd, newest = baseFCF;
      const years  = fcfHistory.length - 1;
      if (oldest > 0 && newest > 0) {
        consensusGrowthPct = Math.min(Math.max((Math.pow(newest / oldest, 1 / years) - 1) * 100, tgPct + 0.1), 40.0);
        growthSource = "historical_cagr";
      } else {
        consensusGrowthPct = 5.0;
        growthSource = "historical_cagr";
      }
    } else {
      consensusGrowthPct = 5.0;
      growthSource = "historical_cagr";
    }

    // Resolve scenario growth rates
    const bearGrowthPct = typeof query.bear_growth_pct === "number"
      ? query.bear_growth_pct
      : Math.max(r2(consensusGrowthPct * 0.5), tgPct + 0.1);
    const baseGrowthPct = typeof query.base_growth_pct === "number"
      ? query.base_growth_pct
      : consensusGrowthPct;
    const bullGrowthPct = typeof query.bull_growth_pct === "number"
      ? query.bull_growth_pct
      : Math.min(r2(consensusGrowthPct * 1.5), 40.0);

    // WACC
    const beta      = rawVal(ks.beta) ?? 1.0;
    const marketCap = rawVal(ks.marketCap);
    const totalDebt = rawVal(fd.totalDebt) ?? 0;
    const interestExp = ks.interestExpense ? Math.abs(rawVal(ks.interestExpense) ?? 0) : 0;
    const taxRate = (() => {
      const inc = ish[0];
      if (!inc) return 0.25;
      const taxExp  = Math.abs(rawVal(inc.incomeTaxExpense) ?? 0);
      const preTax  = rawVal(inc.pretaxIncome) ?? 0;
      return preTax > 0 ? Math.min(taxExp / preTax, 0.40) : 0.25;
    })();
    const ke = rf + beta * erp;
    const kd = totalDebt > 0 && interestExp > 0
      ? (interestExp / totalDebt) * (1 - taxRate)
      : rf * (1 - taxRate);
    const E    = marketCap ?? (price * (rawVal(ks.sharesOutstanding) ?? 1));
    const D    = totalDebt;
    const V    = E + D;
    const wacc = V > 0 ? (E / V) * ke + (D / V) * kd : ke;

    const cash    = rawVal(fd.totalCash) ?? 0;
    const netDebt = D - cash;
    const shares  = rawVal(ks.sharesOutstanding) ?? rawVal(ks.impliedSharesOutstanding) ?? 1;
    const name    = qi.longName || qi.shortName || rawTicker;

    const dcfArgs = { baseFCF, terminalGrowthPct: tgPct, wacc, netDebt, shares, price };

    // Three scenarios in parallel
    const [bear, base, bull] = await Promise.all([
      Promise.resolve(runDCF({ ...dcfArgs, growthPct: bearGrowthPct })),
      Promise.resolve(runDCF({ ...dcfArgs, growthPct: baseGrowthPct })),
      Promise.resolve(runDCF({ ...dcfArgs, growthPct: bullGrowthPct })),
    ]);

    // Weighted composite
    const scenarios = { bear, base, bull };
    const wBear = bearW / 100, wBase = baseW / 100, wBull = bullW / 100;
    const wIntrinsic = bear.error
      ? null
      : r2(wBear * bear.intrinsic_value_usd + wBase * base.intrinsic_value_usd + wBull * bull.intrinsic_value_usd);
    const wMOS = wIntrinsic != null
      ? r2(((wIntrinsic - price) / wIntrinsic) * 100)
      : null;
    const wVerdict = wMOS != null
      ? (wMOS > 20 ? "UNDERVALUED" : wMOS < -20 ? "OVERVALUED" : "FAIRLY_VALUED")
      : "INSUFFICIENT_DATA";

    // Sensitivity table — 5 growth rates × 5 WACC offsets
    const sensitivityGrowths  = [bearGrowthPct, (bearGrowthPct + baseGrowthPct) / 2, baseGrowthPct, (baseGrowthPct + bullGrowthPct) / 2, bullGrowthPct];
    const waccOffsets         = [-2, -1, 0, 1, 2]; // % offset from base WACC
    const sensitivityValues   = sensitivityGrowths.map(g =>
      waccOffsets.map(offset => {
        const w = wacc + offset / 100;
        if (w <= tg) return null;
        const res = runDCF({ baseFCF, growthPct: g, terminalGrowthPct: tgPct, wacc: w, netDebt, shares, price });
        return res.error ? null : r2(res.intrinsic_value_usd);
      })
    );

    return {
      ticker:  rawTicker,
      name,
      current_price_usd: r2(price),
      scenarios: {
        bear: { ...bear, scenario: "bear" },
        base: { ...base, scenario: "base" },
        bull: { ...bull, scenario: "bull" },
      },
      weighted_intrinsic_usd:        wIntrinsic,
      weighted_margin_of_safety_pct: wMOS,
      weighted_verdict:              wVerdict,
      scenario_weights: {
        bear_pct: bearW,
        base_pct: baseW,
        bull_pct: bullW,
      },
      sensitivity_table: {
        growth_rates:     sensitivityGrowths.map(g => r2(g)),
        wacc_offsets_pct: waccOffsets,
        values_usd:       sensitivityValues,
      },
      assumptions: {
        wacc_pct:            r2(wacc * 100),
        terminal_growth_pct: tgPct,
        erp_pct:             erpPct,
        rf_rate_pct:         r2(rf * 100),
        growth_source:       growthSource,
        consensus_growth_pct: r2(consensusGrowthPct),
        net_debt_usd:        Math.round(netDebt),
        diluted_shares:      Math.round(shares),
        beta:                r2(beta),
      },
      ts: new Date().toISOString(),
    };
  },
};
