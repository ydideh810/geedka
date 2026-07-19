// pre-earnings-brief.js
//
// Compact pre-earnings decision brief for any US public company.
// Combines next earnings date + EPS/revenue estimates, 4-quarter beat/miss
// history, analyst consensus (buy/hold/sell + price target), short interest,
// and 52-week technical position — all in one call.
//
// Natural follow-on to earnings-calendar: once you know WHICH companies report,
// this tells you WHETHER they're worth trading ahead of their number.
//
// Upstream: Yahoo Finance quoteSummary (crumb-auth, free, no key needed).
// Modules: defaultKeyStatistics, earningsHistory, calendarEvents,
//          earningsTrend, recommendationTrend, financialData, summaryDetail.

const UA           = "Mozilla/5.0 (compatible; myriad/4.7; +https://synaptiic.org)";
const YF_CRUMB_SRC = "https://fc.yahoo.com";
const YF_CRUMB_URL = "https://query2.finance.yahoo.com/v1/test/getcrumb";
const YF_SUMMARY   = "https://query2.finance.yahoo.com/v10/finance/quoteSummary";
const TMO          = 14_000;
const CRUMB_TTL    = 30 * 60 * 1000;

let _crumbCache = null;

function rv(field) {
  if (field == null) return null;
  if (typeof field === "number") return field;
  return field?.raw ?? null;
}
function r2(n) { return n != null ? Math.round(n * 100) / 100 : null; }
function pct(n) { return n != null ? Math.round(n * 1000) / 10 : null; }

