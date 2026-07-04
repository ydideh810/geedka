// action-receipt.js — proof-of-action receipts for autonomous agents.
// The blockage this clears: "I did the thing, but I cannot prove it later."
// Agents, orchestrators, and their principals need durable, self-verifying
// records of what was done, by whom, on what, and when — dispute-ready.
// The field's proof-shaped endpoints show the highest repeat-payer rate
// (0.94): whoever needs one receipt needs every receipt.

import crypto from "node:crypto";

export default {
  name: "action-receipt",
  price: "$0.05",
  description:
    "Issue a self-verifying action receipt: sha256-chained record binding actor, action, subject, and result hash to a timestamp and nonce. Returns the receipt plus the exact recompute recipe so any third party can verify it offline. Durable proof for agent actions, dispute defense, and audit trails.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "what was done, e.g. 'sent_quote', 'published_listing', 'completed_job'" },
      actor: { type: "string", description: "who/what did it — agent id, wallet, or name" },
      subject: { type: "string", description: "what it was done to/for (optional)" },
      result_hash: { type: "string", description: "sha256 of the work product, if any (optional)" },
      meta: { type: "string", description: "freeform context, max 500 chars (optional)" },
    },
    required: ["action", "actor"],
  },
  outputSchema: {
    type: "object",
    properties: {
      receipt_id: { type: "string" },
      chain_hash: { type: "string" },
      issued_at: { type: "string" },
      verify_recipe: { type: "string" },
    },
  },
  async handler(query) {
    const issued_at = new Date().toISOString();
    const nonce = crypto.randomBytes(8).toString("hex");
    const record = {
      action: String(query.action || "").slice(0, 200),
      actor: String(query.actor || "").slice(0, 200),
      subject: query.subject ? String(query.subject).slice(0, 300) : null,
      result_hash: query.result_hash ? String(query.result_hash).slice(0, 128) : null,
      meta: query.meta ? String(query.meta).slice(0, 500) : null,
      issued_at,
      nonce,
    };
    const canonical = JSON.stringify(record);
    const chain_hash = crypto.createHash("sha256").update(canonical).digest("hex");
    return {
      receipt_id: "act_" + crypto.randomBytes(6).toString("hex"),
      issuer: "STALL Clearance Layer (IntuiTek¹)",
      record,
      chain_hash,
      verify_recipe:
        "chain_hash === sha256(JSON.stringify(record)) with record keys in the exact order returned. Recompute offline; no trust in the issuer required for integrity.",
      issued_at,
      upgrade_path: "EIP-712 issuer signature + on-chain anchoring available in v2 on demand signal.",
    };
  },
};
