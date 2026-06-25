// concentration-risk-score.js
//
// Returns a concentration-risk assessment for any x402 pay_to wallet address.
// Measures how dependent the payer population is on a single endpoint: a
// high HHI means a small cluster of agents is driving most of that address's
// revenue, creating fragility for the endpoint operator AND an insertion
// window for a competing capability that serves those agents better.
//
// Data source: the local archive.db accumulated by the signal-intel scout.
// Reads only — never writes.

import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT   = join(__dirname, "..");
const DB_PATH     = process.env.ARCHIVE_DB || join(REPO_ROOT, "archive.db");

const RISK_TIERS = [
  { max: 0.15, tier: "LOW",      label: "Dispersed payer base — no single agent dependency" },
  { max: 0.25, tier: "MEDIUM",   label: "Moderate concentration — a few agents drive most volume" },
  { max: 0.50, tier: "HIGH",     label: "High concentration — dominant agent cluster detected" },
  { max: 1.01, tier: "CRITICAL", label: "Near-monopoly payer — single-agent framework lock-in" },
];

function classify(hhi) {
  return RISK_TIERS.find((t) => hhi < t.max) || RISK_TIERS[RISK_TIERS.length - 1];
}

function hhi(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return counts.reduce((sum, c) => sum + Math.pow(c / total, 2), 0);
}

export default {
  name: "concentration-risk-score",
  price: "$0.213",

  description:
    "Returns a concentration-risk score for an x402 pay_to wallet: HHI, unique payer count, top-payer share, persistence across scans, and a risk tier (LOW / MEDIUM / HIGH / CRITICAL). An agent uses this to assess whether an endpoint is a single-agent dependency before building a workflow that depends on it.",

  inputSchema: {
    type: "object",
    properties: {
      address: {
        type: "string",
        description: "The pay_to wallet address to score (0x-prefixed, 42 hex chars).",
      },
      window_days: {
        type: "integer",
        description: "Observation window in days (default 7, max 30).",
        default: 7,
      },
    },
    required: [],
  },

  outputSchema: {
    type: "object",
    properties: {
      address:          { type: "string" },
      risk_tier:        { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL", "NO_DATA"] },
      hhi:              { type: "number", description: "Herfindahl-Hirschman Index [0, 1]. 1 = monopoly." },
      unique_payers:    { type: "integer" },
      total_settlements:{ type: "integer" },
      top_payer_share:  { type: "number", description: "Fraction of total settlements from the single largest payer." },
      persistence_scans:{ type: "integer", description: "Number of distinct 10-min scan windows address was observed in." },
      recommendation:   { type: "string" },
      window_days:      { type: "integer" },
      observed_at:      { type: "string" },
    },
  },

  async handler(query) {
    const { window_days: rawWindow } = query;
    const address = query.address || "0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe";

    if (!/^0x[0-9a-fA-F]{40}/.test(address)) {
      throw new Error("address must be a 0x-prefixed hex wallet address");
    }

    const windowDays = Math.min(Math.max(parseInt(rawWindow || "7", 10), 1), 30);
    const windowCutoff = new Date(Date.now() - windowDays * 86400_000).toISOString();

    const db = new Database(DB_PATH, { readonly: true });
    try {
      const rows = db
        .prepare(
          `SELECT payer_wallet, COUNT(*) AS n
           FROM settlements
           WHERE pay_to = ?
             AND ts >= ?
           GROUP BY payer_wallet
           ORDER BY n DESC`
        )
        .all(address.toLowerCase(), windowCutoff);

      const persistence = db
        .prepare(
          `SELECT COUNT(DISTINCT scan_id) AS cnt
           FROM settlements s
           JOIN scans sc ON sc.ts <= s.ts
           WHERE s.pay_to = ?
             AND s.ts >= ?`
        )
        .get(address.toLowerCase(), windowCutoff)?.cnt ?? 0;

      if (rows.length === 0) {
        return {
          address,
          risk_tier: "NO_DATA",
          hhi: 0,
          unique_payers: 0,
          total_settlements: 0,
          top_payer_share: 0,
          persistence_scans: 0,
          recommendation: `No settlements found for ${address} in the last ${windowDays} days. Either this address is not an active x402 recipient, or it is too new to assess.`,
          window_days: windowDays,
          observed_at: new Date().toISOString(),
        };
      }

      const counts = rows.map((r) => r.n);
      const total  = counts.reduce((a, b) => a + b, 0);
      const score  = hhi(counts);
      const topShare = counts[0] / total;
      const tier   = classify(score);

      const recommendation = buildRecommendation(tier.tier, rows.length, total, topShare, address, windowDays);

      return {
        address,
        risk_tier: tier.tier,
        hhi: Math.round(score * 10000) / 10000,
        unique_payers: rows.length,
        total_settlements: total,
        top_payer_share: Math.round(topShare * 10000) / 10000,
        persistence_scans: persistence,
        recommendation,
        window_days: windowDays,
        observed_at: new Date().toISOString(),
      };
    } finally {
      db.close();
    }
  },
};

function buildRecommendation(tier, payers, total, topShare, address, windowDays) {
  const addr = `${address.slice(0, 6)}…${address.slice(-4)}`;
  switch (tier) {
    case "LOW":
      return `${addr} has a dispersed payer base (${payers} agents, top payer ≤${Math.round(topShare * 100)}% of volume over ${windowDays}d). Low framework-dependency risk — this endpoint has broad organic adoption. Not a strong insertion window.`;
    case "MEDIUM":
      return `${addr} shows moderate concentration (${payers} agents, top payer ${Math.round(topShare * 100)}% of ${total} settlements over ${windowDays}d). A small cluster drives most volume. Monitor for drift toward HIGH; insertion with differentiated capability may capture secondary payers.`;
    case "HIGH":
      return `${addr} has high concentration (${payers} agents, top payer ${Math.round(topShare * 100)}% over ${windowDays}d). Dominant cluster detected — the endpoint has de facto framework lock-in for a narrow operator group. Hedge opportunity: build competing capability at better price/schema, surface to the dependent cluster's framework provider.`;
    case "CRITICAL":
      return `${addr} is in near-monopoly lock-in (${payers} agent(s), top payer ${Math.round(topShare * 100)}% of ${total} settlements over ${windowDays}d). Single-agent dependency confirmed. The incumbent is structurally fragile — the dependent agent's operator has strong incentive to switch or hedge if a credible alternative exists.`;
    default:
      return "";
  }
}
