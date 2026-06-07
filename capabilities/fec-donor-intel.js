// fec-donor-intel.js
//
// US Federal Election Commission (FEC) campaign finance lookup.
// Search political donations by individual or organization name.
//
// Source: FEC Open Data API (api.open.fec.gov) — free public API, no auth
// required for up to 2,500 requests/day on the public DEMO_KEY.
// Data: all federal campaign contributions reported under the Federal Election
// Campaign Act (FECA). Updated daily from official FEC filings.
//
// Returns: recent contributions sorted by date (descending), committees
// donated to, amounts, employer, election cycle, and aggregate totals.
//
// Use cases: executive due diligence, political affiliation screening,
// opposition research, journalism, ESG screening, campaign finance analysis.
//
// Seam: OpenSecrets API ($100+/mo), FEC premium data feeds — public FEC data
// delivers the same contributions feed for $0.008/call.
//
// [REDACTED]3, 2026-06-07.

const FEC_BASE = "https://api.open.fec.gov/v1";
const API_KEY  = "DEMO_KEY";   // 2,500 req/day — sufficient for x402 volume
const TIMEOUT  = 12_000;
const UA       = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";

async function fecFetch(endpoint, params) {
  const url = new URL(`${FEC_BASE}${endpoint}`);
  url.searchParams.set("api_key", API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const r = await fetch(url.toString(), {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`FEC API HTTP ${r.status} for ${endpoint}`);
  return r.json();
}

function normalizeDonation(item) {
  return {
    date:         item.contribution_receipt_date ?? null,
    amount_usd:   typeof item.contribution_receipt_amount === "number"
                    ? Math.round(item.contribution_receipt_amount * 100) / 100
                    : null,
    committee:    item.committee?.name ?? null,
    committee_id: item.committee?.committee_id ?? null,
    candidate:    item.candidate_name ?? null,
    office:       item.candidate_office_full ?? null,
    party:        item.committee?.party_full ?? null,
    cycle:        item.election_type_full ?? item.cycle ?? null,
    state:        item.contributor_state ?? null,
    employer:     item.contributor_employer ?? null,
    occupation:   item.contributor_occupation ?? null,
    is_individual: item.entity_type === "IND",
    memo:         item.memo_text ?? null,
  };
}

export default {
  name: "fec-donor-intel",
  price: "$0.008",

  description:
    "FEC campaign finance lookup — search all US federal political donations by individual or organization name. Returns recent contributions (sorted newest-first) with committee names, donation amounts, election cycles, employer/occupation, and aggregate totals (total donated, number of contributions, committees supported). Official FEC Open Data, updated daily. Use for executive due diligence, political affiliation screening, ESG analysis, or investigative research.",

  inputSchema: {
    type: "object",
    required: ["name"],
    properties: {
      name: {
        type: "string",
        description:
          "Donor name to search. For individuals use 'LAST, FIRST' format (e.g. 'MUSK, ELON') for best results. Organization names work too (e.g. 'Google LLC').",
      },
      cycle: {
        type: "integer",
        description:
          "Election cycle year to filter (e.g. 2024 for the 2023-2024 cycle). Omit for all cycles.",
      },
      limit: {
        type: "integer",
        description: "Max results to return (1–50, default 20).",
        minimum: 1,
        maximum: 50,
        default: 20,
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      name_searched:     { type: "string" },
      total_results:     { type: "integer" },
      contributions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date:          { type: "string" },
            amount_usd:    { type: "number" },
            committee:     { type: "string" },
            committee_id:  { type: "string" },
            candidate:     { type: "string", nullable: true },
            office:        { type: "string", nullable: true },
            party:         { type: "string", nullable: true },
            cycle:         { type: "string", nullable: true },
            state:         { type: "string", nullable: true },
            employer:      { type: "string", nullable: true },
            occupation:    { type: "string", nullable: true },
            is_individual: { type: "boolean" },
            memo:          { type: "string", nullable: true },
          },
        },
      },
      summary: {
        type: "object",
        properties: {
          total_donated_usd:    { type: "number" },
          contribution_count:   { type: "integer" },
          unique_committees:    { type: "integer" },
          top_committee:        { type: "string", nullable: true },
          date_range: {
            type: "object",
            properties: {
              earliest: { type: "string", nullable: true },
              latest:   { type: "string", nullable: true },
            },
          },
        },
      },
    },
  },

  async handler(query) {
    const name  = String(query.name ?? "").trim();
    if (!name) throw new Error("name is required");

    const limit = Math.min(50, Math.max(1, parseInt(query.limit) || 20));

    const params = {
      contributor_name: name,
      per_page:         limit,
      sort:             "-contribution_receipt_date",
    };
    if (query.cycle) params.two_year_transaction_period = parseInt(query.cycle);

    const data = await fecFetch("/schedules/schedule_a/", params);
    const results = (data.results ?? []).map(normalizeDonation);

    // Compute summary stats
    const totalCount = data.pagination?.count ?? results.length;
    const amounts    = results.map(r => r.amount_usd).filter(v => v != null && v > 0);
    const total      = amounts.reduce((s, v) => s + v, 0);
    const committees = new Set(results.map(r => r.committee).filter(Boolean));

    // Find top committee
    const committeeCounts = {};
    for (const r of results) {
      if (r.committee) committeeCounts[r.committee] = (committeeCounts[r.committee] ?? 0) + 1;
    }
    const topCommittee = Object.entries(committeeCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const dates = results.map(r => r.date).filter(Boolean).sort();

    return {
      name_searched:  name,
      total_results:  totalCount,
      contributions:  results,
      summary: {
        total_donated_usd:  Math.round(total * 100) / 100,
        contribution_count: results.length,
        unique_committees:  committees.size,
        top_committee:      topCommittee,
        date_range: {
          earliest: dates[0] ?? null,
          latest:   dates.at(-1) ?? null,
        },
      },
    };
  },
};
