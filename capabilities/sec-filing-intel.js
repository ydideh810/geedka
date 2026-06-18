// sec-filing-intel.js
//
// Real-time SEC EDGAR filing lookup for any US public company. Resolves
// ticker → CIK, fetches the company's filing history, and returns structured
// results with EDGAR URLs. Covers 8-K (material events), 10-K/10-Q (annual/
// quarterly reports), Form 4 (insider transactions), DEF 14A (proxy), and
// every other EDGAR form type.
//
// Source: SEC EDGAR public APIs (data.sec.gov + www.sec.gov). No API key.
// No auth. Authoritative US government data updated within minutes of filing.
//
// Seam: agents doing due-diligence, compliance, or earnings-prep pipelines
// currently chain ticker-lookup + EDGAR search + filing-parse in 3+ calls.
// This collapses the chain into one paid endpoint at $0.015.

const UA      = "Mozilla/5.0 (compatible; the-stall/3.62; +https://intuitek.ai; kyle@intuitek.ai)";
const TIMEOUT = 10_000;

const TICKERS_URL    = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{CIK}.json";
const EDGAR_BASE     = "https://www.sec.gov/Archives/edgar/data";
const VIEWER_BASE    = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={CIK}&type={FORM}&dateb=&owner=include&count=10";

// Cache the ticker map in-process across calls (immutable at SEC)
let _tickerMap = null;

async function getTickerMap() {
  if (_tickerMap) return _tickerMap;
  const r = await fetch(TICKERS_URL, {
    headers: { "User-Agent": UA },
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`Ticker map fetch failed: ${r.status}`);
  const raw = await r.json();
  const map = {};
  for (const v of Object.values(raw)) {
    map[v.ticker.toUpperCase()] = {
      cik:   String(v.cik_str).padStart(10, "0"),
      title: v.title,
    };
  }
  _tickerMap = map;
  return map;
}

async function getCompanySubmissions(cik10) {
  const url = SUBMISSIONS_URL.replace("{CIK}", cik10);
  const r   = await fetch(url, {
    headers: { "User-Agent": UA },
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`EDGAR submissions fetch failed: ${r.status} for CIK ${cik10}`);
  return r.json();
}

function buildEdgarUrl(cik10, accessionRaw) {
  const acc = accessionRaw.replace(/-/g, "");
  return `${EDGAR_BASE}/${parseInt(cik10, 10)}/${acc}/${accessionRaw}-index.htm`;
}

export default {
  name:  "sec-filing-intel",
  price: "$0.018",

  description:
    "Real-time SEC EDGAR filing lookup by ticker or CIK. Returns company profile plus recent filings (form type, date, description, EDGAR URL). Supports 8-K (material events), 10-K/10-Q (earnings), Form 4 (insider trades), DEF14A (proxy), and all other EDGAR form types. Authoritative US government data, no API key, updated within minutes of filing.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description:
          "US public company ticker symbol (e.g. AAPL, MSFT, TSLA). Case-insensitive. Provide either ticker or cik.",
      },
      cik: {
        type: "string",
        description:
          "SEC Central Index Key (CIK). Provide as numeric string or zero-padded 10-digit form. Use instead of ticker if ticker is unknown.",
      },
      form_type: {
        type: "string",
        description:
          "Filter results to a specific form type (e.g. 8-K, 10-K, 10-Q, 4, DEF14A, S-1). Case-insensitive. If omitted, returns all recent filings.",
      },
      limit: {
        type: "integer",
        description: "Max number of filings to return. Default 10, max 25.",
        minimum: 1,
        maximum: 25,
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      company: {
        type: "object",
        properties: {
          name:            { type: "string" },
          ticker:          { type: ["string", "null"] },
          cik:             { type: "string" },
          sic:             { type: ["string", "null"] },
          sic_description: { type: ["string", "null"] },
          exchanges:       { type: "array", items: { type: "string" } },
          state:           { type: ["string", "null"] },
        },
      },
      filings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            accession_number: { type: "string" },
            form:             { type: "string" },
            filing_date:      { type: "string" },
            report_date:      { type: ["string", "null"] },
            description:      { type: ["string", "null"] },
            items:            { type: "array", items: { type: "string" } },
            edgar_url:        { type: "string" },
          },
        },
      },
      total_recent_filings: { type: "integer" },
      filtered_count:        { type: "integer" },
      form_filter_applied:   { type: ["string", "null"] },
      timestamp:             { type: "string" },
    },
  },

  async handler({ ticker, cik, form_type, limit }) {
    const maxItems = Math.min(parseInt(limit) || 10, 25);
    const formFilter = form_type ? form_type.toUpperCase() : null;

    // ── Resolve CIK ──────────────────────────────────────────────────────────
    let cik10, resolvedTicker;

    if (cik) {
      cik10 = String(cik).replace(/\D/g, "").padStart(10, "0");
    } else if (ticker) {
      const tMap = await getTickerMap();
      const entry = tMap[ticker.toUpperCase()];
      if (!entry) {
        return {
          error:   "ticker_not_found",
          message: `Ticker "${ticker.toUpperCase()}" not found in SEC EDGAR. Try providing the CIK directly.`,
        };
      }
      cik10 = entry.cik;
      resolvedTicker = ticker.toUpperCase();
    } else {
      return { error: "missing_input", message: "Provide either ticker or cik." };
    }

    // ── Fetch submissions ────────────────────────────────────────────────────
    let sub;
    try {
      sub = await getCompanySubmissions(cik10);
    } catch (err) {
      return { error: "edgar_fetch_failed", message: err.message };
    }

    // ── Build company profile ────────────────────────────────────────────────
    const company = {
      name:            sub.name        || null,
      ticker:          resolvedTicker  || (sub.tickers?.[0] || null),
      cik:             cik10,
      sic:             sub.sic         || null,
      sic_description: sub.sicDescription || null,
      exchanges:       sub.exchanges   || [],
      state:           sub.stateOfIncorporation || null,
    };

    // ── Extract recent filings ───────────────────────────────────────────────
    const rf       = sub.filings?.recent || {};
    const accNums  = rf.accessionNumber  || [];
    const forms    = rf.form            || [];
    const dates    = rf.filingDate      || [];
    const reports  = rf.reportDate      || [];
    const descs    = rf.primaryDocDescription || [];
    const items    = rf.items           || [];

    const totalRecent = accNums.length;

    const allFilings = accNums.map((acc, i) => ({
      accession_number: acc,
      form:             forms[i]   || "",
      filing_date:      dates[i]   || "",
      report_date:      reports[i] || null,
      description:      descs[i]  || null,
      items:            items[i]  ? (Array.isArray(items[i]) ? items[i] : [items[i]]) : [],
      edgar_url:        buildEdgarUrl(cik10, acc),
    }));

    const filtered = formFilter
      ? allFilings.filter(f => f.form.toUpperCase().startsWith(formFilter))
      : allFilings;

    return {
      company,
      filings:              filtered.slice(0, maxItems),
      total_recent_filings: totalRecent,
      filtered_count:       filtered.length,
      form_filter_applied:  formFilter,
      timestamp:            new Date().toISOString(),
    };
  },
};
