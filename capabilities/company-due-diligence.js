// company-due-diligence.js
//
// Structured company intelligence for AI agent due diligence tasks.
// Combines SEC EDGAR (public companies), website analysis, and legitimacy
// signals into a single structured report.
//
// Seam origin: orbisapi.com/proxy/agent-company-intelligence-due-diligence-api
// (7,465 settlements, 17 payers, $0.0052/call — [REDACTED]4, 2026-06-06)
//
// Free upstreams: SEC EDGAR EFTS (no auth, proper UA required), direct fetch.

const UA      = "IntuiTek1/CompanyDueDiligence (kyle@intuitek.ai)";
const TIMEOUT = 12000;
const EDGAR   = "https://efts.sec.gov/LATEST/search-index";
const SUBMISSIONS = "https://data.sec.gov/submissions";

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...opts.headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; the-stall/3.42; +https://intuitek.ai)",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) return null;
  const buf = await r.arrayBuffer();
  return new TextDecoder().decode(buf.slice(0, 300000));
}

function extractMeta(html, property, nameAttr) {
  for (const [attr, val] of [
    ["property", property],
    ["name", nameAttr || property],
  ]) {
    const re = new RegExp(
      `<meta[^>]+${attr}=["']${val}["'][^>]+content=["']([^"']{0,400})["']`,
      "i"
    );
    const m = html.match(re);
    if (m) return m[1].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).trim();
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']{0,400})["'][^>]+${attr}=["']${val}["']`,
      "i"
    );
    const m2 = html.match(re2);
    if (m2) return m2[1].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).trim();
  }
  return null;
}

async function edgarLookup(companyName) {
  const q = encodeURIComponent(companyName);
  const data = await fetchJson(
    `${EDGAR}?q=${q}&forms=10-K,10-Q,S-1,20-F&dateRange=custom&startdt=2022-01-01`
  );
  if (!data) return null;

  const hits = data?.hits?.hits || [];
  if (!hits.length) return null;

  // Find the hit with the most matching name
  const src = hits[0]?._source;
  if (!src) return null;

  const ciks = src.ciks || [];
  if (!ciks.length) return null;

  const cik = ciks[0].replace(/^0+/, "");
  const paddedCik = cik.padStart(10, "0");

  const subm = await fetchJson(
    `${SUBMISSIONS}/CIK${paddedCik}.json`
  );
  if (!subm) return { cik, display_names: src.display_names };

  const filings = subm.filings?.recent;
  const recentFiling = filings
    ? {
        form: filings.form?.[0],
        date: filings.filingDate?.[0],
        description: filings.primaryDocument?.[0],
      }
    : null;

  const tickers = subm.tickers || [];
  const exchanges = subm.exchanges || [];

  return {
    cik,
    entity_name: subm.name,
    tickers: tickers.length ? tickers : null,
    exchanges: exchanges.length ? exchanges : null,
    sic: subm.sic,
    sic_description: subm.sicDescription,
    state_of_incorporation: subm.stateOfIncorporation,
    fiscal_year_end: subm.fiscalYearEnd,
    business_address: subm.addresses?.business
      ? {
          street: subm.addresses.business.street1,
          city: subm.addresses.business.city,
          state: subm.addresses.business.stateOrCountry,
          zip: subm.addresses.business.zipCode,
          phone: subm.addresses.business.phone,
        }
      : null,
    ein: subm.ein || null,
    category: subm.category || null,
    most_recent_filing: recentFiling,
    filing_count: filings?.form?.length || 0,
    website: subm.website || null,
  };
}

