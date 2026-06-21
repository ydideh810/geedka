// form-144-intel.js
//
// SEC Form 144 planned insider sale intelligence for US public companies.
// Form 144 is filed BEFORE an insider sells (unlike Form 4, which is post-trade),
// giving earlier signal on planned distribution from officers, directors, and
// significant shareholders. Returns planned sales with seller, relationship,
// share count, market value, approximate date, and acquisition type.
//
// Seam: agents using insider-trades (Form 4) or us-stock-price need pre-sale
// notice data for earlier signal. Form 144 filings often appear 2-5 days before
// the corresponding Form 4. No x402 competitor covers Form 144 specifically.
//
// Upstreams (all free, no key):
//   - https://www.sec.gov/files/company_tickers.json (ticker→CIK)
//   - https://data.sec.gov/submissions/CIK{cik}.json (filing index)
//   - https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/primary_doc.xml

const UA           = "the-stall/4.53 form-144-intel (kyle@intuitek.ai)";
const TICKER_MAP   = "https://www.sec.gov/files/company_tickers.json";
const SUBS_BASE    = "https://data.sec.gov/submissions/CIK";
const EDGAR_BASE   = "https://www.sec.gov/Archives/edgar/data";
const TIMEOUT_MS   = 12_000;
const MAX_FILINGS  = 8;

let _tickerCache = null;
let _cacheTs     = 0;
const CACHE_TTL  = 6 * 60 * 60 * 1000;

async function getTickerMap() {
  const now = Date.now();
  if (_tickerCache && now - _cacheTs < CACHE_TTL) return _tickerCache;
  const r = await fetch(TICKER_MAP, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`Ticker map fetch failed: ${r.status}`);
  const data = await r.json();
  const map = {};
  for (const v of Object.values(data)) {
    map[v.ticker.toUpperCase()] = String(v.cik_str).padStart(10, "0");
  }
  _tickerCache = map;
  _cacheTs = now;
  return map;
}

