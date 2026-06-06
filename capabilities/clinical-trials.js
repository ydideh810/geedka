// clinical-trials.js
//
// Search active and completed clinical trials via ClinicalTrials.gov API v2.
// Useful for medical research agents, drug development workflows, patient
// eligibility screening, and competitive intelligence in pharma/biotech.
//
// Seam: orbisapi.com/proxy/clinical-trials-api — 2,150 sett/wk, 8 payers, $0.005/call
//
// Upstream: clinicaltrials.gov/api/v2 — US government free API, no auth required.

const CT_API  = "https://clinicaltrials.gov/api/v2/studies";
const TIMEOUT = 12000;

async function fetchTrials(params) {
  const url = `${CT_API}?${new URLSearchParams(params)}`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`ClinicalTrials.gov HTTP ${resp.status}`);
  return resp.json();
}

function shapeTrial(study) {
  const proto = study.protocolSection || {};
  const id    = proto.identificationModule || {};
  const stat  = proto.statusModule         || {};
  const cond  = proto.conditionsModule     || {};
  const des   = proto.designModule         || {};
  const arms  = proto.armsInterventionsModule || {};
  const eli   = proto.eligibilityModule    || {};
  const cont  = proto.contactsLocationsModule || {};
  const desc  = proto.descriptionModule    || {};

  const locations = (cont.locations || []).slice(0, 5).map(l => ({
    facility: l.facility || null,
    city:     l.city     || null,
    state:    l.state    || null,
    country:  l.country  || null,
    status:   l.status   || null,
  }));

  return {
    nct_id:           id.nctId       || null,
    title:            id.briefTitle  || null,
    official_title:   id.officialTitle || null,
    status:           stat.overallStatus || null,
    start_date:       stat.startDateStruct?.date || null,
    completion_date:  stat.completionDateStruct?.date || null,
    primary_completion_date: stat.primaryCompletionDateStruct?.date || null,
    last_update:      stat.lastUpdatePostDateStruct?.date || null,
    phases:           des.phases || [],
    study_type:       des.studyType || null,
    enrollment:       des.enrollmentInfo?.count || null,
    conditions:       cond.conditions || [],
    interventions:    (arms.interventions || []).map(i => ({
      type: i.type || null,
      name: i.name || null,
    })),
    brief_summary:    desc.briefSummary || null,
    eligibility: {
      criteria:    eli.eligibilityCriteria || null,
      min_age:     eli.minimumAge || null,
      max_age:     eli.maximumAge || null,
      sex:         eli.sex || null,
      healthy_volunteers: eli.healthyVolunteers || null,
    },
    locations,
    url: id.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : null,
  };
}

export default {
  name: "clinical-trials",
  price: "$0.008",

  description:
    "Search active and completed clinical trials from ClinicalTrials.gov. Filter by condition, intervention, keyword, location, or status. Returns trial ID, title, phase, status, enrollment, eligibility criteria, conditions, interventions, and location details. Useful for medical research, drug development workflows, patient eligibility screening, and pharma competitive intelligence.",

  inputSchema: {
    type: "object",
    properties: {
      condition: {
        type: "string",
        description: "Medical condition or disease to search (e.g. 'diabetes', 'lung cancer', 'COVID-19').",
      },
      intervention: {
        type: "string",
        description: "Drug, device, or treatment name (e.g. 'metformin', 'immunotherapy', 'CRISPR').",
      },
      keyword: {
        type: "string",
        description: "General keyword search across all trial fields.",
      },
      location: {
        type: "string",
        description: "Location filter (e.g. 'New York', 'United States', 'Germany').",
      },
      status: {
        type: "string",
        enum: ["RECRUITING", "ACTIVE_NOT_RECRUITING", "COMPLETED", "NOT_YET_RECRUITING", "TERMINATED", "WITHDRAWN"],
        description: "Filter by trial status (default: RECRUITING).",
      },
      limit: {
        type: "integer",
        description: "Max results (default 5, max 20).",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      trials:       { type: "array",   description: "Matched clinical trials." },
      count:        { type: "integer" },
      total_found:  { type: "integer", description: "Total trials matching the query (may exceed count)." },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    if (!query.condition && !query.intervention && !query.keyword) {
      throw new Error("provide at least one of: 'condition', 'intervention', or 'keyword'");
    }

    const limit = Math.min(Math.max(1, parseInt(query.limit, 10) || 5), 20);

    const params = { pageSize: limit, format: "json" };
    if (query.condition)   params["query.cond"]   = query.condition;
    if (query.intervention) params["query.intr"]  = query.intervention;
    if (query.keyword)     params["query.term"]   = query.keyword;
    if (query.location)    params["query.locn"]   = query.location;
    if (query.status)      params["filter.overallStatus"] = query.status;

    const data = await fetchTrials(params);
    const studies = data.studies || [];
    const total   = data.totalCount || studies.length;

    return {
      trials:       studies.map(shapeTrial),
      count:        studies.length,
      total_found:  total,
      generated_at: new Date().toISOString(),
    };
  },
};
