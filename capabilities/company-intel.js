// company-intel.js
//
// SEC EDGAR due diligence data for any US public company by ticker symbol.
// Returns identity, industry classification, and 2-year filing history.
//
// Seam: orbisapi.com/proxy/agent-company-intelligence-due-diligence-ap
//       7,465 settlements/week, 17 payers, avg $0.005/call — highest-demand
//       intelligence seam identified in prospector analysis 2026-06-05.
//
// Upstream: SEC EDGAR public APIs (US government, free, no key required).
//   - EFTS full-text search for CIK lookup by ticker
//   - data.sec.gov/submissions/{CIK}.json for company profile + filing history

const EDGAR_SEARCH = "https://efts.sec.gov/LATEST/search-index";
const EDGAR_SUBS   = "https://data.sec.gov/submissions";
const UA           = "Mozilla/5.0 (compatible; the-stall/2.8; +https://intuitek.ai)";
const TIMEOUT_MS   = 12000;

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from EDGAR`);
  return resp.json();
}

function padCik(cik) {
  const num = parseInt(cik, 10);
  if (isNaN(num)) throw new Error(`Invalid CIK: ${cik}`);
  return String(num).padStart(10, "0");
}

function formatFiscalYearEnd(mmdd) {
  if (!mmdd || mmdd.length !== 4) return mmdd || null;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(mmdd.slice(0, 2), 10);
  const d = parseInt(mmdd.slice(2, 4), 10);
  if (m < 1 || m > 12) return mmdd;
  return `${months[m - 1]} ${d}`;
}

export default {
  name:  "company-intel",
  price: "$0.059",

  description:
    "Returns SEC EDGAR due diligence data for any US public company by ticker symbol: legal name, CIK, SIC industry code and description, state of incorporation, fiscal year end, SEC filer category, primary business location, and 2-year filing history (10-K/10-Q/8-K counts and most-recent dates). Use before any agent task involving US public company identification, regulatory filing assessment, financial analysis, or industry classification. Free upstream: SEC EDGAR public API (US government data, no key required, always current).",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      ticker: {
        type: "string",
        description:
          "US stock ticker symbol (e.g. 'AAPL', 'MSFT', 'TSLA'). Case-insensitive. Standard tickers only — class-suffix tickers like BRK.A may need to be submitted as BRKA.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      name:                   { type: "string",          description: "Company legal name as filed with SEC." },
      ticker:                 { type: "string",          description: "Ticker symbol (uppercased, as matched in EDGAR)." },
      cik:                    { type: "string",          description: "SEC Central Index Key (10-digit, zero-padded)." },
      sic:                    { type: ["string","null"], description: "Standard Industrial Classification code." },
      sic_description:        { type: ["string","null"], description: "SIC industry description." },
      state_of_incorporation: { type: ["string","null"], description: "US state code where the company is incorporated." },
      business_location:      { type: ["string","null"], description: "Primary business location (city, state) from most recent filing." },
      filer_category:         { type: ["string","null"], description: "SEC filer category (e.g. 'Large accelerated filer', 'Non-accelerated filer')." },
      fiscal_year_end:        { type: ["string","null"], description: "Fiscal year end formatted as 'Mon D' (e.g. 'Sep 26')." },
      filings_2y: {
        type: "object",
        description: "Count of each SEC form type filed in the last 2 years.",
        additionalProperties: { type: "integer" },
      },
      last_10k:   { type: ["string","null"], description: "Date of most recent 10-K annual report (YYYY-MM-DD)." },
      last_10q:   { type: ["string","null"], description: "Date of most recent 10-Q quarterly report (YYYY-MM-DD)." },
      last_8k:    { type: ["string","null"], description: "Date of most recent 8-K material event filing (YYYY-MM-DD)." },
      edgar_url:  { type: "string",          description: "EDGAR company filing page URL." },
      ts:         { type: "string",          description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const ticker = (query.ticker || "AAPL").toUpperCase().trim();

    // Step 1: Locate CIK via EDGAR full-text search (10-K filings, last 5 years).
    // EDGAR display_names format: "Company Name  (TICKER)  (CIK 0000123456)"
    const cutoffYear = new Date().getFullYear() - 5;
    const searchUrl = `${EDGAR_SEARCH}?q=%22${encodeURIComponent(ticker)}%22&forms=10-K&dateRange=custom&startdt=${cutoffYear}-01-01`;
    const searchData = await fetchJson(searchUrl);

    const hits = searchData.hits?.hits || [];
    if (hits.length === 0) {
      throw new Error(`No 10-K filings found for "${ticker}". Verify it is a US public company with SEC filings.`);
    }

    const tickerTag = `(${ticker})`;
    const hit = hits.find(h =>
      h._source?.display_names?.some(n => n.includes(tickerTag))
    );

    if (!hit) {
      throw new Error(`Ticker "${ticker}" not matched in EDGAR display names. It may be delisted, OTC-only, or require a different ticker format.`);
    }

    const rawCik       = hit._source.ciks[0];
    const paddedCik    = padCik(rawCik);
    const bizLocation  = hit._source.biz_locations?.[0] || null;

    // Step 2: Fetch full company submission record.
    const subData = await fetchJson(`${EDGAR_SUBS}/CIK${paddedCik}.json`);

    // Step 3: Analyze filings in the 2-year window.
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const cutoff = twoYearsAgo.toISOString().slice(0, 10);

    const recent  = subData.filings?.recent || {};
    const forms   = recent.form        || [];
    const dates   = recent.filingDate  || [];

    const filings_2y = {};
    const lastByForm = {};

    for (let i = 0; i < forms.length; i++) {
      const date = dates[i];
      if (date < cutoff) continue;
      const form = forms[i];
      filings_2y[form] = (filings_2y[form] || 0) + 1;
      if (!lastByForm[form]) lastByForm[form] = date; // reverse-chron: first = most recent
    }

    return {
      name:                   subData.name,
      ticker,
      cik:                    paddedCik,
      sic:                    subData.sic          || null,
      sic_description:        subData.sicDescription || null,
      state_of_incorporation: subData.stateOfIncorporation || null,
      business_location:      bizLocation,
      filer_category:         subData.category     || null,
      fiscal_year_end:        formatFiscalYearEnd(subData.fiscalYearEnd),
      filings_2y,
      last_10k:               lastByForm["10-K"]   || null,
      last_10q:               lastByForm["10-Q"]   || null,
      last_8k:                lastByForm["8-K"]    || null,
      edgar_url:              `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=10-K&dateb=&owner=include&count=40`,
      ts:                     new Date().toISOString(),
    };
  },
};
