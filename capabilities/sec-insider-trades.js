// sec-insider-trades.js
//
// Recent SEC Form 4 insider transactions for any US public company.
// Sources: SEC EDGAR company_tickers.json (CIK lookup) + submissions API
//          + Form 4 XML (individual transaction data).
// No API key. SEC EDGAR data is public domain.
//
// Returns: insider name, title/role, transaction date, type (buy/sell/award),
// shares, price per share, and post-transaction ownership.
//
// Seam: OpenInsider, Insider Monitor, Finviz premium charge for structured
// insider data. EDGAR primary source at $0.015/call cuts cost to zero.
//
// [REDACTED]3, 2026-06-07.

const SEC_BASE    = "https://data.sec.gov";
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const TMO         = 15_000;
const UA          = "Mozilla/5.0 (compatible; the-stall/1.0; research; +https://intuitek.ai)";

const TX_CODES = {
  S: "sell",
  P: "buy",
  A: "award/grant",
  D: "disposal to issuer",
  F: "tax withholding",
  M: "derivative exercise",
  G: "gift",
  C: "conversion",
  J: "other",
  K: "equity swap",
  L: "small acquisition",
  W: "inheritance",
  X: "exercise/conversion",
  Z: "trust",
};

let tickerCache    = null; // Map: uppercase ticker → {cik_str, title}
let tickerCacheTs  = 0;
const TICKER_TTL   = 24 * 60 * 60 * 1000;

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal:  AbortSignal.timeout(TMO),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json();
}

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA },
    signal:  AbortSignal.timeout(TMO),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.text();
}

async function loadTickers() {
  if (tickerCache && Date.now() - tickerCacheTs < TICKER_TTL) return;
  const raw = await fetchJson(TICKERS_URL);
  tickerCache = new Map();
  for (const entry of Object.values(raw)) {
    tickerCache.set(entry.ticker.toUpperCase(), {
      cik: entry.cik_str,
      title: entry.title,
    });
  }
  tickerCacheTs = Date.now();
}

function xmlVal(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>[\\s]*<value>([^<]*)</value>`, "s"));
  return m ? m[1].trim() : null;
}

function xmlDirect(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return m ? m[1].trim() : null;
}

function xmlBlocks(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function parseTransactions(xml) {
  const txns = [];

  for (const block of xmlBlocks(xml, "nonDerivativeTransaction")) {
    const security = xmlVal(block, "securityTitle") ?? xmlDirect(block, "securityTitle") ?? "Common Stock";
    const date     = xmlVal(block, "transactionDate");
    const code     = xmlDirect(block, "transactionCode");
    const sharesRaw = xmlVal(block, "transactionShares") ?? xmlDirect(block, "transactionShares");
    const priceRaw  = xmlVal(block, "transactionPricePerShare") ?? xmlDirect(block, "transactionPricePerShare");
    const adCode    = xmlVal(block, "transactionAcquiredDisposedCode") ?? xmlDirect(block, "transactionAcquiredDisposedCode");
    const afterRaw  = xmlVal(block, "sharesOwnedFollowingTransaction") ?? xmlDirect(block, "sharesOwnedFollowingTransaction");
    const directRaw = xmlVal(block, "directOrIndirectOwnership") ?? xmlDirect(block, "directOrIndirectOwnership");

    const shares = sharesRaw ? parseFloat(sharesRaw) : null;
    const price  = priceRaw  ? parseFloat(priceRaw)  : null;
    const after  = afterRaw  ? parseFloat(afterRaw)  : null;

    txns.push({
      security,
      date:           date ?? null,
      transaction_type: TX_CODES[code] ?? code ?? "unknown",
      code:           code ?? null,
      acquired_or_disposed: adCode === "A" ? "acquired" : adCode === "D" ? "disposed" : adCode ?? null,
      shares:         shares,
      price_per_share: price,
      value_usd:      shares != null && price != null ? Math.round(shares * price) : null,
      shares_after:   after,
      direct_ownership: directRaw === "D",
    });
  }

  // Derivative transactions (options/warrants exercised, etc.)
  for (const block of xmlBlocks(xml, "derivativeTransaction")) {
    const security = xmlVal(block, "securityTitle") ?? "Derivative";
    const date     = xmlVal(block, "transactionDate");
    const code     = xmlDirect(block, "transactionCode");
    const sharesRaw = xmlVal(block, "transactionShares") ?? xmlDirect(block, "transactionShares");
    const priceRaw  = xmlVal(block, "exercisePrice") ?? xmlVal(block, "transactionPricePerShare");
    const adCode    = xmlVal(block, "transactionAcquiredDisposedCode") ?? xmlDirect(block, "transactionAcquiredDisposedCode");
    const afterRaw  = xmlVal(block, "sharesOwnedFollowingTransaction");

    txns.push({
      security,
      date:           date ?? null,
      transaction_type: TX_CODES[code] ?? code ?? "unknown",
      code:           code ?? null,
      acquired_or_disposed: adCode === "A" ? "acquired" : adCode === "D" ? "disposed" : adCode ?? null,
      shares:         sharesRaw ? parseFloat(sharesRaw) : null,
      price_per_share: priceRaw ? parseFloat(priceRaw) : null,
      value_usd:      null,
      shares_after:   afterRaw ? parseFloat(afterRaw) : null,
      direct_ownership: null,
      is_derivative:  true,
    });
  }

  return txns;
}

async function parseForm4(cik, accession, primaryDoc) {
  const accNoDash = accession.replace(/-/g, "");
  // primaryDoc may be "xslF345X06/wk-form4_xxx.xml" — strip any path prefix
  const xmlFile = primaryDoc
    ? primaryDoc.split("/").pop()
    : "form4.xml";
  const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${xmlFile}`;
  let xml;
  try {
    xml = await fetchText(xmlUrl);
    if (xml.includes("<Error>") || xml.includes("NoSuchKey")) throw new Error("not found");
  } catch {
    return null;
  }

  const period     = xmlDirect(xml, "periodOfReport");
  const issuerName = xmlDirect(xml, "issuerName");
  const ownerName  = xmlDirect(xml, "rptOwnerName");
  const isDirector = xmlDirect(xml, "isDirector") === "1" || xmlDirect(xml, "isDirector") === "true";
  const isOfficer  = xmlDirect(xml, "isOfficer")  === "1" || xmlDirect(xml, "isOfficer")  === "true";
  const is10Pct    = xmlDirect(xml, "isTenPercentOwner") === "1";
  const title      = xmlDirect(xml, "officerTitle");

  return {
    period_of_report: period ?? null,
    issuer:           issuerName ?? null,
    insider_name:     ownerName ?? null,
    is_director:      isDirector,
    is_officer:       isOfficer,
    is_ten_pct_owner: is10Pct,
    officer_title:    title && title !== "0" ? title : null,
    transactions:     parseTransactions(xml),
  };
}

