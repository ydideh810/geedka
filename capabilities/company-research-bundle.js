// company-research-bundle.js
//
// Entity-parametric company research in one x402 call.
// Returns stock quote, financial income statements, Wikipedia summary,
// and (optionally) GitHub repo data and website intelligence — the
// 3–5 cap workflow used by production company-research pipeline agents,
// collapsed to a single payment.
//
// Constituent caps (always run):
//   us-stock-price      $0.295  — live stock quote, price change, volume
//   income-statements   $0.295  — quarterly/annual P&L data
//   wikipedia-intel     $0.034  — entity background, summary, categories
//
// Optional (run when input provided, included at no extra cost):
//   github-repo-intel   $0.075  — if github_repo is specified
//   web-company-intel   $0.059  — if website_url is specified
//
// Sum for 3 core caps if called separately: $0.624
// Bundle price: $0.590 (~5.5% discount; 1-call simplification for pipelines)
//
// Seam: observed from payer 0xc4a30220 — 198 calls, 21 Lambda IPs, 2 days,
// calling us-stock-price×56 + github-repo-intel×54 + wikipedia-intel×49 +
// income-statements×34 in systematic per-entity batches. Entity-parametric
// pipeline doing company-research enrichment across a curated entity list.
// Single-payer exception authorized by K¹ 2026-07-10 (cy_hb_3867 option B).

import stockPriceCap    from './us-stock-price.js';
import incomeStmtsCap   from './income-statements.js';
import wikipediaCap     from './wikipedia-intel.js';
import githubCap        from './github-repo-intel.js';
import webCompanyCap    from './web-company-intel.js';

export default {
  name: "company-research-bundle",
  price: "$0.590",

  description:
    "Entity-parametric company research in one call: live stock quote, quarterly income statements, and Wikipedia background. Optionally adds GitHub repo analysis and website intelligence when those inputs are provided. Parallel-safe for enriching lists of companies in distributed agentic pipelines. Replaces 3–5 individual cap calls; entity-parametric (one ticker per call).",

  inputSchema: {
    type: "object",
    properties: {
      ticker: {
        type: "string",
        description: "US stock ticker symbol (e.g. AAPL, MSFT, NVDA). Used for stock quote and income statements.",
      },
      entity_name: {
        type: "string",
        description: "Company or entity name for Wikipedia lookup (e.g. 'Apple Inc'). Falls back to ticker if omitted.",
      },
      github_repo: {
        type: "string",
        description: "GitHub repo in 'owner/repo' format (e.g. 'microsoft/vscode'). If provided, adds GitHub repo intelligence to the result.",
      },
      website_url: {
        type: "string",
        description: "Company website URL (e.g. 'https://stripe.com'). If provided, adds website intelligence to the result.",
      },
      income_period: {
        type: "string",
        enum: ["quarterly", "annual"],
        description: "Period type for income statements. Default: 'quarterly' (up to 4 recent quarters).",
        default: "quarterly",
      },
    },
    required: ["ticker"],
  },

  outputSchema: {
    type: "object",
    properties: {
      ticker:            { type: "string" },
      stock_quote:       { type: "object", description: "Live stock price, change, volume from us-stock-price." },
      income_statements: { type: "object", description: "Quarterly/annual income statement data from income-statements." },
      wikipedia:         { type: "object", description: "Entity background and summary from wikipedia-intel." },
      github:            { type: "object", description: "GitHub repo intelligence from github-repo-intel (present only when github_repo was supplied)." },
      website:           { type: "object", description: "Website intelligence from web-company-intel (present only when website_url was supplied)." },
      errors:            { type: "object", description: "Per-source errors (non-fatal; other fields still populated)." },
      as_of:             { type: "string" },
    },
    required: ["ticker", "as_of"],
  },

  async handler(query) {
    const ticker     = (query.ticker || "").toUpperCase().replace(/[^A-Z0-9.\-^]/g, "");
    const entityName = (query.entity_name || ticker).trim();
    const githubRepo = (query.github_repo || "").trim() || null;
    const websiteUrl = (query.website_url  || "").trim() || null;
    const period     = ["quarterly", "annual"].includes(query.income_period) ? query.income_period : "quarterly";

    if (!ticker) throw new Error("ticker is required");

    const errors = {};

    function extract(settled, key) {
      if (settled.status === "fulfilled") return settled.value;
      errors[key] = settled.reason?.message || String(settled.reason);
      return null;
    }

    const coreJobs = [
      stockPriceCap.handler({ ticker }),
      incomeStmtsCap.handler({ ticker, period, limit: 4 }),
      wikipediaCap.handler({ query: entityName, exact: false, limit: 1 }),
    ];

    const [stockResult, incomeResult, wikiResult] = await Promise.allSettled(coreJobs);

    const result = {
      ticker,
      stock_quote:       extract(stockResult,  "stock_quote"),
      income_statements: extract(incomeResult, "income_statements"),
      wikipedia:         extract(wikiResult,   "wikipedia"),
    };

    const optionalJobs = [];
    if (githubRepo) optionalJobs.push({ key: "github", job: githubCap.handler({ repo: githubRepo }) });
    if (websiteUrl) optionalJobs.push({ key: "website", job: webCompanyCap.handler({ url: websiteUrl }) });

    if (optionalJobs.length) {
      const settled = await Promise.allSettled(optionalJobs.map(o => o.job));
      for (let i = 0; i < optionalJobs.length; i++) {
        result[optionalJobs[i].key] = extract(settled[i], optionalJobs[i].key);
      }
    }

    if (Object.keys(errors).length) result.errors = errors;
    result.as_of = new Date().toISOString();

    return result;
  },
};
