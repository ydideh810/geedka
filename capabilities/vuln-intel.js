// vuln-intel.js
//
// CVE and package vulnerability intelligence via NVD (nvd.nist.gov)
// and OSV (osv.dev). No auth or API key required for either upstream.
//
// Two modes:
//   cve_id   — look up a specific CVE: CVSS score/vector, severity,
//              CWEs, affected configs, description, references.
//   package  — list all known OSV vulnerabilities for an OSS package
//              (PyPI, npm, Maven, Go, crates.io, NuGet, RubyGems, etc.)
//
// Useful for: dependency audit pipelines, patch triage agents, third-party
// risk scoring, and coordinated-disclosure drafting workflows.

const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const OSV_BASE = "https://api.osv.dev/v1";
const TIMEOUT  = 20_000;
const UA       = "Mozilla/5.0 (compatible; the-stall/1.0; +https://intuitek.ai)";

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const headers = { "User-Agent": UA, ...(opts.headers || {}) };
    const res = await fetch(url, { ...opts, headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(tid);
  }
}

async function lookupCve(cveId) {
  const data = await fetchJson(`${NVD_BASE}?cveId=${encodeURIComponent(cveId)}`);
  const item = data?.vulnerabilities?.[0]?.cve;
  if (!item) throw new Error(`CVE ${cveId} not found in NVD`);

  const desc = (item.descriptions || []).find(d => d.lang === "en")?.value || "";
  const m31  = item.metrics?.cvssMetricV31?.[0];
  const m30  = item.metrics?.cvssMetricV30?.[0];
  const m    = m31 || m30 || null;

  const cwes = (item.weaknesses || [])
    .flatMap(w => (w.description || []).map(d => d.value))
    .filter(v => v.startsWith("CWE-"));

  const refs = (item.references || []).slice(0, 10).map(r => ({
    url:    r.url,
    source: r.source || null,
  }));

  return {
    cve_id:        item.id,
    description:   desc,
    cvss_score:    m?.cvssData?.baseScore   ?? null,
    cvss_severity: m?.cvssData?.baseSeverity ?? null,
    cvss_vector:   m?.cvssData?.vectorString ?? null,
    cvss_version:  m31 ? "3.1" : m30 ? "3.0" : null,
    cwes,
    published:     item.published,
    last_modified: item.lastModified,
    references:    refs,
    source:        "NVD",
  };
}

async function lookupPackage(pkg, ecosystem) {
  const body = JSON.stringify({ package: { name: pkg, ecosystem } });
  const data = await fetchJson(`${OSV_BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const vulns = (data.vulns || []).slice(0, 20).map(v => ({
    id:          v.id,
    summary:     (v.summary || "").slice(0, 250),
    cvss_score:  v.severity?.[0]?.score ?? null,
    severity:    v.database_specific?.severity ?? null,
    published:   v.published,
    modified:    v.modified,
    affected_ranges: (v.affected || [])
      .flatMap(a => (a.ranges || []).map(r => ({
        type:   r.type,
        events: (r.events || []).slice(0, 4),
      }))).slice(0, 5),
    references: (v.references || []).slice(0, 3).map(r => r.url),
  }));

  return {
    package:         pkg,
    ecosystem,
    total_found:     data.vulns?.length ?? 0,
    vulnerabilities: vulns,
    source:          "OSV",
  };
}

export default {
  name: "vuln-intel",
  price: "$1.50",

  description:
    "CVE and package vulnerability lookup via NVD + OSV (no API key needed). Two modes: (1) cve_id='CVE-2024-12345' returns CVSS score, severity, CWEs, description, and references from NVD; (2) package='requests' + ecosystem='PyPI' returns all known OSV vulnerabilities for that package. Useful for dependency audit pipelines, patch triage agents, and security disclosure drafting.",

  inputSchema: {
    type: "object",
    properties: {
      cve_id: {
        type: "string",
        description: "CVE identifier (e.g. 'CVE-2024-12345'). Use this OR package+ecosystem — not both.",
      },
      package: {
        type: "string",
        description: "OSS package name to query for known vulns (e.g. 'requests', 'lodash', 'log4j'). Requires ecosystem.",
      },
      ecosystem: {
        type: "string",
        description: "Package ecosystem: PyPI, npm, Maven, Go, crates.io, NuGet, RubyGems, Packagist, Hex, Pub. Required with package.",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      mode:   { type: "string", enum: ["cve", "package"] },
      result: { type: "object" },
      as_of:  { type: "string" },
    },
  },

  async handler(query) {
    const cveId    = String(query.cve_id    || "").trim();
    const pkgName  = String(query.package   || "").trim();
    const ecosystem = String(query.ecosystem || "").trim();

    if (!cveId && !pkgName) {
      throw new Error(
        "Provide either cve_id (e.g. CVE-2024-12345) or package + ecosystem (e.g. package=requests, ecosystem=PyPI)"
      );
    }

    if (cveId) {
      if (!/^CVE-\d{4}-\d{4,}$/i.test(cveId)) {
        throw new Error("cve_id must be in CVE-YYYY-NNNNN format (e.g. CVE-2024-12345)");
      }
      const result = await lookupCve(cveId.toUpperCase());
      return { mode: "cve", result, as_of: new Date().toISOString() };
    }

    if (!ecosystem) {
      throw new Error("ecosystem is required when looking up a package (e.g. PyPI, npm, Maven, Go)");
    }
    const result = await lookupPackage(pkgName, ecosystem);
    return { mode: "package", result, as_of: new Date().toISOString() };
  },
};
