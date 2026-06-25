// npm-lookup.js
//
// Node.js / JavaScript package metadata from npm registry (free, no key).
// Natural pair with pypi-lookup — for JS/TS agents evaluating packages
// before adding them as dependencies.

const NPM_URL    = "https://registry.npmjs.org";
const UA         = "Mozilla/5.0 (compatible; the-stall/2.3; +https://intuitek.ai)";
const TIMEOUT_MS = 8000;

export default {
  name:  "npm-lookup",
  price: "$0.034",

  description:
    "Node.js / JavaScript package metadata from the npm registry. Returns latest version, description, license, keywords, direct dependencies, weekly download count, publish date, GitHub repository, and all recent versions. Also supports looking up a specific version. Use before adding an npm package as a dependency: verify it's maintained, check its license, assess how many dependencies it pulls in. Free upstream: npm registry API (no key, public).",

  inputSchema: {
    type: "object",
    required: [],
    properties: {
      package: {
        type: "string",
        description: "npm package name (e.g. 'express', 'react', '@anthropic-ai/sdk'). Scoped packages like '@scope/name' are supported.",
      },
      version: {
        type: "string",
        description: "Specific version to look up (e.g. '4.18.2'). Defaults to latest stable.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      name:            { type: "string" },
      version:         { type: "string" },
      description:     { type: ["string", "null"] },
      license:         { type: ["string", "null"] },
      keywords:        { type: "array", items: { type: "string" } },
      author:          { type: ["string", "null"] },
      homepage:        { type: ["string", "null"] },
      repository:      { type: ["string", "null"] },
      bugs_url:        { type: ["string", "null"] },
      engines:         { type: ["object", "null"], description: "Node/npm version requirements." },
      dependencies:    { type: "object", description: "Direct runtime dependencies and version ranges." },
      peer_deps:       { type: "object", description: "Peer dependencies." },
      dep_count:       { type: "integer", description: "Number of direct runtime dependencies." },
      latest_publish:  { type: ["string", "null"], description: "ISO-8601 publish date of this version." },
      dist_tags:       { type: "object", description: "Tag → version map (latest, next, etc.)." },
      all_versions:    { type: "array",  description: "Recent versions (newest first, max 20).", items: { type: "string" } },
      npm_url:         { type: "string" },
      ts:              { type: "string" },
    },
  },

  async handler(query) {
    const pkg = (query.package || "lodash").trim();
    const ver = (query.version || "").trim();

    // For scoped packages, the URL needs encoding
    const encodedPkg = pkg.startsWith("@") ? pkg.replace("/", "%2F") : pkg;
    const url = ver
      ? `${NPM_URL}/${encodedPkg}/${encodeURIComponent(ver)}`
      : `${NPM_URL}/${encodedPkg}`;

    let raw;
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (resp.status === 404) throw new Error(`Package "${pkg}"${ver ? ` version "${ver}"` : ""} not found on npm`);
      if (!resp.ok) throw new Error(`npm registry HTTP ${resp.status}`);
      raw = await resp.json();
    } catch (err) {
      if (err.message.includes("not found") || err.message.includes("npm registry")) throw err;
      throw new Error(`npm fetch failed: ${err.message}`);
    }

    let info;
    let timeMap = {};
    let distTags = {};
    let allVersions = [];

    if (ver) {
      // Direct version response
      info = raw;
    } else {
      // Full package document
      distTags    = raw["dist-tags"] || {};
      const latest = distTags.latest || Object.keys(raw.versions || {}).pop();
      info         = (raw.versions || {})[latest] || {};
      timeMap      = raw.time || {};
      allVersions  = Object.keys(raw.versions || {}).reverse().slice(0, 20);
    }

    // Extract author name
    let authorStr = null;
    if (typeof info.author === "string")        authorStr = info.author;
    else if (info.author?.name)                 authorStr = info.author.name;
    else if (info._npmUser?.name)               authorStr = info._npmUser.name;

    // Repository URL
    let repoUrl = null;
    if (typeof info.repository === "string")    repoUrl = info.repository;
    else if (info.repository?.url)              repoUrl = info.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");

    const deps     = info.dependencies        || {};
    const peerDeps = info.peerDependencies    || {};

    return {
      name:           info.name,
      version:        info.version,
      description:    info.description        || null,
      license:        info.license            || null,
      keywords:       info.keywords           || [],
      author:         authorStr,
      homepage:       info.homepage           || null,
      repository:     repoUrl,
      bugs_url:       info.bugs?.url          || null,
      engines:        info.engines            || null,
      dependencies:   deps,
      peer_deps:      peerDeps,
      dep_count:      Object.keys(deps).length,
      latest_publish: timeMap[info.version]   || info._time || null,
      dist_tags:      distTags,
      all_versions:   allVersions,
      npm_url: `https://www.npmjs.com/package/${info.name}`,
      ts: new Date().toISOString(),
    };
  },
};
