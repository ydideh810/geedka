// drug-intel.js
//
// Drug safety intelligence from the FDA. Retrieves labeling info (warnings,
// dosage, drug interactions, contraindications), adverse event reports, and
// recall history for any drug by brand or generic name.
//
// Free upstream: openFDA public API (api.fda.gov) — no API key required.
// Rate limit: 240 requests/minute, 1000/day without key (sufficient for per-call use).
//
// Useful for: pharmaceutical due diligence, clinical research agents, drug safety
// verification, patient education workflows, and medical AI applications.

const BASE    = "https://api.fda.gov/drug";
const UA      = "Mozilla/5.0 (compatible; the-stall/3.83; +https://intuitek.ai)";
const TIMEOUT = 12000;

async function fdaGet(endpoint, params) {
  const qs  = new URLSearchParams(params).toString();
  const url = `${BASE}/${endpoint}.json?${qs}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (res.status === 404) return null;          // no results — not an error
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`openFDA ${endpoint} HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchLabel(drug) {
  // Try generic name first, fall back to brand name
  for (const field of ["openfda.generic_name", "openfda.brand_name"]) {
    const data = await fdaGet("label", {
      search: `${field}:"${drug}"`,
      limit:  1,
    });
    if (data?.results?.length) return data.results[0];
  }
  // Broad text search as last resort
  const data = await fdaGet("label", { search: drug, limit: 1 });
  return data?.results?.[0] || null;
}

async function fetchAdverseEvents(drug) {
  // Top reactions by count
  const countData = await fdaGet("event", {
    search: `patient.drug.medicinalproduct:"${drug}"`,
    count:  "patient.reaction.reactionmeddrapt.exact",
    limit:  10,
  });
  // Total report count
  const totalData = await fdaGet("event", {
    search: `patient.drug.medicinalproduct:"${drug}"`,
    limit:  1,
  });
  return { countData, totalData };
}

async function fetchRecalls(drug) {
  return fdaGet("enforcement", {
    search: `product_description:"${drug}"`,
    limit:  5,
  });
}

export default {
  name:  "drug-intel",
  price: "$0.014",

  description:
    "FDA drug intelligence: labeling (warnings, dosage, drug interactions, contraindications, indications), adverse event report summary (top reactions + total count), and recent recall history. Accepts brand or generic name. Data from openFDA — no API key. Useful for pharmaceutical research, clinical AI, drug safety due diligence.",

  inputSchema: {
    type: "object",
    properties: {
      drug_name: {
        type:        "string",
        description: "Drug name — brand or generic (e.g. 'ibuprofen', 'Tylenol', 'metformin', 'Lipitor').",
      },
      query_type: {
        type:        "string",
        enum:        ["label", "adverse_events", "recalls", "all"],
        description: "Which FDA data to retrieve. 'all' returns label + adverse event summary + recent recalls. Default: 'label'.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      drug_name:      { type: "string" },
      label:          { type: "object" },
      adverse_events: { type: "object" },
      recalls:        { type: "object" },
      generated_at:   { type: "string" },
    },
  },

  async handler(query) {
    const drug  = (query.drug_name || "ibuprofen").trim();
    const qtype = query.query_type || "label";
    const out   = { drug_name: drug, generated_at: new Date().toISOString() };

    // ── Label ──────────────────────────────────────────────────────────────
    if (qtype === "label" || qtype === "all") {
      try {
        const r = await fetchLabel(drug);
        if (!r) {
          out.label = { found: false };
        } else {
          out.label = {
            found:                       true,
            brand_name:                  r.openfda?.brand_name?.[0]        || null,
            generic_name:                r.openfda?.generic_name?.[0]      || null,
            manufacturer:                r.openfda?.manufacturer_name?.[0] || null,
            route:                       r.openfda?.route?.[0]             || null,
            substance_name:              r.openfda?.substance_name?.[0]    || null,
            indications_and_usage:       (r.indications_and_usage?.[0]       || "").slice(0, 600) || null,
            warnings:                    (r.warnings?.[0]                    || "").slice(0, 600) || null,
            dosage_and_administration:   (r.dosage_and_administration?.[0]   || "").slice(0, 500) || null,
            drug_interactions:           (r.drug_interactions?.[0]           || "").slice(0, 500) || null,
            contraindications:           (r.contraindications?.[0]           || "").slice(0, 500) || null,
            pregnancy:                   (r.pregnancy?.[0]                   || "").slice(0, 300) || null,
          };
        }
      } catch (e) {
        out.label = { error: e.message };
      }
    }

    // ── Adverse events ─────────────────────────────────────────────────────
    if (qtype === "adverse_events" || qtype === "all") {
      try {
        const { countData, totalData } = await fetchAdverseEvents(drug);
        const topReactions = (countData?.results || []).slice(0, 10).map(r => ({
          reaction: r.term,
          count:    r.count,
        }));
        out.adverse_events = {
          total_reports: totalData?.meta?.results?.total ?? null,
          top_reactions: topReactions,
          data_note:     "Source: FDA FAERS adverse event reporting system.",
        };
      } catch (e) {
        out.adverse_events = { error: e.message };
      }
    }

    // ── Recalls ────────────────────────────────────────────────────────────
    if (qtype === "recalls" || qtype === "all") {
      try {
        const data = await fetchRecalls(drug);
        const items = (data?.results || []).slice(0, 5).map(r => ({
          date:           r.recall_initiation_date  || null,
          product:        (r.product_description    || "").slice(0, 200),
          reason:         (r.reason_for_recall      || "").slice(0, 300),
          classification: r.classification           || null,
          status:         r.status                   || null,
          firm:           r.recalling_firm           || null,
        }));
        out.recalls = { count: items.length, items };
      } catch (e) {
        out.recalls = { error: e.message };
      }
    }

    return out;
  },
};
