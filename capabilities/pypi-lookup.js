// pypi-lookup.js
//
// Python package metadata from PyPI JSON API (free, no key).
// Returns version, summary, author, license, dependencies, classifiers,
// download URLs, and latest release date.
//
// Seam origin: scout.hugen.tokyo/scout/pypi observed with 25 organic payers
// ($0.013/call, signal-intel 2026-06-05). Agents use this when evaluating
// Python libraries before including them in toolchains.

const PYPI_URL   = "https://pypi.org/pypi";
const UA         = "Mozilla/5.0 (compatible; the-stall/2.2; +https://intuitek.ai)";
const TIMEOUT_MS = 8000;

export default {
  name:  "pypi-lookup",
  price: "$0.014",

  description:
    "Python package metadata from PyPI. Returns latest version, summary, author, license, Python version requirement, install dependencies, release date, and download URLs. Also supports fetching a specific version. Use before integrating a Python library: check if it's actively maintained, what license it uses, and whether it's compatible with your Python version. Free upstream: PyPI JSON API (no key, no rate limit for normal use).",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      package: {
        type: "string",
        description: "PyPI package name (e.g. 'requests', 'numpy', 'anthropic', 'langchain'). Case-insensitive.",
      },
      version: {
        type: "string",
        description: "Specific version to look up (e.g. '2.31.0'). If omitted, returns the latest stable release.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      name:             { type: "string" },
      version:          { type: "string" },
      summary:          { type: ["string", "null"] },
      author:           { type: ["string", "null"] },
      author_email:     { type: ["string", "null"] },
      license:          { type: ["string", "null"] },
      requires_python:  { type: ["string", "null"], description: "Python version constraint (e.g. '>=3.10')." },
      keywords:         { type: ["string", "null"] },
      home_page:        { type: ["string", "null"] },
      project_url:      { type: ["string", "null"], description: "Primary project URL (GitHub, docs, etc.)." },
      requires_dist:    { type: "array",  description: "Direct dependencies (pip-style specifiers).", items: { type: "string" } },
      classifiers:      { type: "array",  description: "PyPI classifiers (Development Status, License, etc.).", items: { type: "string" } },
      latest_upload:    { type: ["string", "null"], description: "ISO-8601 upload date of this release." },
      all_versions:     { type: "array",  description: "All known release version numbers (latest first).", items: { type: "string" } },
      pypi_url:         { type: "string" },
      ts:               { type: "string" },
    },
  },

  async handler(query) {
    const pkg  = (query.package || "requests").trim().toLowerCase();
    const ver  = (query.version || "").trim();

    const url = ver
      ? `${PYPI_URL}/${encodeURIComponent(pkg)}/${encodeURIComponent(ver)}/json`
      : `${PYPI_URL}/${encodeURIComponent(pkg)}/json`;

    let raw;
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (resp.status === 404) throw new Error(`Package "${pkg}"${ver ? ` version "${ver}"` : ""} not found on PyPI`);
      if (!resp.ok) throw new Error(`PyPI HTTP ${resp.status}`);
      raw = await resp.json();
    } catch (err) {
      if (err.message.includes("not found") || err.message.includes("PyPI HTTP")) throw err;
      throw new Error(`PyPI fetch failed: ${err.message}`);
    }

    const info    = raw.info || {};
    const urls    = raw.urls || [];
    const releases = raw.releases || {};

    // Find latest upload date from release file URLs
    let latestUpload = null;
    if (urls.length > 0) {
      const dates = urls.map((u) => u.upload_time).filter(Boolean).sort().reverse();
      latestUpload = dates[0] || null;
    }

    // Get all versions sorted newest first
    const allVersions = Object.keys(releases).reverse();

    // Pick the best project URL
    const projectUrls = info.project_urls || {};
    const projectUrl  = projectUrls["Source"] || projectUrls["Homepage"] ||
                        projectUrls["Repository"] || info.home_page || null;

    return {
      name:            info.name,
      version:         info.version,
      summary:         info.summary           || null,
      author:          info.author            || info.author_email || null,
      author_email:    info.author_email      || null,
      license:         info.license_expression || info.license || null,
      requires_python: info.requires_python    || null,
      keywords:        info.keywords           || null,
      home_page:       info.home_page          || null,
      project_url:     projectUrl,
      requires_dist:   info.requires_dist      || [],
      classifiers:     info.classifiers        || [],
      latest_upload:   latestUpload,
      all_versions:    allVersions.slice(0, 20), // last 20 versions
      pypi_url: `https://pypi.org/project/${info.name}/`,
      ts: new Date().toISOString(),
    };
  },
};
