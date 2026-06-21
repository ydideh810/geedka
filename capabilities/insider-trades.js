// insider-trades.js
//
// Recent SEC Form 4 insider trading activity for any US public company.
// Reports who bought or sold, how many shares, at what price, and their role
// (director, officer, 10%+ owner). Sourced entirely from SEC EDGAR public APIs
// — no API key, no authentication, no upstream cost.
//
// Seam: agents running us-stock-price, dividend-intel, or strategy-signal
// need insider data to complete investment analysis. No x402 competitor covers
// this; the SEC EDGAR public API is authoritative and free.
//
// Upstreams:
//   - https://www.sec.gov/files/company_tickers.json (ticker→CIK map)
//   - https://data.sec.gov/submissions/CIK{cik}.json (filing index)
//   - https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/form4.xml (filing XML)

const UA           = "the-stall/3.64 insider-trades (kyle@intuitek.ai)";
const TICKER_MAP   = "https://www.sec.gov/files/company_tickers.json";
const SUBS_BASE    = "https://data.sec.gov/submissions/CIK";
const EDGAR_BASE   = "https://www.sec.gov/Archives/edgar/data";
const TIMEOUT_MS   = 12_000;
const MAX_FILINGS  = 10;

// Cached ticker→CIK map (lives for the process lifetime — warm across calls)
let _tickerCache = null;
let _cacheTs = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

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

