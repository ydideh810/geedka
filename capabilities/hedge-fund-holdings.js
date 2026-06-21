// hedge-fund-holdings.js
//
// Returns top stock holdings from any institutional investor's most recent
// SEC 13F filing (quarterly). Searches EDGAR by institution name, finds the
// latest 13F-HR, parses the information table, and returns positions sorted
// by market value.
//
// Source: SEC EDGAR public APIs (efts.sec.gov, data.sec.gov, sec.gov Archives).
// No API key. No auth. Public government data. Updated quarterly.
//
// Covers all 13F filers: hedge funds (Renaissance, Bridgewater, Two Sigma),
// mutual funds, pension funds, family offices — any manager with $100M+ AUM.
//
// Seam: institutional flow analysis typically requires a $25–50/mo Quiver
// Quantitative or Whale Watcher subscription. This delivers the same SEC data
// on-demand for $0.025/call.

const UA       = "Aegis/1.0 (the-stall x402; +https://intuitek.ai; kyle@intuitek.ai)";
const TIMEOUT  = 12_000;
const BROWSE   = "https://www.sec.gov/cgi-bin/browse-edgar";
const SUBS_URL = "https://data.sec.gov/submissions/CIK{CIK}.json";
const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";

async function fetchText(url, accept = "text/html") {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": accept },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

// Step 1: institution name → CIK via EDGAR company search
async function nameToCIK(name) {
  const params = new URLSearchParams({
    company: name, CIK: "", type: "13F-HR",
    owner: "include", count: "5", action: "getcompany",
  });
  const html = await fetchText(`${BROWSE}?${params}`);
  const m = html.match(/CIK=(\d{10})/);
  if (!m) throw new Error(`No 13F filer found for "${name}" — try a more specific spelling`);
  return m[1];
}

// Step 2: CIK → most recent 13F-HR accession number
async function latestAccession(cik10) {
  const url  = SUBS_URL.replace("{CIK}", cik10);
  const data = await fetchJson(url);
  const fil  = data.filings?.recent || {};
  const forms  = fil.form          || [];
  const dates  = fil.filingDate    || [];
  const accs   = fil.accessionNumber || [];
  const periods = fil.reportDate   || [];

  let idx = -1, bestDate = "";
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === "13F-HR" && dates[i] > bestDate) {
      bestDate = dates[i];
      idx = i;
    }
  }
  if (idx < 0) throw new Error("No 13F-HR filings found for this institution");
  return {
    name:      data.name || "",
    cik:       cik10,
    accession: accs[idx],
    file_date: dates[idx],
    period:    periods[idx] || "",
  };
}

async function findLatest13F(institutionName) {
  const cik10  = await nameToCIK(institutionName);
  return latestAccession(cik10);
}

async function getInfoTableXmlUrl(cik, adsh) {
  const acc = adsh.replace(/-/g, "");
  const listUrl = `${ARCHIVES}/${parseInt(cik, 10)}/${acc}/`;
  const html = await fetchText(listUrl);
  // Find XML files excluding primary_doc.xml
  const matches = [...html.matchAll(/href="(\/Archives\/edgar\/data\/[^"]+\.xml)"/g)];
  const xmlFiles = matches.map(m => m[1]).filter(f => !f.includes("primary_doc"));
  if (xmlFiles.length === 0) {
    // Fallback: try primary_doc anyway for filings with only one XML
    const all = matches.map(m => m[1]);
    if (all.length > 0) return `https://www.sec.gov${all[0]}`;
    throw new Error("No XML information table found in 13F filing");
  }
  return `https://www.sec.gov${xmlFiles[0]}`;
}

function parseInfoTable(xmlText) {
  // Use regex-based parser to avoid DOM dependency
  const NS = "thirteenf/informationtable";
  const tables = [...xmlText.matchAll(/<infoTable[\s\S]*?<\/infoTable>/g)].map(m => m[0]);

  const aggregated = {};
  for (const tbl of tables) {
    const get = (tag) => {
      const m = tbl.match(new RegExp(`<${tag}[^>]*>([^<]*)<`));
      return m ? m[1].trim() : "";
    };
    const name   = get("nameOfIssuer");
    const cls    = get("titleOfClass");
    const cusip  = get("cusip");
    const value  = parseInt(get("value") || "0", 10);
    const shares = parseInt(get("sshPrnamt") || "0", 10);
    const stype  = get("sshPrnamtType") || "SH";

    const key = `${name}|${cls}|${stype}`;
    if (aggregated[key]) {
      aggregated[key].value_thousands  += value;
      aggregated[key].shares          += shares;
    } else {
      aggregated[key] = { name, share_class: cls, cusip, share_type: stype, value_thousands: value, shares };
    }
  }
  return Object.values(aggregated);
}

