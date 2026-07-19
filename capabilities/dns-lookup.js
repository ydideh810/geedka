// dns-lookup.js
//
// DNS record lookup via Cloudflare DNS-over-HTTPS (DoH). Returns A, AAAA,
// MX, TXT, CNAME, NS, SOA, CAA, or ALL record types for any domain.
//
// Useful for agents auditing domain configuration, verifying SPF/DKIM/DMARC
// email security, checking CDN setup, or enriching domain intelligence.
//
// Free upstream: cloudflare-dns.com/dns-query (no auth, no rate limit stated).

const DOH = "https://cloudflare-dns.com/dns-query";
const UA  = "Mozilla/5.0 (compatible; myriad/3.11; +https://synaptiic.org)";

const RECORD_TYPES = ["A", "AAAA", "MX", "TXT", "CNAME", "NS", "SOA", "CAA"];

async function resolve(name, type) {
  const url = `${DOH}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/dns-json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`DoH HTTP ${resp.status} for ${type} ${name}`);
  const d = await resp.json();
  return {
    type,
    status: d.Status,  // 0=NOERROR, 3=NXDOMAIN, etc.
    records: (d.Answer || []).map(r => ({
      name:  r.name,
      type:  r.type,
      ttl:   r.TTL,
      data:  r.data,
    })),
  };
}

// DNS status codes
function statusLabel(code) {
  const map = { 0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 5: "REFUSED" };
  return map[code] || `RCODE_${code}`;
}

// Extract meaningful security signals from TXT records
function extractTxtIntel(records) {
  const spf    = records.find(r => r.data.includes("v=spf1"));
  const dmarc  = records.find(r => r.data.startsWith('"v=DMARC1'));
  const dkim   = records.filter(r => r.data.includes("v=DKIM1")).length > 0;
  const verify = records.filter(r => /google-site|facebook-domain|ms=/.test(r.data)).length;
  return {
    has_spf:    !!spf,
    spf_policy: spf ? (spf.data.match(/\-all|\~all|\?all|\+all/)?.[0] || null) : null,
    has_dmarc:  !!dmarc,
    has_dkim:   dkim,
    verification_records: verify,
  };
}

export default {
  name: "dns-lookup",
  price: "$0.023",

  description:
    "DNS record lookup for any domain via Cloudflare DoH. Supports A, AAAA, MX, TXT, CNAME, NS, SOA, CAA, or ALL record types. TXT lookups include SPF/DMARC/DKIM email security signal extraction. Useful for domain audits, email configuration verification, CDN setup checks, and infrastructure reconnaissance.",

  inputSchema: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "Domain name to look up (e.g. 'github.com', 'mail.google.com').",
      },
      type: {
        type: "string",
        enum: ["A", "AAAA", "MX", "TXT", "CNAME", "NS", "SOA", "CAA", "ALL"],
        description: "DNS record type to query. 'ALL' queries A, MX, TXT, NS, and CNAME in parallel and returns all results. Default: 'A'.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      domain:      { type: "string" },
      records:     { type: "array" },
      txt_intel:   { type: ["object", "null"], description: "SPF/DMARC/DKIM signals (TXT and ALL only)." },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const domain = (query.domain || "github.com").trim().toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(domain)) throw new Error("invalid domain name");

    const recordType = (query.type || "A").toUpperCase();

    let allRecords = [];
    let txtIntel   = null;

    if (recordType === "ALL") {
      const queries = ["A", "AAAA", "MX", "TXT", "CNAME", "NS"];
      const results = await Promise.all(queries.map(t => resolve(domain, t).catch(e => ({ type: t, status: -1, records: [], error: e.message }))));
      for (const r of results) {
        for (const rec of r.records) {
          allRecords.push({ record_type: r.type, ...rec, status: statusLabel(r.status) });
        }
      }
      const txtRecs = results.find(r => r.type === "TXT")?.records || [];
      if (txtRecs.length > 0) txtIntel = extractTxtIntel(txtRecs);
    } else {
      const r = await resolve(domain, recordType);
      allRecords = r.records.map(rec => ({ record_type: recordType, ...rec, status: statusLabel(r.status) }));
      if (recordType === "TXT" && allRecords.length > 0) {
        txtIntel = extractTxtIntel(r.records);
      }
    }

    return {
      domain,
      query_type:   recordType,
      record_count: allRecords.length,
      records:      allRecords,
      txt_intel:    txtIntel,
      generated_at: new Date().toISOString(),
    };
  },
};
