#!/usr/bin/env node
// scripts/handoff_strong_signals.mjs
//
// Runs after each scout cycle (wired as ExecStartPost on the systemd service).
// Queries archive.db for signals at strength >= STRENGTH_THRESHOLD emitted in
// the last RECENT_MINUTES, dedupes against the handoffs table (UTC-day unique
// per pattern+subject), and drops a capability-spec markdown draft into
// ~/intuitek/outputs/for_claude_web/ for cross-surface review.
//
// The draft auto-fills the data fields (signal_id, evidence, hook type
// derived from pattern) and explicitly marks judgment fields TBD — Kyle
// writes the function statement, price, and ToS note.

import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const DB_PATH            = process.env.[REDACTED] || join(REPO_ROOT, "archive.db");
const HANDOFF_DIR        = process.env.HANDOFF_DIR || join(homedir(), "intuitek", "outputs", "for_claude_web");
const STRENGTH_THRESHOLD = parseFloat(process.env.HANDOFF_STRENGTH || "0.70");
const RECENT_MINUTES     = parseInt(process.env.HANDOFF_WINDOW_MIN || "12", 10);

const CAPS_DIR = join(REPO_ROOT, "capabilities");

// Build a set of hostnames already covered by seam comments in existing caps.
// Cap files annotate: // Seam: https://host/path — skip re-signaling covered hosts.
function buildCoveredDomains() {
  const covered = new Set();
  try {
    const files = readdirSync(CAPS_DIR).filter(f => f.endsWith(".js"));
    for (const f of files) {
      const content = readFileSync(join(CAPS_DIR, f), "utf8");
      for (const m of content.matchAll(/\/\/\s+[Ss]eam:\s+(https?:\/\/[^\s,]+)/g)) {
        try { covered.add(new URL(m[1]).hostname.replace(/^www\./, "")); } catch {}
      }
    }
  } catch {}
  return covered;
}

function subjectDomain(subject) {
  const firstPart = subject.split("|")[0].split("→")[0].trim();
  try { return new URL(firstPart).hostname.replace(/^www\./, ""); } catch { return null; }
}

const HOOK_BY_PATTERN = {
  seam:          "seam",
  convergence:   "funnel-narrow",
  concentration: "hedge",
  growth:        "growth-adjacent",
};