function parseXmlValue(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>\\s*([^<]+)\\s*<\\/${tag}>`));
  return m ? m[1].trim() : null;
}

function parseTransactions(xml) {
  const transactions = [];
  // Non-derivative transactions (actual stock buys/sells)
  const ndRe = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g;
  let m;
  while ((m = ndRe.exec(xml)) !== null) {
    const block = m[1];
    const code  = parseXmlValue(block, "transactionCode");
    const date  = parseXmlValue(block, "transactionDate") ||
                  block.match(/<transactionDate[^>]*>[\s\S]*?<value>(.*?)<\/value>/)?.[1];
    const shares = parseXmlValue(block, "transactionShares") ||
                   block.match(/<transactionShares[^>]*>[\s\S]*?<value>(.*?)<\/value>/)?.[1];
    const price  = parseXmlValue(block, "transactionPricePerShare") ||
                   block.match(/<transactionPricePerShare[^>]*>[\s\S]*?<value>(.*?)<\/value>/)?.[1];
    const security = parseXmlValue(block, "securityTitle") ||
                     block.match(/<securityTitle[^>]*>[\s\S]*?<value>(.*?)<\/value>/)?.[1];
    const sharesOwned = block.match(/<sharesOwnedFollowingTransaction[^>]*>[\s\S]*?<value>(.*?)<\/value>/)?.[1];
    if (!code || !date) continue;
    const sharesNum = parseFloat(shares) || 0;
    const priceNum  = parseFloat(price)  || 0;
    transactions.push({
      type:           code === "P" ? "Buy" : code === "S" ? "Sell" :
                      code === "A" ? "Award" : code === "M" ? "Option Exercise" :
                      code === "F" ? "Tax Withholding" : code,
      code,
      security:       security || "Common Stock",
      date,
      shares:         sharesNum,
      price_per_share: priceNum,
      total_value:    priceNum > 0 ? Math.round(sharesNum * priceNum * 100) / 100 : null,
      shares_owned_after: sharesOwned ? parseFloat(sharesOwned) : null,
    });
  }
  return transactions;
}

function ownerRelationship(xml) {
  const isDirector = /<isDirector>true<\/isDirector>/i.test(xml);
  const isOfficer  = /<isOfficer>true<\/isOfficer>/i.test(xml);
  const isTenPct   = /<isTenPercentOwner>true<\/isTenPercentOwner>/i.test(xml);
  // officerTitle block: <officerTitle><value>CFO</value></officerTitle>
  const titleM = xml.match(/<officerTitle>\s*<value>(.*?)<\/value>\s*<\/officerTitle>/);
  const title  = titleM ? titleM[1].trim() : null;
  const roles = [];
  if (isDirector) roles.push("Director");
  if (isOfficer)  roles.push(title || "Officer");
  if (isTenPct)   roles.push("10%+ Owner");
  return roles.join(", ") || "Insider";
}

export default {
  name:  "insider-trades",
  price: "$0.097",

  description:
    "Recent SEC Form 4 insider trading activity for any US public company. Returns who bought or sold (director, officer, 10%+ owner), transaction date, shares, price per share, total value, and position after trade. Sourced from SEC EDGAR public API — authoritative, free, no API key. Use for investment analysis, governance checks, or flagging unusual insider selling before an event.",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US stock ticker (e.g. AAPL, NVDA, MSFT). Case-insensitive.",
      },
      days: {
        type: "integer",
        description: "Lookback window in days (default 30, max 180).",
        default: 30,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:          { type: "string" },
      company:         { type: "string" },
      cik:             { type: "integer" },
      days:            { type: "integer" },
      filings_found:   { type: "integer" },
      filings_parsed:  { type: "integer" },
      summary: {
        type: "object",
        properties: {
          total_buy_shares:  { type: ["integer", "null"] },
          total_buy_value:   { type: ["number", "null"] },
          total_sell_shares: { type: ["integer", "null"] },
          total_sell_value:  { type: ["number", "null"] },
          net_sentiment:     { type: "string", enum: ["net_buying", "net_selling", "neutral", "none"] },
        },
      },
      filings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            owner:        { type: "string" },
            role:         { type: "string" },
            filing_date:  { type: "string" },
            period:       { type: "string" },
            transactions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type:             { type: "string" },
                  code:             { type: "string" },
                  security:         { type: "string" },
                  date:             { type: "string" },
                  shares:           { type: "number" },
                  price_per_share:  { type: "number" },
                  total_value:      { type: ["number", "null"] },
                  shares_owned_after: { type: ["number", "null"] },
                },
              },
            },
          },
        },
      },
      message: { type: "string", description: "Present only when no filings were found." },
      error:   { type: "string", description: "Present only on error (e.g. unknown ticker)." },
    },
    required: [],
  },

  async handler({ ticker = "AAPL", days = 30 }) {
    ticker = ticker.toUpperCase().trim();
    days   = Math.min(Math.max(parseInt(days) || 30, 1), 180);

    // 1. Resolve ticker → CIK
    const tickerMap = await getTickerMap();
    const cik = tickerMap[ticker];
    if (!cik) return { error: `Ticker '${ticker}' not found in SEC EDGAR` };

    // 2. Fetch filing index
    const subsUrl = `${SUBS_BASE}${cik}.json`;
    const subsR   = await fetch(subsUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!subsR.ok) throw new Error(`EDGAR submissions fetch failed: ${subsR.status}`);
    const subs     = await subsR.json();
    const company  = subs.name || ticker;
    const recent   = subs.filings?.recent || {};
    const forms     = recent.form || [];
    const dates     = recent.filingDate || [];
    const accNums   = recent.accessionNumber || [];

    // 3. Filter Form 4 within lookback window
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const primaryDocs = recent.primaryDocument || [];
    const selected = [];
    for (let i = 0; i < forms.length && selected.length < MAX_FILINGS; i++) {
      if (forms[i] === "4" && dates[i] >= cutoff) {
        // primaryDocument may be "xslF345X06/wk-form4_XXX.xml" — strip path prefix
        const rawPd = primaryDocs[i] || "";
        const pd    = rawPd.includes("/") ? rawPd.split("/").pop() : rawPd;
        selected.push({ date: dates[i], acc: accNums[i].replace(/-/g, ""), primaryDoc: pd });
      }
    }

    if (selected.length === 0) {
      return {
        ticker,
        company,
        cik: parseInt(cik),
        days,
        filings_found: 0,
        filings_parsed: 0,
        summary: { total_buy_shares: null, total_buy_value: null, total_sell_shares: null, total_sell_value: null, net_sentiment: "none" },
        filings: [],
        message: `No Form 4 insider trading filings found for ${ticker} in the last ${days} days.`,
      };
    }

    // 4. Fetch and parse each Form 4 XML
    const insiderData = [];
    const cikInt = parseInt(cik);

    await Promise.allSettled(selected.map(async ({ date, acc, primaryDoc }) => {
      try {
        // Build candidate URLs: primaryDoc filename first, then fallback form4.xml
        const candidates = [];
        if (primaryDoc && primaryDoc.endsWith(".xml")) candidates.push(`${EDGAR_BASE}/${cikInt}/${acc}/${primaryDoc}`);
        candidates.push(`${EDGAR_BASE}/${cikInt}/${acc}/form4.xml`);

        let xml = null;
        for (const xmlUrl of candidates) {
          const xr = await fetch(xmlUrl, {
            headers: { "User-Agent": UA },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (xr.ok) { xml = await xr.text(); break; }
        }
        if (!xml) return;

        const ownerName = xml.match(/<rptOwnerName>(.*?)<\/rptOwnerName>/)?.[1]?.trim() || "Unknown";
        const role      = ownerRelationship(xml);
        const period    = xml.match(/<periodOfReport>(.*?)<\/periodOfReport>/)?.[1]?.trim() || date;
        const txns      = parseTransactions(xml);

        if (txns.length > 0) {
          insiderData.push({ owner: ownerName, role, filing_date: date, period, transactions: txns });
        }
      } catch (_) {}
    }));

    // Sort by filing date descending
    insiderData.sort((a, b) => b.filing_date.localeCompare(a.filing_date));

    // Summary: aggregate buys/sells
    let totalBuyShares = 0, totalSellShares = 0, totalBuyValue = 0, totalSellValue = 0;
    for (const filing of insiderData) {
      for (const tx of filing.transactions) {
        if (tx.type === "Buy") {
          totalBuyShares  += tx.shares;
          totalBuyValue   += tx.total_value || 0;
        } else if (tx.type === "Sell") {
          totalSellShares += tx.shares;
          totalSellValue  += tx.total_value || 0;
        }
      }
    }

    return {
      ticker,
      company,
      cik: cikInt,
      days,
      filings_found: selected.length,
      filings_parsed: insiderData.length,
      summary: {
        total_buy_shares:   totalBuyShares  || null,
        total_buy_value:    totalBuyValue   ? Math.round(totalBuyValue)   : null,
        total_sell_shares:  totalSellShares || null,
        total_sell_value:   totalSellValue  ? Math.round(totalSellValue)  : null,
        net_sentiment:      totalBuyValue > totalSellValue ? "net_buying" :
                            totalSellValue > totalBuyValue ? "net_selling" : "neutral",
      },
      filings: insiderData,
    };
  },
};
