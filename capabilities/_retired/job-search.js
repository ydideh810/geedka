// job-search.js
//
// Search remote and hybrid job listings via jobicy.com public API.
// Returns real job postings with title, company, description, salary, and
// apply URL. No auth required upstream.
//
// Seam: stablejobs.dev/api/coresignal/job-search — $1.67/call (6 payers,
// 6 days) using Coresignal enterprise data. We undercut at $1.50 using
// jobicy free API. Limited to remote/hybrid listings; excellent coverage
// for distributed teams and agent-driven talent research.

const BASE_URL = "https://jobicy.com/api/v2/remote-jobs";
const UA       = "Mozilla/5.0 (compatible; myriad/4.16; +https://synaptiic.org)";
const TIMEOUT  = 15_000;


function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export default {
  name:  "job-search",
  price: "$1.500",

  description:
    "Search remote and hybrid job listings by keyword and location. Returns up to 10 postings with title, company, industry, employment type, description summary, apply URL, and posting date. Uses jobicy.com — covers tech, finance, healthcare, marketing, and more. $1.50/call — 10% below closest x402 competitor.",

  inputSchema: {
    type: "object",
    properties: {
      tag: {
        type: "string",
        description:
          "Search keyword — role title, skill, or technology (e.g. 'software engineer', 'react', 'data analyst'). Required.",
        maxLength: 100,
      },
      count: {
        type: "integer",
        description: "Number of results to return (1–10, default 5).",
        minimum: 1,
        maximum: 10,
        default: 5,
      },
      geo: {
        type: "string",
        description:
          "Geographic filter — country name or 'Anywhere' for worldwide (e.g. 'USA', 'UK', 'Canada', 'Anywhere'). Optional.",
        maxLength: 60,
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      jobs: {
        type: "array",
        description: "Matching job listings, newest first.",
        items: {
          type: "object",
          properties: {
            id:          { type: "integer",          description: "Job ID." },
            title:       { type: "string",           description: "Job title." },
            company:     { type: "string",           description: "Company name." },
            industry:    { type: "array",            items: { type: "string" }, description: "Industry categories." },
            type:        { type: "array",            items: { type: "string" }, description: "Employment type(s)." },
                  geo:         { type: "string",           description: "Geographic location or 'Worldwide'." },
            description: { type: "string",           description: "Plain-text job summary (first 500 chars of description)." },
            url:         { type: "string",           description: "Direct apply URL." },
            pub_date:    { type: "string",           description: "ISO 8601 publication date." },
          },
          required: [],
        },
      },
      total_returned: { type: "integer", description: "Number of jobs in this response." },
      filters_applied: { type: "object",  description: "Filters that were sent to the upstream API." },
      ts:              { type: "string",  description: "Response timestamp (ISO 8601)." },
    },
    required: [],
  },

  async handler({ tag = "software+engineer", count = 5, geo }) {
    tag = (tag || "").trim().slice(0, 100);
    if (tag.length < 1) throw new Error("tag must be at least 1 character");

    count = Math.min(10, Math.max(1, Math.floor(count)));

    const params = new URLSearchParams({ count: String(count), tag });
    if (geo) params.set("geo", geo.slice(0, 60));

    const url  = `${BASE_URL}?${params}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA },
      signal:  AbortSignal.timeout(TIMEOUT),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => String(resp.status));
      throw new Error(`jobicy API ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = await resp.json();
    if (!data.success) {
      throw new Error(`jobicy API error: ${data.error || "unknown"}`);
    }

    const jobs = (data.jobs || []).map((j) => {
      const descRaw  = stripHtml(j.jobDescription || j.jobExcerpt || "");
      const descShort = descRaw.slice(0, 500) + (descRaw.length > 500 ? "…" : "");
      return {
        id:          j.id,
        title:       j.jobTitle    || "",
        company:     j.companyName || "",
        industry:    j.jobIndustry || [],
        type:        j.jobType     || [],
        geo:         j.jobGeo      || "Worldwide",
        description: descShort,
        url:         j.url         || "",
        pub_date:    j.pubDate     || "",
      };
    });

    return {
      jobs,
      total_returned:  jobs.length,
      filters_applied: data.appliedFilters || {},
      ts:              new Date().toISOString(),
    };
  },
};