async function refreshCrumb() {
  const seedResp = await fetch(YF_CRUMB_SRC, {
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(TMO),
  });
  const setCookies = seedResp.headers.getSetCookie?.() ?? [];
  const cookies = setCookies.map(c => c.split(";")[0]).join("; ");
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
  const modules = "defaultKeyStatistics,earningsHistory,calendarEvents,earningsTrend,recommendationTrend,financialData,summaryDetail";
  const url = `${YF_SUMMARY}/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "application/json" },
    signal: AbortSignal.timeout(TMO),
  });
  if (resp.status === 401 && retry) {
    _crumbCache = null;
    return fetchSummary(ticker, false);
  }
  if (!resp.ok) throw new Error(`Yahoo Finance returned ${resp.status}`);
  return resp.json();
}

export default {
  name:  "pre-earnings-brief",
  price: "$0.075",

  description:
    "Pre-earnings decision brief for any US stock: next earnings date + EPS/revenue consensus, 4-quarter beat/miss track record with average surprise %, analyst buy/hold/sell count and mean price target, short interest ratio, and 52-week technical position. Single call replaces 4+ separate lookups. Use after earnings-calendar to prioritize which upcoming reports warrant a trade.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US stock ticker symbol (e.g. 'AAPL', 'NVDA', 'TSLA').",
        minLength: 1,
        maxLength: 10,
      },
    },
    required: ["ticker"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:           { type: "string" },
      company_name:     { type: ["string", "null"] },
      current_price:    { type: ["number", "null"], description: "Current stock price (USD)." },
      week52_low:       { type: ["number", "null"] },
      week52_high:      { type: ["number", "null"] },
      week52_position_pct: { type: ["number", "null"], description: "Where current price sits in the 52-week range (0–100%)." },

      next_earnings: {
        type: "object",
        description: "Upcoming earnings event.",
        properties: {
          date_unix:       { type: ["number", "null"], description: "Earnings date as Unix timestamp." },
          date_iso:        { type: ["string", "null"], description: "Earnings date as YYYY-MM-DD." },
          days_until:      { type: ["number", "null"], description: "Calendar days until earnings." },
          eps_estimate:    { type: ["number", "null"], description: "Consensus EPS estimate (USD)." },
          revenue_estimate:{ type: ["number", "null"], description: "Consensus revenue estimate (USD)." },
        },
      },

      earnings_track_record: {
        type: "object",
        description: "Last 4 reported quarters.",
        properties: {
          history: {
            type: "array",
            items: {
              type: "object",
              properties: {
                period:       { type: ["string", "null"], description: "Quarter label (e.g. '-1q', '-2q')." },
                actual_eps:   { type: ["number", "null"] },
                estimate_eps: { type: ["number", "null"] },
                surprise_pct: { type: ["number", "null"], description: "Earnings surprise % (positive = beat)." },
                beat:         { type: ["boolean", "null"] },
              },
            },
          },
          beats:          { type: ["integer", "null"], description: "Number of beats in last 4 quarters." },
          consecutive_beats: { type: ["integer", "null"], description: "Current streak of consecutive beats (from most recent quarter back)." },
          avg_surprise_pct: { type: ["number", "null"], description: "Average earnings surprise % across last 4 quarters." },
        },
      },

      analyst_consensus: {
        type: "object",
        properties: {
          buy:              { type: ["integer", "null"] },
          hold:             { type: ["integer", "null"] },
          sell:             { type: ["integer", "null"] },
          total_analysts:   { type: ["integer", "null"] },
          buy_pct:          { type: ["number", "null"] },
          mean_target:      { type: ["number", "null"], description: "Mean price target (USD)." },
          high_target:      { type: ["number", "null"] },
          low_target:       { type: ["number", "null"] },
          upside_pct:       { type: ["number", "null"], description: "Upside to mean target from current price (%)." },
        },
      },

      short_interest: {
        type: "object",
        properties: {
          short_ratio:      { type: ["number", "null"], description: "Days to cover (shares short ÷ avg daily volume)." },
          short_pct_float:  { type: ["number", "null"], description: "Short interest as % of float." },
        },
      },

      ts: { type: "string" },
    },
  },

  async handler(query) {
    const ticker = (query.ticker || "").toUpperCase().trim();
    if (!ticker) throw new Error("ticker is required");

    const data = await fetchSummary(ticker);
    const res  = (data.quoteSummary?.result || [])[0];
    if (!res) {
      const err = data.quoteSummary?.error?.description || "unknown error";
      throw new Error(`Yahoo Finance: ${err}`);
    }

    const ks = res.defaultKeyStatistics || {};
    const fd = res.financialData        || {};
    const sd = res.summaryDetail        || {};
    const eh = (res.earningsHistory?.history || []).slice(-4);
    const ce = res.calendarEvents?.earnings  || {};
    const et = (res.earningsTrend?.trend     || [])[0] || {};
    const rt = (res.recommendationTrend?.trend || [])[0] || {};

    // Earnings track record
    const history = eh.map(h => {
      const actualEps    = rv(h.epsActual);
      const estimateEps  = rv(h.epsEstimate);
      const surprisePct  = h.surprisePercent != null ? pct(rv(h.surprisePercent)) : null;
      return {
        period:       h.period || null,
        actual_eps:   r2(actualEps),
        estimate_eps: r2(estimateEps),
        surprise_pct: surprisePct,
        beat:         surprisePct != null ? surprisePct > 0 : null,
      };
    });
    const beats = history.filter(h => h.beat === true).length;
    const avgSurprise = history.length > 0
      ? r2(history.reduce((s, h) => s + (h.surprise_pct ?? 0), 0) / history.length)
      : null;
    // Consecutive beats from most recent backward
    let consecutiveBeats = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].beat === true) consecutiveBeats++;
      else break;
    }

    // Next earnings
    const nextDateUnix = (ce.earningsDate || [])[0]?.raw || null;
    const nextDateIso  = nextDateUnix
      ? new Date(nextDateUnix * 1000).toISOString().slice(0, 10)
      : null;
    const nowTs      = Math.floor(Date.now() / 1000);
    const daysUntil  = nextDateUnix != null ? Math.ceil((nextDateUnix - nowTs) / 86400) : null;
    const epsEst     = r2(rv(ce.earningsAverage) ?? rv(et.earningsEstimate?.avg));
    const revEst     = rv(ce.revenueAverage) ?? rv(et.revenueEstimate?.avg);

    // Analyst consensus
    const buy  = rt.buy  || null;
    const hold = rt.hold || null;
    const sell = (rt.sell || 0) + (rt.strongSell || 0);
    const total = (buy || 0) + (hold || 0) + sell;
    const meanTarget    = r2(rv(fd.targetMeanPrice));
    const currentPrice  = r2(rv(fd.currentPrice) ?? rv(sd.regularMarketPrice));
    const upsidePct     = meanTarget && currentPrice
      ? r2(((meanTarget - currentPrice) / currentPrice) * 100)
      : null;

    // 52w position
    const low52  = r2(rv(sd.fiftyTwoWeekLow));
    const high52 = r2(rv(sd.fiftyTwoWeekHigh));
    const pos52  = low52 != null && high52 != null && high52 !== low52 && currentPrice != null
      ? r2(((currentPrice - low52) / (high52 - low52)) * 100)
      : null;

    return {
      ticker,
      company_name:  rv(ks.symbol) ?? ticker,
      current_price: currentPrice,
      week52_low:    low52,
      week52_high:   high52,
      week52_position_pct: pos52,

      next_earnings: {
        date_unix:        nextDateUnix,
        date_iso:         nextDateIso,
        days_until:       daysUntil,
        eps_estimate:     epsEst,
        revenue_estimate: revEst != null ? Math.round(revEst) : null,
      },

      earnings_track_record: {
        history,
        beats,
        consecutive_beats: consecutiveBeats,
        avg_surprise_pct:  avgSurprise,
      },

      analyst_consensus: {
        buy:            buy,
        hold:           hold,
        sell:           sell || null,
        total_analysts: total || null,
        buy_pct:        total ? r2((buy / total) * 100) : null,
        mean_target:    meanTarget,
        high_target:    r2(rv(fd.targetHighPrice)),
        low_target:     r2(rv(fd.targetLowPrice)),
        upside_pct:     upsidePct,
      },

      short_interest: {
        short_ratio:     r2(rv(ks.shortRatio)),
        short_pct_float: ks.shortPercentOfFloat != null ? pct(rv(ks.shortPercentOfFloat)) : null,
      },

      ts: new Date().toISOString(),
    };
  },
};
