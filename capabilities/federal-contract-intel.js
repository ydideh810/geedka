// federal-contract-intel.js
//
// Federal contract and grant intelligence from USASpending.gov.
// Returns award history, agency breakdown, and total obligated amounts
// for any company or organization that receives US government funding.
//
// Seam: competitive intelligence for gov contractors requires manual
// USASpending.gov queries + spreadsheet aggregation. This collapses
// 3 API calls into one structured response per company lookup.
//
// Free upstream: api.usaspending.gov — no API key, no auth required.
// Covers: $10T+ in tracked federal spending since 2007.

const BASE    = "https://api.usaspending.gov/api/v2";
const UA      = "Mozilla/5.0 (compatible; the-stall/3.87; +https://intuitek.ai)";
const TIMEOUT = 20000;

// Award type codes: A-D = contracts, 02-05 = grants, IDVs = indefinite delivery
const TYPE_CODES = {
  contracts: ["A", "B", "C", "D"],
  grants:    ["02", "03", "04", "05"],
  all:       ["A", "B", "C", "D", "02", "03", "04", "05"],
};

async function usaPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":   UA,
      Accept:         "application/json",
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`USASpending ${path} HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

function fiscalYearStart(yearsBack = 2) {
  const now = new Date();
  const fy  = now.getMonth() >= 9
    ? now.getFullYear() - yearsBack + 1
    : now.getFullYear() - yearsBack;
  return `${fy}-10-01`;
}

function fmtAmount(n) {
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export default {
  name:  "federal-contract-intel",
  price: "$0.008",

  description:
    "US federal contract and grant intelligence for any company via USASpending.gov. Returns total obligated amount, award count, top awards (award ID, amount, agency, description, start date), and agency breakdown — covering $10T+ in federal spending. Useful for procurement research, competitive intelligence, vendor due diligence, and government contractor analysis. No API key required.",

  inputSchema: {
    type: "object",
    properties: {
      company_name: {
        type:        "string",
        description: "Company or organization name (e.g. 'Boeing', 'Lockheed Martin', 'SpaceX', 'Johns Hopkins University').",
      },
      award_type: {
        type:        "string",
        enum:        ["contracts", "grants", "all"],
        description: "Award type to query. 'contracts' = procurement contracts; 'grants' = financial assistance grants; 'all' = both. Default: 'contracts'.",
      },
      years_back: {
        type:        "integer",
        minimum:     1,
        maximum:     10,
        description: "How many fiscal years back to search (1 = current FY only, 2 = 2 most recent FYs). Default: 2.",
      },
      top_n: {
        type:        "integer",
        minimum:     1,
        maximum:     10,
        description: "Number of top awards to return. Default: 5.",
      },
    },
    required:             ["company_name"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      company_name:    { type: "string" },
      search_period:   { type: "object" },
      summary:         { type: "object" },
      top_awards:      { type: "array" },
      agency_breakdown:{ type: "array" },
      generated_at:    { type: "string" },
    },
  },

  async handler(query) {
    const company   = query.company_name.trim();
    const awardType = query.award_type  || "contracts";
    const yearsBack = query.years_back  || 2;
    const topN      = query.top_n       || 5;

    const codes     = TYPE_CODES[awardType];
    const startDate = fiscalYearStart(yearsBack);
    const endDate   = new Date().toISOString().slice(0, 10);

    const filters = {
      recipient_search_text: [company],
      award_type_codes:      codes,
      time_period:           [{ start_date: startDate, end_date: endDate }],
    };

    // ── Parallel fetch: top awards + agency breakdown ────────────────────────
    const [awardsData, agencyData] = await Promise.all([
      usaPost("/search/spending_by_award/", {
        filters,
        fields: ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Start Date", "Description"],
        page:   1,
        limit:  topN,
        sort:   "Award Amount",
        order:  "desc",
      }),
      usaPost("/search/spending_by_category/awarding_agency/", {
        filters,
        category: "awarding_agency",
        limit:    8,
        page:     1,
      }),
    ]);

    // ── Aggregate total + count ──────────────────────────────────────────────
    // The /spending_by_award endpoint doesn't expose grand totals directly.
    // Use /spending_by_category to also get the total from all agency amounts.
    const allAgencies    = agencyData?.results || [];
    const totalAmount    = allAgencies.reduce((sum, a) => sum + (a.amount || 0), 0);
    const awardCount     = awardsData?.page_metadata?.count ?? awardsData?.results?.length ?? 0;

    // ── Format top awards ────────────────────────────────────────────────────
    const topAwards = (awardsData?.results || []).map(a => ({
      award_id:    a["Award ID"]        || null,
      recipient:   a["Recipient Name"]  || null,
      amount:      a["Award Amount"]    || 0,
      amount_fmt:  fmtAmount(a["Award Amount"] || 0),
      agency:      a["Awarding Agency"] || null,
      start_date:  a["Start Date"]      || null,
      description: a["Description"]     ? a["Description"].slice(0, 200) : null,
    }));

    // ── Format agency breakdown ──────────────────────────────────────────────
    const agencyBreakdown = allAgencies.map(a => ({
      agency:     a.name       || null,
      code:       a.code       || null,
      amount:     a.amount     || 0,
      amount_fmt: fmtAmount(a.amount || 0),
    }));

    return {
      company_name:     company,
      award_type:       awardType,
      search_period:    { start: startDate, end: endDate, fiscal_years_back: yearsBack },
      summary: {
        total_obligated:     totalAmount,
        total_obligated_fmt: fmtAmount(totalAmount),
        top_award_count:     topAwards.length,
        agency_count:        agencyBreakdown.length,
        note: totalAmount === 0 && topAwards.length === 0
          ? `No ${awardType} found for '${company}' in this period. Try adjusting company name, award_type, or years_back.`
          : null,
      },
      top_awards:       topAwards,
      agency_breakdown: agencyBreakdown,
      generated_at:     new Date().toISOString(),
    };
  },
};
