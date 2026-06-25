// x402-endpoint-intel.js
//
// Market intelligence for x402 endpoints and operator wallets, drawn from
// the Stall's own signal-intel archive: 4.1M+ settlements, 80K+ operators,
// 10 days of live Base mainnet x402 traffic — no external API needed.
//
// Input: resource URL OR pay_to wallet address (auto-detected).
// Output: settlement volume, unique payer count, price stats, reputation tier,
//         endpoint description, activity window, and operator profile.
//
// Use before routing agent spend, evaluating competitor endpoints, or
// assessing counterparty quality in automated x402 workflows.
//
// Edge: no competitor holds this settlement archive. It is built from passive
// observation of Base mainnet x402 traffic — unique to the Stall.
//
// [REDACTED]6 · 2026-06-07

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dir  = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, "..", "archive.db");
const require  = createRequire(import.meta.url);

function getDb() {
  const Database = require("better-sqlite3");
  return new Database(DB_PATH, { readonly: true });
}

function detectType(target) {
  if (/^0x[0-9a-fA-F]{40}$/.test(target.trim())) return "wallet";
  if (target.startsWith("http://") || target.startsWith("https://")) return "url";
  return null;
}

function reputationTier(n) {
  if (n >= 10000) return "HIGH_VOLUME";
  if (n >= 1000)  return "ESTABLISHED";
  if (n >= 100)   return "ACTIVE";
  if (n >= 10)    return "EMERGING";
  if (n >= 1)     return "LISTED";
  return "UNKNOWN";
}

function queryByUrl(db, resource) {
  const agg = db.prepare(`
    SELECT
      COUNT(*)                     AS settlements,
      COUNT(DISTINCT payer_wallet) AS unique_payers,
      AVG(amount_usd)              AS avg_price_usd,
      MIN(amount_usd)              AS min_price_usd,
      MAX(amount_usd)              AS max_price_usd,
      MIN(ts)                      AS first_seen,
      MAX(ts)                      AS last_seen,
      COUNT(DISTINCT substr(ts,1,10)) AS active_days
    FROM settlements
    WHERE resource = ?
  `).get(resource);

  const meta = db.prepare(`
    SELECT name, description, category, price_usd, pay_to, config_json
    FROM endpoints
    WHERE resource = ?
    LIMIT 1
  `).get(resource);

  return { agg, meta };
}

function queryByWallet(db, wallet) {
  const agg = db.prepare(`
    SELECT
      COUNT(*)                     AS settlements,
      COUNT(DISTINCT payer_wallet) AS unique_payers,
      COUNT(DISTINCT resource)     AS unique_resources,
      AVG(amount_usd)              AS avg_price_usd,
      MIN(amount_usd)              AS min_price_usd,
      MAX(amount_usd)              AS max_price_usd,
      MIN(ts)                      AS first_seen,
      MAX(ts)                      AS last_seen,
      COUNT(DISTINCT substr(ts,1,10)) AS active_days
    FROM settlements
    WHERE pay_to = ?
  `).get(wallet);

  const resources = db.prepare(`
    SELECT DISTINCT s.resource, e.description, e.category, e.name
    FROM settlements s
    LEFT JOIN endpoints e ON s.resource = e.resource
    WHERE s.pay_to = ?
    ORDER BY s.resource
    LIMIT 20
  `).all(wallet);

  return { agg, resources };
}