function xmlText(xml, tag) {
  // Handles both namespaced (own:tag, com:tag) and plain tags
  const bare = tag.includes(":") ? tag.split(":").pop() : tag;
  const re = new RegExp(`<(?:[a-z]+:)?${bare}[^>]*>\\s*([^<]+?)\\s*</(?:[a-z]+:)?${bare}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function xmlAll(xml, tag) {
  const bare = tag.includes(":") ? tag.split(":").pop() : tag;
  const re = new RegExp(`<(?:[a-z]+:)?${bare}[^>]*>\\s*([^<]+?)\\s*</(?:[a-z]+:)?${bare}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

function parseForm144Xml(xml) {
  const seller   = xmlText(xml, "nameOfPersonForWhoseAccountTheSecuritiesAreToBeSold");
  const relations = xmlAll(xml, "relationshipToIssuer");
  const shares   = xmlText(xml, "noOfUnitsSold");
  const mktVal   = xmlText(xml, "aggregateMarketValue");
  const approxDt = xmlText(xml, "approxSaleDate");
  const secClass = xmlText(xml, "securitiesClassTitle");
  const acquType = xmlText(xml, "natureOfAcquisitionTransaction");
  const broker   = xmlText(xml, "name"); // first <name> is broker
  const noticeDate = xmlText(xml, "noticeDate");
  const outstanding = xmlText(xml, "noOfUnitsOutstanding");

  return {
    seller:         seller || null,
    relationship:   relations.length > 0 ? relations.join(", ") : null,
    shares_planned: shares ? parseInt(shares, 10) : null,
    market_value:   mktVal ? parseFloat(mktVal) : null,
    approx_sale_date: approxDt || null,
    notice_date:    noticeDate || null,
    securities_class: secClass ? secClass.trim() : null,
    acquisition_type: acquType || null,
    broker:         broker || null,
    shares_outstanding: outstanding ? parseInt(outstanding, 10) : null,
  };
}

export default {
  name: "form-144-intel",
  price: "$0.077",
  description: "Retrieves SEC Form 144 planned insider sale filings for a US public company — earlier signal than Form 4 (post-trade). Returns seller name, role, shares planned for sale, market value, approximate sale date, and acquisition type (RSU, open market, etc.).",
  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US stock ticker symbol (e.g. NVDA, AAPL, MSFT).",
      },
      days: {
        type: "number",
        description: "Lookback window in days (default 30, max 180).",
        default: 30,
      },
    },
    required: [],
  },
  outputSchema: {
    type: "object",
    properties: {
      ticker:        { type: "string" },
      company:       { type: "string" },
      cik:           { type: "number" },
      days:          { type: "number" },
      filings_found: { type: "number" },
      filings_parsed:{ type: "number" },
      summary: {
        type: "object",
        properties: {
          total_planned_shares: { type: "number" },
          total_planned_value:  { type: "number" },
          unique_sellers:       { type: "number" },
          roles:                { type: "array", items: { type: "string" } },
        },
      },
      filings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            filing_date:      { type: "string" },
            seller:           { type: "string" },
            relationship:     { type: "string" },
            shares_planned:   { type: "number" },
            market_value:     { type: "number" },
            approx_sale_date: { type: "string" },
            notice_date:      { type: "string" },
            acquisition_type: { type: "string" },
            broker:           { type: "string" },
          },
        },
      },
    },
  },
  async handler({ ticker = "AAPL", days = 30 }) {
    ticker = (ticker || "AAPL").toUpperCase().trim();
    days = Math.min(Math.max(1, parseInt(days, 10) || 30), 180);

    // 1. Resolve ticker → CIK
    const map = await getTickerMap();
    const cik = map[ticker];
    if (!cik) throw new Error(`Unknown ticker: ${ticker}. Use a valid US exchange ticker.`);
    const cikInt = parseInt(cik, 10);

    // 2. Fetch company submissions index
    const subUrl = `${SUBS_BASE}${cik}.json`;
    const subResp = await fetch(subUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!subResp.ok) throw new Error(`EDGAR submissions fetch failed: ${subResp.status}`);
    const subs = await subResp.json();

    const company  = subs.name || ticker;
    const recent   = subs.filings?.recent || {};
    const forms    = recent.form || [];
    const dates    = recent.filingDate || [];
    const accNums  = recent.accessionNumber || [];
    const priDocs  = recent.primaryDocument || [];

    // 3. Filter Form 144 within lookback
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const selected = [];
    for (let i = 0; i < forms.length && selected.length < MAX_FILINGS; i++) {
      if (forms[i] === "144" && dates[i] >= cutoff) {
        selected.push({
          filing_date: dates[i],
          acc:         accNums[i].replace(/-/g, ""),
          primaryDoc:  priDocs[i] || "primary_doc.xml",
        });
      }
    }

    if (selected.length === 0) {
      return {
        ticker,
        company,
        cik: cikInt,
        days,
        filings_found: 0,
        filings_parsed: 0,
        summary: { total_planned_shares: null, total_planned_value: null, unique_sellers: 0, roles: [] },
        filings: [],
        message: `No Form 144 planned insider sale filings found for ${ticker} in the last ${days} days.`,
      };
    }

    // 4. Fetch and parse each Form 144 XML
    const parsed = [];
    await Promise.allSettled(selected.map(async ({ filing_date, acc, primaryDoc }) => {
      try {
        const rawPd = primaryDoc.includes("/") ? primaryDoc.split("/").pop() : primaryDoc;
        const candidates = [
          `${EDGAR_BASE}/${cikInt}/${acc}/${rawPd}`,
          `${EDGAR_BASE}/${cikInt}/${acc}/primary_doc.xml`,
        ];
        let xml = null;
        for (const url of candidates) {
          const r = await fetch(url, {
            headers: { "User-Agent": UA },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (r.ok) { xml = await r.text(); break; }
        }
        if (!xml) return;
        const fields = parseForm144Xml(xml);
        if (fields.seller || fields.shares_planned) {
          parsed.push({ filing_date, ...fields });
        }
      } catch (_) {}
    }));

    parsed.sort((a, b) => b.filing_date.localeCompare(a.filing_date));

    // 5. Summary
    let totalShares = 0, totalValue = 0;
    const sellers = new Set();
    const roles = new Set();
    for (const f of parsed) {
      if (f.shares_planned) totalShares += f.shares_planned;
      if (f.market_value)   totalValue  += f.market_value;
      if (f.seller)         sellers.add(f.seller);
      if (f.relationship)   f.relationship.split(",").forEach(r => roles.add(r.trim()));
    }

    return {
      ticker,
      company,
      cik: cikInt,
      days,
      filings_found:  selected.length,
      filings_parsed: parsed.length,
      summary: {
        total_planned_shares: totalShares || null,
        total_planned_value:  totalValue  ? Math.round(totalValue) : null,
        unique_sellers:       sellers.size,
        roles:                [...roles],
      },
      filings: parsed,
    };
  },
};