function urlSafe(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function shortSubject(s) {
  // For URLs, keep host + last path segment. For 0x addresses, keep last 8.
  if (/^0x[a-f0-9]{40}/i.test(s)) return s.slice(0, 6) + s.slice(-4);
  try {
    const u = new URL(s.split("|")[0]);
    return u.host.replace(/^www\./, "");
  } catch { return urlSafe(s).slice(0, 40); }
}

function renderSpec({ signal, hookType, ev }) {
  const date    = new Date().toISOString().slice(0, 10);
  const pctStr  = (signal.strength * 100).toFixed(0) + "%";
  const subject = signal.subject;
  const name    = urlSafe(shortSubject(subject)) || "unnamed-candidate";

  // pattern-specific evidence lines
  let evidenceLines = `  - source: stream(s) underlying archive.db at ${new Date().toISOString()}`;
  if (signal.pattern === "concentration") {
    if (ev.n_settlements != null) {
      evidenceLines += `\n  - ${ev.n_settlements} settlements from ${ev.unique_payers} distinct wallets`;
      evidenceLines += ` (${ev.calls_per_payer} calls/payer)`;
    }
    if (ev.pay_to) evidenceLines += `\n  - recipient address: ${ev.pay_to}`;
    if (ev.resource) evidenceLines += `\n  - bazaar-known resource: ${ev.resource}`;
    if (ev.dominant_cluster) {
      evidenceLines += `\n  - dominant cluster: ${ev.dominant_cluster}`;
      if (ev.share) evidenceLines += ` (${(ev.share * 100).toFixed(0)}% of traffic)`;
    }
  } else if (signal.pattern === "seam") {
    if (ev.chain) evidenceLines += `\n  - chain: ${ev.chain}`;
    if (ev.distinct_wallets) evidenceLines += `\n  - ${ev.distinct_wallets} distinct wallets running this chain`;
  } else if (signal.pattern === "convergence") {
    if (ev.resource) evidenceLines += `\n  - resource: ${ev.resource}`;
    if (ev.description) evidenceLines += `\n  - description: ${ev.description}`;
    if (ev.late_mean_calls) evidenceLines += `\n  - late-window mean calls: ${ev.late_mean_calls.toFixed(1)}`;
    if (ev.early_cv && ev.late_cv) evidenceLines += `\n  - variance narrowed: cv ${ev.early_cv.toFixed(2)} → ${ev.late_cv.toFixed(2)}`;
  } else if (signal.pattern === "growth") {
    if (ev.category) evidenceLines += `\n  - category: ${ev.category}`;
    if (ev.recent_slope_per_day) evidenceLines += `\n  - emergence rate: +${ev.recent_slope_per_day.toFixed(1)} endpoints/day`;
    if (ev.resource) evidenceLines += `\n  - resource: ${ev.resource}`;
    if (ev.mean_d2) evidenceLines += `\n  - second derivative: ${ev.mean_d2.toFixed(1)} (hockey-stick)`;
  }

  const autoHint = ev.hint ? `> ${ev.hint}\n\n` : "";

  return `# CAPABILITY SPEC · ${date}

${autoHint}\`\`\`
name:           ${name}
edge:           structure × labor × attention   (reject if info/speed)
hook type:      ${hookType}
signal source:  signal_id ${signal.signal_id} from ${signal.pattern}, strength ${pctStr}
asset drawn:    TBD — select from PROSPECTOR.md §8 held-asset register
seat evidence:
${evidenceLines}
function:       TBD — one sentence an agent reads to decide to pay
input → output: TBD — JSON schema sketch
price hypothesis: TBD — \$<x>  (rationale: undercut by N% | rent-at-seam | hedge premium)
legal/ToS note: TBD — clean | bounded by: ...
STOP RULE:      retire if < 5 settled calls in 72 hours; do not iterate a dead seat
\`\`\`

## Raw evidence

\`\`\`json
${JSON.stringify(ev, null, 2)}
\`\`\`

## Subject

\`\`\`
${subject}
\`\`\`

---

*Auto-generated by \`scripts/handoff_strong_signals.mjs\` from PROSPECTOR
signal_id ${signal.signal_id}. Review in cross-surface (Kyle / Aegis / Surface 1).
Fill the TBD fields before shipping to the Stall.*
`;
}

// ── main ─────────────────────────────────────────────────────────────────────
if (!existsSync(DB_PATH)) {
  console.error(`handoff: archive db not found at ${DB_PATH} — scout has not run yet`);
  process.exit(0);
}

mkdirSync(HANDOFF_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Ensure handoffs table exists (idempotent, schema.sql also creates it but
// be safe in case this script runs against an older archive)
db.exec(`
  CREATE TABLE IF NOT EXISTS handoffs (
    handoff_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id   INTEGER NOT NULL,
    pattern     TEXT NOT NULL,
    subject     TEXT NOT NULL,
    strength    REAL,
    ts          TEXT NOT NULL,
    filename    TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_handoffs_unique_daily
    ON handoffs(pattern, subject, substr(ts, 1, 10));
`);

const strong = db.prepare(`
  SELECT signal_id, ts, pattern, subject, strength, evidence_json
  FROM signals
  WHERE strength >= ?
    AND ts >= datetime('now', ?)
  ORDER BY strength DESC, ts DESC
`).all(STRENGTH_THRESHOLD, `-${RECENT_MINUTES} minutes`);

const insertHandoff = db.prepare(`
  INSERT OR IGNORE INTO handoffs (signal_id, pattern, subject, strength, ts, filename)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const coveredDomains = buildCoveredDomains();
let written = 0, skipped = 0, already_built = 0;
for (const s of strong) {
  // Skip signals whose seam domain is already served by an existing cap
  const domain = subjectDomain(s.subject);
  if (domain && coveredDomains.has(domain)) { already_built += 1; continue; }

  const ev = JSON.parse(s.evidence_json || "{}");
  const hookType = HOOK_BY_PATTERN[s.pattern] || s.pattern;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `capability_spec_${ts}_${s.pattern}_${urlSafe(shortSubject(s.subject))}.md`;
  const fullPath = join(HANDOFF_DIR, filename);

  // Dedupe via the unique constraint — INSERT OR IGNORE returns 0 changes when blocked
  const result = insertHandoff.run(s.signal_id, s.pattern, s.subject, s.strength, new Date().toISOString(), filename);
  if (result.changes === 0) { skipped += 1; continue; }

  const body = renderSpec({ signal: s, hookType, ev });
  writeFileSync(fullPath, body, "utf8");
  written += 1;
}

console.log(`handoff: wrote=${written} skipped(deduped)=${skipped} already_built=${already_built} considered=${strong.length} threshold=${STRENGTH_THRESHOLD} window=${RECENT_MINUTES}m`);
db.close();