function analyzeWebsite(html, url) {
  if (!html) return null;

  const title =
    html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() || null;
  const description = extractMeta(html, "og:description", "description");
  const ogName = extractMeta(html, "og:site_name");

  const emails = new Set();
  const emailRe = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g;
  let m;
  while ((m = emailRe.exec(html)) !== null) {
    const e = m[0].toLowerCase();
    if (
      !e.includes("example.") &&
      !e.includes("@sentry") &&
      !e.includes("@w3.org") &&
      !e.endsWith(".png")
    ) {
      emails.add(e);
      if (emails.size >= 3) break;
    }
  }

  const hasPrivacyPolicy = /privacy.policy|privacy-policy|\/privacy/i.test(html);
  const hasTerms = /terms.of.service|terms-of-service|\/terms/i.test(html);

  const linkedinMatch = html.match(/linkedin\.com\/(?:company|in)\/([a-zA-Z0-9_-]+)/);
  const twitterMatch = html.match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,40})/);
  const githubMatch = html.match(/github\.com\/([a-zA-Z0-9_-]+)/);

  return {
    title,
    description: description?.slice(0, 300) || null,
    site_name: ogName,
    contact_emails: emails.size ? [...emails] : null,
    has_privacy_policy: hasPrivacyPolicy,
    has_terms: hasTerms,
    social_profiles: {
      linkedin: linkedinMatch ? `https://linkedin.com/company/${linkedinMatch[1]}` : null,
      twitter: twitterMatch ? `https://x.com/${twitterMatch[1]}` : null,
      github: githubMatch ? `https://github.com/${githubMatch[1]}` : null,
    },
  };
}

function buildRiskFlags(edgar, website, domain) {
  const flags = [];

  if (!edgar) {
    flags.push("Not found in SEC EDGAR — likely private company or non-US entity");
  }

  if (website) {
    if (!website.has_privacy_policy) {
      flags.push("No privacy policy detected on website");
    }
    if (!website.contact_emails?.length) {
      flags.push("No contact email found on website");
    }
  } else if (domain) {
    flags.push("Website unreachable or returned no content");
  }

  if (edgar?.most_recent_filing?.date) {
    const filingAge =
      (Date.now() - new Date(edgar.most_recent_filing.date).getTime()) /
      86400000;
    if (filingAge > 365) {
      flags.push(
        `Last SEC filing was ${Math.round(filingAge)} days ago — may indicate financial stress or acquisition`
      );
    }
  }

  return flags.length ? flags : null;
}

export default {
  name: "company-due-diligence",
  price: "$0.358",

  description:
    "AI-agent due diligence on any company. Queries SEC EDGAR for public company data (CIK, ticker, SIC, address, filing history) and optionally analyzes the company website for contact details, social profiles, and legitimacy signals. Returns a structured report with risk flags. Accepts company name plus optional domain.",

  inputSchema: {
    type: "object",
    properties: {
      company: {
        type: "string",
        description: "Company name to look up (e.g. 'Coinbase Global', 'Stripe Inc').",
      },
      domain: {
        type: "string",
        description:
          "Optional company website domain or URL (e.g. 'stripe.com'). When provided, adds website-based intelligence to the report.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      company:           { type: "string",  description: "Resolved company name." },
      query:             { type: "string",  description: "Original query." },
      public_company:    { type: "boolean", description: "True if found in SEC EDGAR (US public company)." },
      sec_data:          { type: "object",  description: "SEC EDGAR data — CIK, ticker, SIC, address, filing history. Null for private companies." },
      website_intel:     { type: "object",  description: "Website-derived intelligence. Null if no domain provided or site unreachable." },
      risk_flags:        { type: "array",   description: "List of potential red flags or notable observations." },
      generated_at:      { type: "string",  description: "ISO-8601 timestamp." },
    },
  },

  async handler(query) {
    const companyName = String(query.company || "Apple").trim().slice(0, 200);
    const domain      = query.domain ? String(query.domain).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "") : null;

    const [edgar, websiteHtml] = await Promise.all([
      edgarLookup(companyName),
      domain ? fetchHtml(`https://${domain}`) : Promise.resolve(null),
    ]);

    const website = websiteHtml ? analyzeWebsite(websiteHtml, domain) : null;
    const riskFlags = buildRiskFlags(edgar, website, domain);

    return {
      company:         edgar?.entity_name || companyName,
      query:           companyName,
      public_company:  !!edgar,
      sec_data:        edgar || null,
      website_intel:   website,
      risk_flags:      riskFlags,
      generated_at:    new Date().toISOString(),
    };
  },
};