export default {
  name:  "sec-insider-trades",
  price: "$0.020",

  description:
    "SEC EDGAR Form 4 insider trading data for any US public company — shows recent insider buys, sells, awards, and exercises with shares, price, and post-transaction ownership. No API key. EDGAR primary source.",

  inputSchema: {
    type:     "object",
    required: [],
    properties: {
      ticker: {
        type:        "string",
        description: "US stock ticker symbol. Examples: AAPL, NVDA, TSLA, MSFT.",
        minLength:   1,
        maxLength:   10,
      },
      limit: {
        type:        "integer",
        description: "Number of recent Form 4 filings to retrieve and parse. Default 10, max 25.",
        default:     10,
        minimum:     1,
        maximum:     25,
      },
      include_derivatives: {
        type:        "boolean",
        description: "Include derivative transactions (option exercises, conversions). Default true.",
        default:     true,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:       { type: "string" },
      company_name: { type: "string" },
      cik:          { type: "string" },
      filings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            filing_date:       { type: "string" },
            period_of_report:  { type: "string" },
            insider_name:      { type: "string" },
            is_director:       { type: "boolean" },
            is_officer:        { type: "boolean" },
            is_ten_pct_owner:  { type: "boolean" },
            officer_title:     { type: ["string", "null"] },
            transactions:      { type: "array" },
            form_url:          { type: "string" },
          },
        },
      },
      total_filings_found:  { type: "integer", description: "Total Form 4 filings available in EDGAR for this company" },
      total_filings_parsed: { type: "integer" },
      source: { type: "string" },
    },
  },

  async handler({ ticker = "AAPL", limit = 10, include_derivatives = true }) {
    const sym = ticker.trim().toUpperCase();
    if (!/^[A-Z]{1,10}$/.test(sym)) {
      return { error: `Invalid ticker format: ${sym}` };
    }

    // CIK lookup
    await loadTickers();
    const entry = tickerCache.get(sym);
    if (!entry) {
      return { error: `Ticker not found in SEC EDGAR: ${sym}. Try the full company name or check the symbol.` };
    }

    const cik    = entry.cik;
    const cikPad = String(cik).padStart(10, "0");

    // Get company submissions
    let subs;
    try {
      subs = await fetchJson(`${SEC_BASE}/submissions/CIK${cikPad}.json`);
    } catch (e) {
      return { error: `Failed to load EDGAR submissions: ${e.message}` };
    }

    const recent   = subs.filings?.recent ?? {};
    const forms    = recent.form ?? [];
    const dates    = recent.filingDate ?? [];
    const accns    = recent.accessionNumber ?? [];
    const pdocs    = recent.primaryDocument ?? [];

    // Filter to Form 4
    const form4Idxs = forms.reduce((arr, f, i) => {
      if (f === "4") arr.push(i);
      return arr;
    }, []);

    const total  = form4Idxs.length;
    const toFetch = form4Idxs.slice(0, Math.min(limit, 25));

    // Fetch and parse each Form 4 in parallel (batch of up to 5 at a time)
    const filings = [];
    for (let i = 0; i < toFetch.length; i += 5) {
      const batch = toFetch.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(idx => parseForm4(cik, accns[idx], pdocs[idx]).then(parsed => ({
          filing_date: dates[idx],
          accession:   accns[idx],
          primaryDoc:  pdocs[idx],
          parsed,
        })))
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.parsed) {
          const { filing_date, accession, primaryDoc, parsed } = r.value;
          const accNoDash = accession.replace(/-/g, "");
          const xmlFile = primaryDoc ? primaryDoc.split("/").pop() : "form4.xml";
          const txns = include_derivatives
            ? parsed.transactions
            : parsed.transactions.filter(t => !t.is_derivative);

          filings.push({
            filing_date,
            period_of_report:  parsed.period_of_report,
            insider_name:      parsed.insider_name,
            is_director:       parsed.is_director,
            is_officer:        parsed.is_officer,
            is_ten_pct_owner:  parsed.is_ten_pct_owner,
            officer_title:     parsed.officer_title,
            transactions:      txns,
            form_url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${xmlFile}`,
          });
        }
      }
    }

    return {
      ticker:       sym,
      company_name: entry.title,
      cik:          String(cik),
      filings,
      total_filings_found:  total,
      total_filings_parsed: filings.length,
      source: "SEC EDGAR — Form 4 filings are public domain, delay ~1 business day",
    };
  },
};
