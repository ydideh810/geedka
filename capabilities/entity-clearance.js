// entity-clearance.js — verified entity clearance for autonomous agents.
// The blockage this clears: "I found an entity, but I cannot safely act on
// it." Returns graded verification, risk flags, a recommended action, and a
// self-verifying receipt — the difference between `found` and `safe enough
// to proceed`, in one paid call.

import crypto from "node:crypto";

const TIMEOUT_MS = 4500;

async function probe(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctl.signal,
      headers: { "user-agent": "STALL-entity-clearance/1.0 (+https://myriad.synaptiic.org)" },
    });
    const text = await res.text().catch(() => "");
    const m = text.match(/<title[^>]*>([^<]{0,300})<\/title>/i);
    return { live: res.status < 400, status: res.status,
             final_url: res.url, title: m ? m[1].trim() : null };
  } catch (e) {
    return { live: false, status: null, final_url: null, title: null,
             error: String(e && e.name === "AbortError" ? "timeout" : e) };
  } finally {
    clearTimeout(t);
  }
}

function domainOf(s) {
  try { return new URL(s.includes("://") ? s : `https://${s}`).hostname
            .replace(/^www\./, "").toLowerCase(); }
  catch { return null; }
}

export default {
  name: "entity-clearance",
  price: "$0.25",
  description:
    "Clearance check on a business/entity before an agent acts on it: live-site probe, domain/contact consistency, name corroboration, graded evidence (E0-E2), risk flags, recommended_action, and a self-verifying sha256 receipt. Turns 'found' into 'safe enough to proceed'.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "entity name as claimed" },
      website: { type: "string", description: "claimed website URL or domain" },
      email: { type: "string", description: "claimed contact email (optional)" },
      intended_action: { type: "string", description: "what the agent wants to do next (optional; sharpens recommended_action)" },
    },
    required: ["name", "website"],
  },
  outputSchema: {
    type: "object",
    properties: {
      verification_status: { type: "string", description: "verified_live | partially_verified | unverified" },
      verified_fields: { type: "object" },
      evidence: { type: "array" },
      risk_flags: { type: "array" },
      recommended_action: { type: "string" },
      receipt: { type: "object" },
    },
  },
  async handler(query) {
    const checkedAt = new Date().toISOString();
    const name = String(query.name || "").slice(0, 200);
    const site = String(query.website || "").slice(0, 300);
    const email = query.email ? String(query.email).slice(0, 200) : null;

    const domain = domainOf(site);
    const evidence = [];
    const risk = [];
    const fields = {};

    // 1. structural checks
    fields.website_format_valid = !!domain;
    evidence.push({ check: "website_format", ok: !!domain, grade: "E2" });
    if (!domain) risk.push("website not parseable as a domain");

    // 2. liveness probe (primary-source check, fetched not assumed)
    let live = { live: false };
    if (domain) {
      live = await probe(`https://${domain}`);
      fields.site_live = live.live;
      evidence.push({ check: "https_liveness", ok: live.live,
                      status: live.status, final_url: live.final_url,
                      grade: live.live ? "E2" : "E0", checked_at: checkedAt });
      if (!live.live) risk.push("site did not respond over https");
    }

    // 3. contact-domain consistency
    if (email) {
      const eDom = (email.split("@")[1] || "").replace(/^www\./, "").toLowerCase();
      const match = !!domain && (eDom === domain || eDom.endsWith(`.${domain}`));
      fields.contact_domain_matches = match;
      evidence.push({ check: "contact_domain_match", ok: match,
                      grade: match ? "E2" : "E1" });
      if (!match) risk.push("contact email domain differs from website domain");
    }

    // 4. name corroboration against fetched title (soft signal)
    if (live.title) {
      const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
      const hit = tokens.some(w => live.title.toLowerCase().includes(w));
      fields.name_corroborated_by_site = hit;
      evidence.push({ check: "name_in_site_title", ok: hit,
                      title: live.title.slice(0, 120), grade: hit ? "E2" : "E1" });
      if (!hit) risk.push("claimed name not found in site title (weak signal)");
    }

    const okCount = evidence.filter(e => e.ok).length;
    const verification_status =
      fields.site_live && okCount >= 3 ? "verified_live"
      : okCount >= 2 ? "partially_verified" : "unverified";

    const recommended_action =
      verification_status === "verified_live"
        ? "eligible_to_proceed" + (query.intended_action ? `:${String(query.intended_action).slice(0, 60)}` : "")
        : verification_status === "partially_verified"
          ? "proceed_only_with_secondary_confirmation"
          : "do_not_act_on_this_entity_without_stronger_sources";

    const body = { verification_status, verified_fields: fields, evidence,
                   risk_flags: risk, recommended_action, checked_at: checkedAt };
    const receipt_id = "rcpt_" + crypto.randomBytes(6).toString("hex");
    const result_hash = crypto.createHash("sha256")
      .update(JSON.stringify(body)).digest("hex");
    return {
      ...body,
      receipt: {
        receipt_id,
        issuer: "STALL Clearance Layer (IntuiTek¹)",
        result_hash,
        verify: "sha256 of the response body minus this receipt object",
        issued_at: checkedAt,
        limitations: "v1 deterministic checks: liveness, consistency, corroboration. Not a licensing, KYC, or legal-standing attestation.",
      },
    };
  },
};
