// http-headers.js
//
// HTTP response headers inspector and security grader. Fetches the headers
// from any public URL via HEAD (or GET fallback) and evaluates the presence
// of OWASP-recommended security headers: HSTS, CSP, X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
//
// Returns raw headers, security grade (A-F), and per-header findings with
// recommendations. Useful for security agents auditing web applications,
// DevOps agents verifying CDN configuration, or compliance checks.
//
// Free upstream: native Node.js fetch — no auth, no rate limit.

const UA         = "Mozilla/5.0 (compatible; myriad/3.13; +https://synaptiic.org)";
const TIMEOUT_MS = 10000;

// Security header definitions and grading weights
const SECURITY_HEADERS = [
  {
    key:    "strict-transport-security",
    label:  "HSTS",
    weight: 3,
    grade:  (v) => v ? (v.includes("max-age") ? "pass" : "warn") : "fail",
    tip:    "Add HSTS with max-age >= 31536000 and includeSubDomains.",
  },
  {
    key:    "content-security-policy",
    label:  "CSP",
    weight: 3,
    grade:  (v) => v ? (v.includes("default-src") ? "pass" : "warn") : "fail",
    tip:    "Define a Content-Security-Policy with at least default-src.",
  },
  {
    key:    "x-frame-options",
    label:  "X-Frame-Options",
    weight: 2,
    grade:  (v) => v ? "pass" : "fail",
    tip:    "Add X-Frame-Options: DENY or SAMEORIGIN to prevent clickjacking.",
  },
  {
    key:    "x-content-type-options",
    label:  "X-Content-Type-Options",
    weight: 2,
    grade:  (v) => v === "nosniff" ? "pass" : (v ? "warn" : "fail"),
    tip:    "Set X-Content-Type-Options: nosniff.",
  },
  {
    key:    "referrer-policy",
    label:  "Referrer-Policy",
    weight: 1,
    grade:  (v) => v ? "pass" : "fail",
    tip:    "Add Referrer-Policy (e.g. strict-origin-when-cross-origin).",
  },
  {
    key:    "permissions-policy",
    label:  "Permissions-Policy",
    weight: 1,
    grade:  (v) => v ? "pass" : "fail",
    tip:    "Add Permissions-Policy to restrict browser features (camera, geolocation, etc.).",
  },
  {
    key:    "x-xss-protection",
    label:  "X-XSS-Protection",
    weight: 0,
    grade:  (v) => v ? "info" : "info",
    tip:    "Deprecated — CSP is preferred. If present, '1; mode=block' is safest.",
  },
];

// Grade thresholds: max possible weighted score for pass headers
function computeGrade(findings) {
  const max   = SECURITY_HEADERS.filter(h => h.weight > 0).reduce((s, h) => s + h.weight, 0);
  const score = findings
    .filter(f => f.result === "pass")
    .reduce((s, f) => s + (SECURITY_HEADERS.find(h => h.label === f.header)?.weight || 0), 0);
  const pct = score / max;
  if (pct >= 0.85) return { letter: "A", score, max };
  if (pct >= 0.70) return { letter: "B", score, max };
  if (pct >= 0.55) return { letter: "C", score, max };
  if (pct >= 0.40) return { letter: "D", score, max };
  return { letter: "F", score, max };
}

export default {
  name: "http-headers",
  price: "$0.023",

  description:
    "HTTP response headers inspector and security grader. Fetches headers from any public URL and evaluates OWASP-recommended security headers: HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Returns raw headers, per-header security findings, overall grade (A–F), and actionable recommendations. Useful for web app security audits, CDN configuration verification, and compliance checks.",

  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Public HTTP/HTTPS URL to inspect. Redirects are followed.",
      },
      include_all_headers: {
        type: "boolean",
        description: "If true, return all response headers (not just security-relevant ones). Default: false.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      url:            { type: "string" },
      status_code:    { type: "integer" },
      security_grade: { type: "object" },
      findings:       { type: "array" },
      all_headers:    { type: ["object", "null"] },
      server:         { type: ["string", "null"] },
      cdn_detected:   { type: ["string", "null"] },
      ts:             { type: "string" },
    },
  },

  async handler(query) {
    const raw = (query.url || "https://example.com").trim();
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error("invalid URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("only http:// and https:// URLs");

    // Try HEAD first; fall back to GET if 405
    let resp;
    try {
      resp = await fetch(parsed.href, {
        method: "HEAD",
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
    } catch {
      resp = await fetch(parsed.href, {
        method: "GET",
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
    }

    const headers = {};
    resp.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

    // Evaluate each security header
    const findings = SECURITY_HEADERS.map(h => {
      const val    = headers[h.key] || null;
      const result = h.grade(val);
      return {
        header:  h.label,
        present: !!val,
        value:   val,
        result,
        tip:     result !== "pass" ? h.tip : null,
      };
    });

    // CDN detection
    const server = headers["server"] || null;
    const via    = headers["via"] || "";
    const cf     = headers["cf-ray"];
    const cdn = cf ? "Cloudflare"
      : via.includes("fastly") ? "Fastly"
      : via.includes("varnish") ? "Varnish"
      : (server || "").toLowerCase().includes("nginx") ? "nginx"
      : (server || "").toLowerCase().includes("apache") ? "Apache"
      : null;

    const grade = computeGrade(findings);

    return {
      url:            resp.url || parsed.href,
      status_code:    resp.status,
      security_grade: grade,
      findings,
      all_headers:    query.include_all_headers ? headers : null,
      server,
      cdn_detected:   cdn,
      ts:             new Date().toISOString(),
    };
  },
};
