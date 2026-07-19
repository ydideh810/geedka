// domain-whois.js
//
// Domain WHOIS/RDAP lookup — registration dates, registrar, nameservers,
// expiration, and status flags via RDAP (the modern WHOIS replacement).
//
// Seam: domain.hugen.tokyo/domain/whois — 249 sett/wk, 14 payers, $0.0166/call
//
// Upstream: rdap.org (universal RDAP bootstrap) — free, no auth.

const TIMEOUT = 10000;
const UA      = "myriad/3.18 (https://synaptiic.org)";

function extractEntity(entities, role) {
  if (!Array.isArray(entities)) return null;
  const e = entities.find(en => (en.roles || []).includes(role));
  if (!e) return null;

  // Try to extract vCard name/org
  const vcard = e.vcardArray?.[1] || [];
  const name  = vcard.find(v => v[0] === "fn")?.[3] || null;
  const org   = vcard.find(v => v[0] === "org")?.[3] || null;
  const email = vcard.find(v => v[0] === "email")?.[3] || null;
  const tel   = vcard.find(v => v[0] === "tel")?.[3] || null;

  return { name: name || org || null, org: org || null, email, tel };
}

export default {
  name: "domain-whois",
  price: "$0.034",

  description:
    "Domain WHOIS/RDAP lookup. Returns registration date, expiration date, last updated, registrar, nameservers, status flags, and registrant/admin contact info (where available). Uses RDAP — the structured JSON replacement for WHOIS. Useful for domain due diligence, expiry monitoring, and identifying registrar/owner changes.",

  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Domain name to look up (e.g. 'example.com', 'github.io', 'bbc.co.uk'). Strip 'www.' prefix.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      domain:          { type: "string" },
      handle:          { type: "string",  description: "Registrar-assigned domain handle." },
      status:          { type: "array",   description: "EPP status codes." },
      registered:      { type: "string",  description: "Registration date (ISO 8601)." },
      expires:         { type: "string",  description: "Expiration date (ISO 8601)." },
      updated:         { type: "string",  description: "Last modification date (ISO 8601)." },
      registrar:       { type: "object"  },
      nameservers:     { type: "array"   },
      registrant:      { type: "object"  },
      admin:           { type: "object"  },
      tech:            { type: "object"  },
      days_until_expiry: { type: "integer" },
      generated_at:    { type: "string"  },
    },
  },

  async handler(query) {
    let domain = (query.domain || "").trim().toLowerCase();
    if (!domain) domain = "example.com";

    // Strip protocol and path
    domain = domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (!/^[a-z0-9][a-z0-9.-]{0,61}[a-z0-9]\.[a-z]{2,}$/.test(domain)) {
      throw new Error(`'${domain}' doesn't look like a valid domain`);
    }

    const resp = await fetch(`https://rdap.org/domain/${domain}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "follow",
    });

    if (!resp.ok) {
      if (resp.status === 404) throw new Error(`Domain '${domain}' not found in RDAP`);
      throw new Error(`RDAP lookup failed: HTTP ${resp.status}`);
    }

    const data = await resp.json();

    // Parse events
    const events = {};
    for (const ev of data.events || []) {
      events[ev.eventAction] = ev.eventDate;
    }

    // Parse nameservers
    const nameservers = (data.nameservers || []).map(ns => ns.ldhName?.toLowerCase()).filter(Boolean);

    // Extract entities
    const registrar  = extractEntity(data.entities, "registrar");
    const registrant = extractEntity(data.entities, "registrant");
    const admin      = extractEntity(data.entities, "administrative");
    const tech       = extractEntity(data.entities, "technical");

    // Days until expiry
    let daysUntilExpiry = null;
    if (events.expiration) {
      const expDate = new Date(events.expiration);
      const now     = new Date();
      daysUntilExpiry = Math.ceil((expDate - now) / (1000 * 60 * 60 * 24));
    }

    return {
      domain,
      handle:            data.handle || null,
      status:            data.status || [],
      registered:        events.registration || null,
      expires:           events.expiration   || null,
      updated:           events["last changed"] || null,
      registrar,
      nameservers,
      registrant,
      admin,
      tech,
      days_until_expiry: daysUntilExpiry,
      generated_at:      new Date().toISOString(),
    };
  },
};