export default {
  name: "hedge-fund-holdings",
  price: "$0.097",

  description:
    "Returns top stock holdings from any institution's latest SEC 13F filing. Input: institution name (e.g. 'Renaissance Technologies', 'Bridgewater Associates'). Output: top 25 positions by market value with shares, value, and portfolio weight. No API key. SEC EDGAR source. $0.025 vs $25-50/mo Quiver Quant subscription.",

  inputSchema: {
    type: "object",
    properties: {
      institution: {
        type: "string",
        description: "Institutional investor name as it appears in SEC filings (e.g. 'Renaissance Technologies', 'Berkshire Hathaway', 'Two Sigma').",
      },
      limit: {
        type: "integer",
        description: "Max number of top holdings to return (default: 25, max: 100).",
        default: 25,
      },
      include_options: {
        type: "boolean",
        description: "If true, includes PUT and CALL option positions alongside equity holdings. Default: false (equity SH positions only).",
        default: false,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      institution:    { type: "string",  description: "Matched institution name from EDGAR." },
      cik:            { type: "string",  description: "SEC CIK identifier." },
      period_ending:  { type: "string",  description: "Quarter-end date this filing covers (YYYY-MM-DD)." },
      file_date:      { type: "string",  description: "Date the 13F was filed with the SEC." },
      total_value_m:  { type: "number",  description: "Total 13F portfolio value in millions USD." },
      total_positions:{ type: "integer", description: "Number of distinct positions in the filing." },
      holdings: {
        type: "array",
        description: "Top holdings sorted by market value descending.",
        items: {
          type: "object",
          properties: {
            rank:            { type: "integer" },
            name:            { type: "string",  description: "Issuer name." },
            share_class:     { type: "string",  description: "COM, ADR, etc." },
            share_type:      { type: "string",  description: "SH = shares, PUT = put options, CALL = call options." },
            cusip:           { type: "string",  description: "CUSIP identifier." },
            shares:          { type: "integer", description: "Number of shares or option contracts." },
            value_m:         { type: "number",  description: "Market value in millions USD (from 13F, in thousands × 1000)." },
            portfolio_pct:   { type: "number",  description: "Percentage of total 13F portfolio." },
          },
        },
      },
    },
  },

  async handler({ institution = "Bridgewater Associates", limit = 25, include_options = false }) {
    const n = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);

    // Step 1: find latest 13F filing
    const filing   = await findLatest13F(institution);
    const cik      = filing.cik;
    const adsh     = filing.accession;
    const fileDate = filing.file_date;
    const period   = filing.period;
    const dispName = filing.name || institution;

    // Step 2: get info table XML URL
    const xmlUrl = await getInfoTableXmlUrl(cik.replace(/^0+/, ""), adsh);

    // Step 3: fetch and parse XML
    const xmlText = await fetchText(xmlUrl);
    const allHoldings = parseInfoTable(xmlText);

    // Step 4: filter and sort
    const filtered = include_options
      ? allHoldings
      : allHoldings.filter(h => h.share_type === "SH");

    const totalValue = filtered.reduce((s, h) => s + h.value_thousands, 0);
    const sorted = filtered.sort((a, b) => b.value_thousands - a.value_thousands);

    const top = sorted.slice(0, n).map((h, i) => ({
      rank:          i + 1,
      name:          h.name,
      share_class:   h.share_class,
      share_type:    h.share_type,
      cusip:         h.cusip,
      shares:        h.shares,
      value_m:       Math.round(h.value_thousands / 1000 * 100) / 100,
      portfolio_pct: totalValue > 0
        ? Math.round(h.value_thousands / totalValue * 10000) / 100
        : 0,
    }));

    return {
      institution:    dispName.replace(/\s+\(CIK.*?\)/, "").trim(),
      cik:            cik,
      period_ending:  period,
      file_date:      fileDate,
      total_value_m:  Math.round(totalValue / 1000 * 100) / 100,
      total_positions: filtered.length,
      holdings:       top,
    };
  },
};
