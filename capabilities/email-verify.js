// email-verify.js
//
// Email address validation and quality assessment.
// Checks syntax, disposable domain status, and DNS MX record presence.
// Combines three signals: format + disposable check + mail server existence.
//
// Seam: mailcheck.hugen.tokyo/mailcheck/disposable — 352 sett/wk, 11 payers, $0.0115/call
//
// Upstream: Kickbox disposable API (free) + Cloudflare DoH for MX lookup.

const KICKBOX_URL = "https://open.kickbox.io/v1/disposable/";
const CF_DOH      = "https://cloudflare-dns.com/dns-query";
const TIMEOUT     = 8000;

// Basic RFC-5322 simplified syntax check
function validateSyntax(email) {
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  if (!re.test(email)) return { valid: false, reason: "invalid_format" };

  const parts  = email.split("@");
  const local  = parts[0];
  const domain = parts[1];

  if (local.length > 64)  return { valid: false, reason: "local_part_too_long" };
  if (domain.length > 253) return { valid: false, reason: "domain_too_long" };
  if (local.startsWith(".") || local.endsWith(".")) return { valid: false, reason: "dot_at_boundary" };
  if (local.includes("..")) return { valid: false, reason: "consecutive_dots" };

  return { valid: true, reason: null };
}

async function checkDisposable(email) {
  try {
    const resp = await fetch(`${KICKBOX_URL}${encodeURIComponent(email)}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.disposable === true;
  } catch (_) {
    return null;
  }
}

async function checkMxRecord(domain) {
  try {
    const url = `${CF_DOH}?name=${encodeURIComponent(domain)}&type=MX`;
    const resp = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const answers = (data.Answer || []).filter(a => a.type === 15); // MX = type 15
    return {
      has_mx:      answers.length > 0,
      mx_records:  answers.slice(0, 5).map(a => {
        const parts = a.data.split(" ");
        return { priority: parseInt(parts[0]), host: parts[1] };
      }),
    };
  } catch (_) {
    return null;
  }
}

function scoreQuality(syntax, isDisposable, mx) {
  if (!syntax.valid) return { score: 0, verdict: "INVALID", flags: [syntax.reason] };

  const flags = [];
  let score = 100;

  if (isDisposable === true)    { score -= 60; flags.push("disposable_domain"); }
  if (isDisposable === null)    { score -= 5;  flags.push("disposable_check_unavailable"); }
  if (mx !== null && !mx.has_mx) { score -= 40; flags.push("no_mx_record"); }
  if (mx === null)               { score -= 5;  flags.push("mx_check_unavailable"); }

  const verdict = score >= 80 ? "DELIVERABLE"
                : score >= 50 ? "RISKY"
                : score >= 20 ? "UNDELIVERABLE"
                : "INVALID";

  return { score, verdict, flags };
}

export default {
  name: "email-verify",
  price: "$0.034",

  description:
    "Email address validation and quality scoring. Checks RFC-5322 syntax, detects disposable/throwaway domains (via Kickbox free API), and verifies DNS MX record presence (via Cloudflare DoH). Returns a quality score (0-100) and verdict: DELIVERABLE | RISKY | UNDELIVERABLE | INVALID. Useful for lead qualification, form validation, and filtering bot signups.",

  inputSchema: {
    type: "object",
    properties: {
      email: {
        type: "string",
        description: "Email address to validate (e.g. 'user@example.com').",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      email:        { type: "string" },
      local_part:   { type: "string" },
      domain:       { type: "string" },
      syntax_valid: { type: "boolean" },
      is_disposable:{ type: "boolean",  description: "True if domain is a known disposable/throwaway service." },
      mx_check:     { type: "object",   description: "DNS MX record check results." },
      quality_score:{ type: "integer",  description: "0-100 quality score. 80+ = deliverable." },
      verdict:      { type: "string",   description: "'DELIVERABLE' | 'RISKY' | 'UNDELIVERABLE' | 'INVALID'" },
      flags:        { type: "array",    description: "Quality flags explaining deductions." },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const email = (query.email || "test@example.com").trim().toLowerCase();
    if (email.length > 254) throw new Error("email address too long");

    const syntax = validateSyntax(email);
    const domain = email.includes("@") ? email.split("@")[1] : null;

    if (!syntax.valid || !domain) {
      const quality = scoreQuality(syntax, null, null);
      return {
        email,
        local_part:    email.split("@")[0] || null,
        domain,
        syntax_valid:  false,
        is_disposable: null,
        mx_check:      null,
        quality_score: quality.score,
        verdict:       quality.verdict,
        flags:         quality.flags,
        generated_at:  new Date().toISOString(),
      };
    }

    // Run disposable + MX checks in parallel
    const [isDisposable, mxResult] = await Promise.all([
      checkDisposable(email),
      checkMxRecord(domain),
    ]);

    const quality = scoreQuality(syntax, isDisposable, mxResult);

    return {
      email,
      local_part:    email.split("@")[0],
      domain,
      syntax_valid:  true,
      is_disposable: isDisposable,
      mx_check:      mxResult,
      quality_score: quality.score,
      verdict:       quality.verdict,
      flags:         quality.flags,
      generated_at:  new Date().toISOString(),
    };
  },
};
