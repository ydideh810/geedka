// clinical-trials.js
//
// Search ClinicalTrials.gov for active and completed clinical studies.
// Source: NLM/NIH ClinicalTrials.gov API v2 — public domain, no API key, global coverage.
// Updated daily from FDA/NIH registrations. Priced at $0.005/call.
//
// Seam: Pharma intelligence platforms (Citeline, IQVIA, Evaluate) charge $5K–$50K/yr.
// ClinicalTrials.gov is the mandatory registration database — same primary source, no markup.

const CT_BASE = "https://clinicaltrials.gov/api/v2/studies";

const STATUS_MAP = {
  recruiting:     "RECRUITING",
  active:         "ACTIVE_NOT_RECRUITING",
  completed:      "COMPLETED",
  not_yet:        "NOT_YET_RECRUITING",
  terminated:     "TERMINATED",
  withdrawn:      "WITHDRAWN",
  enrolling:      "ENROLLING_BY_INVITATION",
  any:            null,
};

export default {
  name: "clinical-trials",
  price: "$0.005",

  description:
    "Search ClinicalTrials.gov for clinical studies by condition, intervention, or keyword. Returns phase, status, enrollment, sponsor, and dates. NIH primary source — no markup. $0.005/call.",

  inputSchema: {
    type: "object",
    properties: {
      condition: {
        type: "string",
        description: "Disease or condition to search (e.g. 'diabetes', 'lung cancer', 'Alzheimer'). Also accepts free-text keywords.",
      },
      intervention: {
        type: "string",
        description: "Drug, device, or intervention name to filter by (optional). E.g. 'metformin', 'CAR-T'.",
      },
      status: {
        type: "string",
        enum: ["recruiting", "active", "completed", "not_yet", "terminated", "withdrawn", "enrolling", "any"],
        description: "Study recruitment status filter. Default: 'recruiting'.",
      },
      phase: {
        type: "string",
        enum: ["PHASE1", "PHASE2", "PHASE3", "PHASE4", "EARLY_PHASE1", "NA"],
        description: "Trial phase filter (optional). Omit to include all phases.",
      },
      sponsor: {
        type: "string",
        description: "Filter by lead sponsor name (partial match). E.g. 'Pfizer', 'NIH'.",
      },
      limit: {
        type: "number",
        description: "Maximum results to return (1-50). Default 10.",
      },
    },
    required: ["condition"],
  },

  outputSchema: {
    type: "object",
    properties: {
      total_found: { type: "integer", description: "Total matching studies in ClinicalTrials.gov (may exceed returned count)." },
      returned:    { type: "integer", description: "Number of studies returned in this response." },
      query:       { type: "object",  description: "Echo of search parameters used." },
      studies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nct_id:          { type: "string",  description: "ClinicalTrials.gov identifier (NCTxxxxxxxx)." },
            title:           { type: "string",  description: "Official study title." },
            status:          { type: "string",  description: "Overall recruitment status." },
            phase:           { type: "string",  description: "Trial phase(s). Null for observational studies." },
            study_type:      { type: "string",  description: "INTERVENTIONAL or OBSERVATIONAL." },
            conditions:      { type: "array", items: { type: "string" }, description: "Conditions/diseases studied." },
            interventions:   { type: "array", items: { type: "string" }, description: "Drugs, devices, or procedures being tested." },
            enrollment:      { type: "integer", description: "Target or actual enrollment count." },
            lead_sponsor:    { type: "string",  description: "Primary sponsor organization." },
            start_date:      { type: "string",  description: "Study start date (YYYY-MM or YYYY-MM-DD)." },
            completion_date: { type: "string",  description: "Primary completion date (YYYY-MM or YYYY-MM-DD)." },
            brief_summary:   { type: "string",  description: "Plain-language study summary (truncated to 500 chars)." },
            url:             { type: "string",  description: "ClinicalTrials.gov study page URL." },
          },
        },
      },
      ts: { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    if (!query.condition?.trim()) throw new Error("condition is required");

    const limit      = Math.max(1, Math.min(50, query.limit ?? 10));
    const statusKey  = (query.status ?? "recruiting").toLowerCase();
    const statusVal  = STATUS_MAP[statusKey] ?? null;

    let term = query.condition.trim();
    if (query.intervention?.trim()) term += " " + query.intervention.trim();
    if (query.sponsor?.trim())      term += " " + query.sponsor.trim();

    const params = new URLSearchParams({
      format:   "json",
      pageSize: String(limit),
      "query.term": term,
    });

    if (statusVal) params.set("filter.overallStatus", statusVal);
    if (query.phase) params.set("filter.phase", query.phase);

    const url = `${CT_BASE}?${params}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "the-stall/0.4 (x402 MCP; +https://intuitek.ai)",
        "Accept":     "application/json",
      },
    });
    if (!resp.ok) throw new Error(`ClinicalTrials.gov API error ${resp.status}: ${await resp.text().catch(() => "")}`);

    const data = await resp.json();
    const studies = (data.studies ?? []).map((s) => {
      const ps   = s.protocolSection ?? {};
      const idM  = ps.identificationModule ?? {};
      const stM  = ps.statusModule ?? {};
      const spM  = ps.sponsorCollaboratorsModule ?? {};
      const dsgM = ps.designModule ?? {};
      const condM= ps.conditionsModule ?? {};
      const armM = ps.armsInterventionsModule ?? {};
      const descM= ps.descriptionModule ?? {};

      const interventions = (armM.interventions ?? []).map((i) => i.name).filter(Boolean);
      const phases = dsgM.phases ?? [];

      const startDate = stM.startDateStruct?.date ?? null;
      const compDate  = stM.primaryCompletionDateStruct?.date ?? stM.completionDateStruct?.date ?? null;

      const summary = (descM.briefSummary ?? "").replace(/\s+/g, " ").trim().slice(0, 500);

      return {
        nct_id:          idM.nctId ?? null,
        title:           idM.briefTitle ?? null,
        status:          stM.overallStatus ?? null,
        phase:           phases.length ? phases.join(", ") : null,
        study_type:      dsgM.studyType ?? null,
        conditions:      condM.conditions ?? [],
        interventions,
        enrollment:      dsgM.enrollmentInfo?.count ?? null,
        lead_sponsor:    spM.leadSponsor?.name ?? null,
        start_date:      startDate,
        completion_date: compDate,
        brief_summary:   summary || null,
        url:             "https://clinicaltrials.gov/study/" + (idM.nctId ?? ""),
      };
    });

    return {
      total_found: data.totalCount ?? studies.length,
      returned:    studies.length,
      query: {
        condition:    query.condition,
        intervention: query.intervention ?? null,
        status:       statusKey,
        phase:        query.phase ?? null,
        sponsor:      query.sponsor ?? null,
      },
      studies,
      ts: new Date().toISOString(),
    };
  },
};
