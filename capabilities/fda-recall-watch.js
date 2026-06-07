// fda-recall-watch.js
//
// FDA recall and enforcement search across drugs, food/cosmetics, and
// medical devices via OpenFDA enforcement API.
//
// Seam: agents doing company due diligence (company-intel + company-due-diligence)
// or product research (drug-intel + clinical-trials) lack the recall history
// layer. This collapses OpenFDA enforcement lookup + classification mapping +
// record normalization into one structured call across 85,000+ enforcement actions.
//
// Free upstream: api.fda.gov/drug/enforcement, /food/enforcement, /device/enforcement
// No API key required. Covers all FDA enforcement actions since 2007.

const FDA_BASE = "https://api.fda.gov";
const UA       = "Mozilla/5.0 (compatible; the-stall/3.89; +https://intuitek.ai)";
const TIMEOUT  = 15000;

const ENDPOINTS = {
  drugs:   `${FDA_BASE}/drug/enforcement.json`,
  food:    `${FDA_BASE}/food/enforcement.json`,
  devices: `${FDA_BASE}/device/enforcement.json`,
};

// Class I = most serious (may cause serious adverse health consequences or death)
// Class II = moderate (may cause temporary adverse health consequences)
// Class III = minor (unlikely to cause adverse health consequences)
const CLASS_SEVERITY = { "Class I": 3, "Class II": 2, "Class III": 1 };

function fmtDate(raw) {
  if (!raw || raw.length < 8) return raw || null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function truncate(s, n) {
  if (!s) return null;
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

async function queryEndpoint(url, q, limit, classFilter) {
  let search = q ? encodeURIComponent(q) : "";
  if (classFilter && classFilter !== "any") {
    const classParam = encodeURIComponent(`classification:"${classFilter}"`);
    search = search ? `${search}+AND+${classParam}` : classParam;
  }
  const qs = [
    search ? `search=${search}` : null,
    `limit=${limit}`,
    "sort=recall_initiation_date:desc",
  ].filter(Boolean).join("&");

  const res = await fetch(`${url}?${qs}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal:  AbortSignal.timeout(TIMEOUT),
  });

  if (res.status === 404) return { total: 0, results: [] };
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenFDA HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    total:   data.meta?.results?.total ?? 0,
    results: data.results || [],
  };
}

function normalizeRecord(rec, sourceType) {
  const openfda = rec.openfda || {};
  return {
    event_id:           rec.event_id         || null,
    recall_number:      rec.recall_number     || null,
    recalling_firm:     rec.recalling_firm    || null,
    product_type:       rec.product_type      || sourceType,
    product_description: truncate(rec.product_description, 250),
    reason_for_recall:  truncate(rec.reason_for_recall, 350),
    classification:     rec.classification   || null,
    severity:           CLASS_SEVERITY[rec.classification] ?? null,
    status:             rec.status           || null,
    recall_date:        fmtDate(rec.recall_initiation_date),
    termination_date:   fmtDate(rec.termination_date) || null,
    distribution_pattern: truncate(rec.distribution_pattern, 150),
    voluntary_mandated: rec.voluntary_mandated || null,
    // openfda sub-fields when present
    brand_names:        openfda.brand_name    || null,
    generic_names:      openfda.generic_name  || null,
  };
}

export default {
  name:  "fda-recall-watch",
  price: "$0.008",

  description:
    "FDA recall and enforcement search across drugs, food/cosmetics, and medical devices (85,000+ actions). Returns classification (Class I/II/III), recall reason, product description, status, and distribution pattern. Seam cap: fills the product-safety layer missing from drug-intel + company-due-diligence chains. No API key required.",

  inputSchema: {
    type: "object",
    properties: {
      query: {
        type:        "string",
        description: "Search term: company name, product name, ingredient, NDC, or recall reason keyword (e.g. 'Pfizer', 'acetaminophen', 'Listeria', 'pacemaker battery').",
      },
      product_type: {
        type:        "string",
        enum:        ["all", "drugs", "food", "devices"],
        description: "Product category to search. 'all' queries drugs + food + devices in parallel. Default: 'all'.",
      },
      limit: {
        type:        "integer",
        minimum:     1,
        maximum:     10,
        description: "Maximum recalls to return per category (1–10). Default: 5.",
      },
      class_filter: {
        type:        "string",
        enum:        ["any", "Class I", "Class II", "Class III"],
        description: "Filter by recall classification. 'Class I' = most serious. Default: 'any'.",
      },
    },
    required:             ["query"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      query:        { type: "string" },
      product_type: { type: "string" },
      class_filter: { type: "string" },
      totals:       { type: "object",  description: "Total matching records per category." },
      recalls:      { type: "array",   description: "Normalized recall records sorted by date desc, then severity desc." },
      generated_at: { type: "string" },
    },
  },

  async handler(input) {
    const q           = (input.query         || "").trim();
    const productType = input.product_type   || "all";
    const limit       = input.limit          || 5;
    const classFilter = input.class_filter   || "any";

    if (!q) throw new Error("query is required and cannot be empty");

    // Determine which endpoints to hit
    const targets = productType === "all"
      ? Object.entries(ENDPOINTS)
      : [[productType, ENDPOINTS[productType]]];

    // Query in parallel
    const results = await Promise.all(
      targets.map(async ([typeName, url]) => {
        const { total, results: recs } = await queryEndpoint(url, q, limit, classFilter);
        return { typeName, total, recs };
      }),
    );

    // Build totals summary
    const totals = {};
    for (const { typeName, total } of results) totals[typeName] = total;

    // Normalize all records
    const allRecords = results.flatMap(({ typeName, recs }) =>
      recs.map(r => normalizeRecord(r, typeName)),
    );

    // Sort: most recent first, then by severity desc for same-date ties
    allRecords.sort((a, b) => {
      const dateCmp = (b.recall_date || "").localeCompare(a.recall_date || "");
      if (dateCmp !== 0) return dateCmp;
      return (b.severity || 0) - (a.severity || 0);
    });

    // Cap total output
    const recalls = allRecords.slice(0, productType === "all" ? limit * targets.length : limit);

    return {
      query:        q,
      product_type: productType,
      class_filter: classFilter,
      totals,
      recalls,
      generated_at: new Date().toISOString(),
    };
  },
};
