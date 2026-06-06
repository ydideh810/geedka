// ssl-cert.js
//
// TLS/SSL certificate inspector. Connects directly to a host's TLS port and
// reads the presented certificate: validity window, issuer, subject, SANs,
// fingerprints, serial, and days-until-expiry. No external API required.
//
// Useful for agents monitoring certificate expiry, auditing TLS configuration,
// verifying SAN coverage for multi-domain setups, or flagging weak issuers.
//
// Free upstream: native Node.js tls module — direct TLS handshake.

import tls from "node:tls";

const DEFAULT_PORT    = 443;
const CONNECT_TIMEOUT = 8000;

function parseSans(sanString) {
  if (!sanString) return [];
  return sanString.split(",").map(s => s.trim()).filter(Boolean);
}

function daysUntil(dateStr) {
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.round(ms / 86400000);
}

function gradeExpiry(days) {
  if (days < 0)  return "EXPIRED";
  if (days < 14) return "CRITICAL";
  if (days < 30) return "WARNING";
  if (days < 90) return "OK";
  return "HEALTHY";
}

function getCert(host, port, servername) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`TLS connect timeout after ${CONNECT_TIMEOUT}ms`)); }, CONNECT_TIMEOUT);

    const sock = tls.connect(
      { host, port, servername: servername || host, rejectUnauthorized: false },
      () => {
        clearTimeout(timer);
        try {
          const cert = sock.getPeerCertificate(true);
          sock.destroy();
          resolve(cert);
        } catch (e) {
          sock.destroy();
          reject(e);
        }
      }
    );
    sock.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

export default {
  name: "ssl-cert",
  price: "$0.004",

  description:
    "Inspects the TLS/SSL certificate of any HTTPS host. Returns validity window (not-before, not-after, days remaining), issuer (CA name, organization), subject (CN), Subject Alternative Names, SHA-256 fingerprint, serial number, and an expiry status (HEALTHY/OK/WARNING/CRITICAL/EXPIRED). Useful for monitoring certificate expiry, auditing TLS configuration, and verifying SAN coverage.",

  inputSchema: {
    type: "object",
    properties: {
      host: {
        type: "string",
        description: "Hostname or IP address to inspect (e.g. 'github.com', 'api.example.com').",
      },
      port: {
        type: "integer",
        description: "TLS port number (default: 443).",
      },
      servername: {
        type: "string",
        description: "SNI server name override (defaults to 'host'). Useful when connecting to an IP that hosts multiple domains.",
      },
    },
    required: ["host"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      host:           { type: "string" },
      port:           { type: "integer" },
      subject_cn:     { type: ["string", "null"] },
      subject_org:    { type: ["string", "null"] },
      issuer_cn:      { type: ["string", "null"] },
      issuer_org:     { type: ["string", "null"] },
      valid_from:     { type: "string" },
      valid_to:       { type: "string" },
      days_remaining: { type: "integer" },
      expiry_status:  { type: "string",  enum: ["HEALTHY", "OK", "WARNING", "CRITICAL", "EXPIRED"] },
      san_domains:    { type: "array",   items: { type: "string" } },
      serial_number:  { type: ["string", "null"] },
      fingerprint_sha256: { type: ["string", "null"] },
      generated_at:   { type: "string" },
    },
  },

  async handler(query) {
    const host = (query.host || "").trim();
    if (!host) throw new Error("host is required");
    const port       = parseInt(query.port, 10) || DEFAULT_PORT;
    const servername = (query.servername || "").trim() || host;

    const cert = await getCert(host, port, servername);
    if (!cert || !cert.subject) throw new Error("no certificate returned from server");

    const validTo = cert.valid_to;
    const days    = daysUntil(validTo);

    return {
      host,
      port,
      subject_cn:          cert.subject?.CN || null,
      subject_org:         cert.subject?.O  || null,
      issuer_cn:           cert.issuer?.CN  || null,
      issuer_org:          cert.issuer?.O   || null,
      valid_from:          cert.valid_from,
      valid_to:            validTo,
      days_remaining:      days,
      expiry_status:       gradeExpiry(days),
      san_domains:         parseSans(cert.subjectaltname),
      serial_number:       cert.serialNumber || null,
      fingerprint_sha256:  cert.fingerprint256 || null,
      generated_at:        new Date().toISOString(),
    };
  },
};
