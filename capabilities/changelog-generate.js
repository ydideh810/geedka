// changelog-generate.js
//
// Converts a list of commit messages into a formatted keep-a-changelog block.
// Groups conventional commits by type (feat→Added, fix→Fixed, perf→Changed, etc.),
// returns versioned release markdown or structured JSON.
//
// No external API required — pure rule-based transform. No API key cost.
// Price: $0.003/call
//
// Dead seam: orbisapi.com/proxy/changelog-generate-api-531272 (offline 2026-06-09)
// Covers: agents building release pipelines, PR summarizers, changelog automation.

const TYPE_MAP = {
  feat:      "### Added",
  feature:   "### Added",
  add:       "### Added",
  fix:       "### Fixed",
  bugfix:    "### Fixed",
  hotfix:    "### Fixed",
  perf:      "### Changed",
  refactor:  "### Changed",
  change:    "### Changed",
  docs:      "### Changed",
  doc:       "### Changed",
  chore:     "### Changed",
  style:     "### Changed",
  ci:        "### Changed",
  build:     "### Changed",
  test:      "### Changed",
  deps:      "### Changed",
  update:    "### Changed",
  remove:    "### Removed",
  delete:    "### Removed",
  revert:    "### Removed",
  deprecate: "### Deprecated",
  security:  "### Security",
  sec:       "### Security",
  vuln:      "### Security",
};

// Section display order per keep-a-changelog spec
const SECTION_ORDER = [
  "### Added",
  "### Changed (Breaking)",
  "### Fixed",
  "### Changed",
  "### Deprecated",
  "### Removed",
  "### Security",
];

function parseCommit(msg) {
  const trimmed = msg.trim();
  if (!trimmed) return null;

  // conventional commit: type(scope)!: description  OR  type: description
  const m = trimmed.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)/s);
  if (m) {
    const [, type, scope, breaking, desc] = m;
    const key = type.toLowerCase();
    const group = breaking
      ? "### Changed (Breaking)"
      : (TYPE_MAP[key] || "### Changed");
    const scopeStr = scope ? `**${scope}**: ` : "";
    // Capitalize first letter of description
    const cleanDesc = desc.trim().replace(/^(.)/, c => c.toUpperCase());
    return { group, line: `- ${scopeStr}${cleanDesc}` };
  }

  // Non-conventional: put in Changed
  const cleanMsg = trimmed.replace(/^(.)/, c => c.toUpperCase());
  return { group: "### Changed", line: `- ${cleanMsg}` };
}

export default {
  name:  "changelog-generate",
  price: "$0.003",

  description:
    "Converts commit messages to a keep-a-changelog release block. Groups feat/fix/perf/docs/security commits into Added/Fixed/Changed/Security sections. Returns versioned markdown or structured JSON. No API key — pure transform.",

  inputSchema: {
    type: "object",
    properties: {
      commits: {
        type: "array",
        items: { type: "string" },
        description:
          "Array of commit message strings. Supports conventional commits (feat:, fix:, perf:, docs:, chore:, security:, etc.). Maximum 500 entries.",
      },
      version: {
        type: "string",
        description: "Release version label (e.g. '1.4.2' or 'v2.0.0'). Default: 'Unreleased'.",
        default: "Unreleased",
      },
      date: {
        type: "string",
        description:
          "Release date in YYYY-MM-DD format. Default: today (UTC).",
      },
      format: {
        type: "string",
        enum: ["markdown", "json"],
        description:
          "'markdown' returns a keep-a-changelog block string. 'json' returns structured sections object. Default: markdown.",
        default: "markdown",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      version:       { type: "string",  description: "Version label used in the output." },
      date:          { type: "string",  description: "Release date used in the output." },
      changelog:     { type: "string",  description: "Keep-a-changelog formatted block (format=markdown)." },
      sections:      { type: "object",  description: "Structured groups: Added, Fixed, Changed, etc. (format=json)." },
      total_commits: { type: "integer", description: "Total commit messages processed." },
      skipped:       { type: "integer", description: "Empty or invalid messages skipped." },
      ts:            { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const commits = query.commits || [{hash: "abc1234", message: "feat: initial release", author: "dev"}];
    if (!Array.isArray(commits) || commits.length === 0)
      throw new Error("commits array is required and must be non-empty");
    if (commits.length > 500)
      throw new Error("commits exceeds max 500 entries");

    const version = (query.version || "Unreleased").trim();
    const date    = (query.date    || new Date().toISOString().slice(0, 10)).trim();
    const format  = query.format   || "markdown";

    // Validate date shape
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new Error("date must be in YYYY-MM-DD format");

    const sections = {};
    let skipped = 0;

    for (const msg of commits) {
      if (typeof msg !== "string" || !msg.trim()) { skipped++; continue; }
      const parsed = parseCommit(msg);
      if (!parsed) { skipped++; continue; }
      const { group, line } = parsed;
      if (!sections[group]) sections[group] = [];
      sections[group].push(line);
    }

    const total_commits = commits.length - skipped;
    const ts = new Date().toISOString();

    if (format === "json") {
      const structured = {};
      for (const [key, lines] of Object.entries(sections)) {
        structured[key.replace("### ", "")] = lines;
      }
      return { version, date, changelog: null, sections: structured, total_commits, skipped, ts };
    }

    // Build keep-a-changelog markdown block
    const out = [`## [${version}] - ${date}`, ""];
    for (const heading of SECTION_ORDER) {
      if (sections[heading]?.length > 0) {
        out.push(heading);
        out.push(...sections[heading]);
        out.push("");
      }
    }
    // Any sections not in canonical order
    for (const [key, entries] of Object.entries(sections)) {
      if (!SECTION_ORDER.includes(key) && entries.length > 0) {
        out.push(key);
        out.push(...entries);
        out.push("");
      }
    }

    return {
      version,
      date,
      changelog: out.join("\n").trimEnd(),
      sections: null,
      total_commits,
      skipped,
      ts,
    };
  },
};