export default {
  name: "x402-endpoint-intel",
  price: "$0.040",

  description:
    "Market intelligence for any x402 endpoint or operator wallet. Returns settlement volume, unique payer count, price range, reputation tier, activity window, and endpoint description — drawn from 4.1M+ Base mainnet settlements in the Stall's proprietary on-chain dataset. Use before routing agent spend, vetting a counterparty operator, or benchmarking competitor pricing. No external API. Covers 80,000+ operators across 10+ days of live traffic.",

  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "Resource URL (https://…) or operator wallet address (0x…40 hex chars). Type is auto-detected.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      target:           { type: "string",  description: "Input target as provided." },
      target_type:      { type: "string",  description: "url | wallet" },
      settlements:      { type: "integer", description: "Total settled calls observed in archive." },
      unique_payers:    { type: "integer", description: "Distinct wallets that paid this endpoint/operator." },
      unique_resources: { type: "integer", description: "Number of distinct endpoints operated by this wallet (wallet queries only)." },
      avg_price_usd:    { type: "number",  description: "Average amount paid per call in USD." },
      price_range:      { type: "object",  description: "Min and max observed price.",
                          properties: { min: { type: "number" }, max: { type: "number" } } },
      reputation_tier:  { type: "string",  description: "HIGH_VOLUME (≥10K) | ESTABLISHED (≥1K) | ACTIVE (≥100) | EMERGING (≥10) | LISTED (≥1) | UNKNOWN (0)" },
      first_seen:       { type: "string",  description: "ISO-8601 timestamp of first observed settlement." },
      last_seen:        { type: "string",  description: "ISO-8601 timestamp of most recent settlement." },
      active_days:      { type: "integer", description: "Number of distinct calendar days with at least one settlement." },
      name:             { type: "string",  description: "Endpoint name from x402 bazaar catalog (if indexed)." },
      description:      { type: "string",  description: "Endpoint description from x402 bazaar catalog (if indexed)." },
      category:         { type: "string",  description: "Endpoint category from bazaar catalog (if indexed)." },
      endpoints:        { type: "array",   description: "Endpoint list for wallet queries (up to 20).",
                          items: { type: "object" } },
      archive_window:   { type: "object",  description: "Coverage window of the archive this response was drawn from.",
                          properties: { earliest: { type: "string" }, latest: { type: "string" }, total_settlements: { type: "integer" } } },
      ts:               { type: "string",  description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const raw = (query.target || "https://the-stall.intuitek.ai").trim();

    const targetType = detectType(raw);
    if (!targetType) {
      throw new Error(
        "unrecognized target format — expected a resource URL (https://…) or EVM wallet address (0x followed by 40 hex chars)"
      );
    }

    const db = getDb();
    try {
      // Archive coverage window
      const window = db.prepare(`
        SELECT MIN(ts) AS earliest, MAX(ts) AS latest, COUNT(*) AS total_settlements FROM settlements
      `).get();

      let result;

      if (targetType === "url") {
        const { agg, meta } = queryByUrl(db, raw);
        const n = agg?.settlements ?? 0;
        result = {
          target: raw,
          target_type: "url",
          settlements:   n,
          unique_payers: agg?.unique_payers ?? 0,
          avg_price_usd: agg?.avg_price_usd != null ? Math.round(agg.avg_price_usd * 10000) / 10000 : null,
          price_range:   n > 0 ? { min: agg.min_price_usd, max: agg.max_price_usd } : null,
          reputation_tier: reputationTier(n),
          first_seen:    agg?.first_seen ?? null,
          last_seen:     agg?.last_seen ?? null,
          active_days:   agg?.active_days ?? 0,
          name:          meta?.name ?? null,
          description:   meta?.description ?? null,
          category:      meta?.category ?? null,
        };
      } else {
        const wallet = raw.toLowerCase();
        const { agg, resources } = queryByWallet(db, wallet);
        const n = agg?.settlements ?? 0;
        result = {
          target: wallet,
          target_type: "wallet",
          settlements:      n,
          unique_payers:    agg?.unique_payers ?? 0,
          unique_resources: agg?.unique_resources ?? 0,
          avg_price_usd: agg?.avg_price_usd != null ? Math.round(agg.avg_price_usd * 10000) / 10000 : null,
          price_range:   n > 0 ? { min: agg.min_price_usd, max: agg.max_price_usd } : null,
          reputation_tier: reputationTier(n),
          first_seen:    agg?.first_seen ?? null,
          last_seen:     agg?.last_seen ?? null,
          active_days:   agg?.active_days ?? 0,
          endpoints:     resources
            .filter(r => r.resource != null)
            .map(r => ({
              resource:    r.resource,
              name:        r.name ?? null,
              description: r.description ?? null,
              category:    r.category ?? null,
            })),
        };
      }

      result.archive_window = {
        earliest:          window.earliest,
        latest:            window.latest,
        total_settlements: window.total_settlements,
      };
      result.ts = new Date().toISOString();
      return result;
    } finally {
      db.close();
    }
  },
};
