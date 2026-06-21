// treasury-auction-calendar.js
//
// Returns upcoming US Treasury auction schedule from TreasuryDirect.gov.
// Covers Bills (4-week through 52-week), Notes (2-, 3-, 5-, 7-, 10-year),
// Bonds (20-, 30-year), TIPS, and FRNs — all announced auctions.
//
// Source: TreasuryDirect public API — no API key, no auth, official US Treasury data.
// Updated in real time as auctions are announced (typically 1-2 weeks before auction).
//
// Seam: Bloomberg Terminal / MUFG / ICE fixed-income platforms charge $1,500-25,000/yr
// for structured auction calendar feeds. This delivers the same TreasuryDirect data
// on-demand for $0.018/call with filtering by type and date window.

const TD_BASE = "https://www.treasurydirect.gov/TA_WS/securities/announced?format=json";
const UA      = "Aegis/1.0 (the-stall x402; +https://intuitek.ai; kyle@intuitek.ai)";
const TIMEOUT = 10_000;

const TYPE_MAP = {
  bill: "Bill", note: "Note", bond: "Bond",
  tips: "TIPS", frn: "FRN", cmb: "CMB",
};

function dateStr(iso) {
  return iso ? iso.split("T")[0] : "";
}

function parseBillions(val) {
  if (!val || val === "") return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : Math.round(n / 1e9 * 100) / 100;
}

export default {
  name: "treasury-auction-calendar",
  price: "$0.116",

  description:
    "Returns upcoming US Treasury auction schedule (Bills, Notes, Bonds, TIPS, FRNs) from TreasuryDirect.gov. Filter by security type and look-ahead window. Shows auction date, issue date, term, offering amount, coupon rate, and reopening status. Official government data, no API key.",

  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "Security type filter: 'all', 'bill', 'note', 'bond', 'tips', 'frn', 'cmb'. Default: 'all'.",
        default: "all",
      },
      days_ahead: {
        type: "integer",
        description: "How many calendar days ahead to include auctions for (1–365). Default: 30.",
        default: 30,
      },
      limit: {
        type: "integer",
        description: "Max number of auctions to return (default: 20, max: 100).",
        default: 20,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      as_of:      { type: "string", description: "Date this data was fetched (YYYY-MM-DD)." },
      filter:     { type: "string", description: "Applied type filter." },
      days_ahead: { type: "integer", description: "Look-ahead window used." },
      total_found:{ type: "integer", description: "Total auctions matching filter before limit." },
      auctions: {
        type: "array",
        description: "Upcoming auctions sorted by auction date ascending.",
        items: {
          type: "object",
          properties: {
            auction_date:     { type: "string",  description: "Date of auction (YYYY-MM-DD)." },
            issue_date:       { type: "string",  description: "Settlement / issue date (YYYY-MM-DD)." },
            maturity_date:    { type: "string",  description: "Date the security matures (YYYY-MM-DD)." },
            type:             { type: "string",  description: "Security type: Bill, Note, Bond, TIPS, FRN." },
            term:             { type: "string",  description: "Security term (e.g. '10-Year', '26-Week')." },
            cusip:            { type: "string",  description: "CUSIP identifier." },
            offering_amount_b:{ type: ["number","null"], description: "Offering amount in billions USD." },
            coupon_rate:      { type: ["number","null"], description: "Interest/coupon rate (%). Null for discount bills." },
            reopening:        { type: "boolean", description: "True if this is a reopening of an existing security." },
            is_cmb:           { type: "boolean", description: "True if Cash Management Bill." },
            tips:             { type: "boolean", description: "True if inflation-protected (TIPS)." },
            floating_rate:    { type: "boolean", description: "True if floating rate note (FRN)." },
            series:           { type: "string",  description: "Series description (e.g. 'Notes of June 2028')." },
            closing_time_competitive: { type: "string", description: "Bid deadline for competitive tenders." },
          },
        },
      },
    },
  },

  async handler({ type = "all", days_ahead = 30, limit = 20 } = {}) {
    const typeKey  = String(type).toLowerCase().trim();
    const window   = Math.min(Math.max(parseInt(days_ahead, 10) || 30, 1), 365);
    const maxItems = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const r = await fetch(TD_BASE, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) throw new Error(`TreasuryDirect returned HTTP ${r.status}`);
    const raw = await r.json();

    const today    = new Date();
    const cutoff   = new Date(today);
    cutoff.setDate(cutoff.getDate() + window);
    const todayStr   = today.toISOString().split("T")[0];
    const cutoffStr  = cutoff.toISOString().split("T")[0];

    let filtered = raw.filter(a => {
      const aDate = dateStr(a.auctionDate);
      if (!aDate || aDate < todayStr || aDate > cutoffStr) return false;

      if (typeKey === "all") return true;
      if (typeKey === "cmb") return a.cashManagementBillCMB === "Yes";
      if (typeKey === "tips") return a.tips === "Yes";
      if (typeKey === "frn")  return a.floatingRate === "Yes";

      const mapped = TYPE_MAP[typeKey];
      if (!mapped) return true;
      return a.securityType === mapped;
    });

    filtered.sort((a, b) => dateStr(a.auctionDate).localeCompare(dateStr(b.auctionDate)));

    const totalFound = filtered.length;
    const auctions = filtered.slice(0, maxItems).map(a => {
      const couponRaw  = parseFloat(a.interestRate);
      const coupon     = isNaN(couponRaw) || couponRaw === 0 ? null : Math.round(couponRaw * 1000) / 1000;

      return {
        auction_date:              dateStr(a.auctionDate),
        issue_date:                dateStr(a.issueDate),
        maturity_date:             dateStr(a.maturityDate),
        type:                      a.securityType || "",
        term:                      a.securityTerm || "",
        cusip:                     a.cusip || "",
        offering_amount_b:         parseBillions(a.offeringAmount),
        coupon_rate:               coupon,
        reopening:                 a.reopening === "Yes",
        is_cmb:                    a.cashManagementBillCMB === "Yes",
        tips:                      a.tips === "Yes",
        floating_rate:             a.floatingRate === "Yes",
        series:                    a.series || "",
        closing_time_competitive:  a.closingTimeCompetitive || "",
      };
    });

    return {
      as_of:       todayStr,
      filter:      typeKey,
      days_ahead:  window,
      total_found: totalFound,
      auctions,
    };
  },
};
