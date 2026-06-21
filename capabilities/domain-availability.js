// domain-availability.js
//
// Check if a domain name is available for registration across multiple TLDs.
// Uses RDAP (Registration Data Access Protocol) — the authoritative, free,
// no-key replacement for WHOIS. Returns per-TLD availability in one call.
//
// Seam: orbisapi.com/proxy/domain-availability-checker-api-8bccfb/check
//       323 calls/day, $0.005/call — STALL priced at $0.008/call.
//       Agents doing brand research, startup naming, or domain portfolio work
//       currently route through orbisapi. STALL collapses to one cheaper hop.
//
// Upstream: rdap.org (universal RDAP bootstrap, free, no auth, Cloudflare-cached)
//           TLD-specific: Verisign (.com/.net), IANA, and registry-hosted RDAP servers.
// Zero operating cost: pure RDAP lookups. No third-party API. No key needed.

const RDAP_BOOTSTRAP = "https://rdap.org/domain/";
const UA             = "the-stall/4.51 (+https://intuitek.ai)";
const TIMEOUT_MS     = 10_000;

// Most-requested TLDs for startup/brand availability checks
const DEFAULT_TLDS = ["com", "net", "org", "io", "ai", "co", "app", "dev"];

async function checkTld(name, tld) {
  const domain = `${name}.${tld}`;
  try {
    const resp = await fetch(`${RDAP_BOOTSTRAP}${domain}`, {
      headers: { "User-Agent": UA, Accept: "application/rdap+json,application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (resp.status === 404) return { tld, domain, available: true, status: "available" };
    if (!resp.ok) return { tld, domain, available: null, status: `rdap_error_${resp.status}` };
    const data = await resp.json();
    const statuses = data.status || [];
    return {
      tld,
      domain,
      available: false,
      status: "registered",
      registrar: data.entities?.find(e => (e.roles||[]).includes("registrar"))
        ?.vcardArray?.[1]?.find(v => v[0] === "fn")?.[3] || null,
      expiry: data.events?.find(e => e.eventAction === "expiration")?.eventDate || null,
      rdap_status: statuses.slice(0, 3),
    };
  } catch (err) {
    return { tld, domain, available: null, status: "timeout_or_error", error: err.message };
  }
}

export default {
  name:  "domain-availability",
  price: "$0.014",

  description:
    "Check domain name availability across multiple TLDs (com, net, org, io, ai, co, app, dev by default). Returns per-TLD availability status, registrar, and expiry for registered domains. Uses RDAP — authoritative registry data, no API key. Ideal for brand research, startup naming, and domain portfolio work.",

  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Base domain name to check, without TLD (e.g. 'acme', 'my-startup'). Can also be a full domain like 'acme.com' — the TLD will be stripped and checked alongside others unless tlds is set.",
      },
      tlds: {
        type: "array",
        items: { type: "string" },
        description: "List of TLDs to check (without dot). Defaults to: com, net, org, io, ai, co, app, dev. Max 10.",
        maxItems: 10,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      base_name:        { type: "string" },
      available_count:  { type: "number" },
      registered_count: { type: "number" },
      available:        { type: "array", items: { type: "string" } },
      registered:       { type: "array", items: { type: "string" } },
      details:          { type: "array", items: { type: "object" } },
      errors:           { type: "array", items: { type: "string" } },
      checked_at:       { type: "string" },
    },
  },

  async handler({ name = "example", tlds }) {

    // Strip TLD if caller passed a full domain
    let baseName = name.trim().toLowerCase().replace(/^https?:\/\//, "");
    if (baseName.includes(".")) {
      baseName = baseName.split(".").slice(0, -1).join(".");
    }
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(baseName)) {
      throw new Error("Invalid domain name: must be alphanumeric with hyphens, no leading/trailing hyphens");
    }

    const targetTlds = (tlds || DEFAULT_TLDS).slice(0, 10).map(t =>
      t.trim().toLowerCase().replace(/^\./, "")
    );

    // Check all TLDs in parallel
    const results = await Promise.all(targetTlds.map(tld => checkTld(baseName, tld)));

    const available = results.filter(r => r.available === true).map(r => r.domain);
    const registered = results.filter(r => r.available === false).map(r => r.domain);
    const errors = results.filter(r => r.available === null);

    return {
      base_name: baseName,
      available_count: available.length,
      registered_count: registered.length,
      available,
      registered,
      details: results,
      errors: errors.length > 0 ? errors.map(e => `${e.domain}: ${e.status}`) : undefined,
      checked_at: new Date().toISOString(),
    };
  },
};
