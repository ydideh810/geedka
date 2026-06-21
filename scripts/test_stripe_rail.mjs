// test_stripe_rail.mjs — fiat rail smoke test (no network, no real Stripe call).
//
// Run:  node scripts/test_stripe_rail.mjs
//
// Exercises the money-bearing logic of src/stripe-rail.js end to end:
//   1. Module self-disables with no STRIPE_SECRET_KEY.
//   2. With a key set, the webhook fulfilment mints a token + credits the ledger.
//   3. The fiatGate authorizes a /cap/* request, decrements credit, sets req.fiatPaid.
//   4. Credits exhaust -> gate returns 402.
//   5. A garbage / non-fiat Authorization header falls through to x402 (next() called).
//
// Stripe's network surface (checkout.sessions.create) is NOT exercised here — that's a
// thin wrapper. We drive the webhook handler directly with a synthetic event, which is
// the part that actually grants access. Signature verification is bypassed by leaving
// STRIPE_WEBHOOK_SECRET unset (dev path), matching local usage.

import express from "express";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓", msg); } else { fail++; console.error("  ✗ FAIL:", msg); } };

// In-process signer (mirrors loadSigner() ephemeral branch — no env needed).
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const signer = { privateKey, publicKey };

const ledgerPath = join(tmpdir(), `stall_fiat_test_${randomUUID()}.json`);
const quietLog = { warn() {}, error() {}, log() {} };

const { mountStripeRail } = await import("../src/stripe-rail.js");

// ── Test 1: self-disable without a key ────────────────────────────────────────
{
  const prev = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  const r = mountStripeRail(express(), { signer, baseUrl: "http://x", ledgerPath, log: quietLog });
  ok(r.enabled === false, "rail self-disables when STRIPE_SECRET_KEY is absent");
  let called = false;
  r.fiatGate({ path: "/cap/ping", headers: {} }, {}, () => { called = true; });
  ok(called, "disabled gate is a passthrough (calls next)");
  if (prev) process.env.STRIPE_SECRET_KEY = prev;
}

// ── Enable rail with a dummy key (no network calls are made in these tests) ────
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_key_for_unit_test";
delete process.env.STRIPE_WEBHOOK_SECRET; // use dev (unverified) webhook path
const app = express();
const rail = mountStripeRail(app, { signer, baseUrl: "http://x", ledgerPath, log: quietLog });
ok(rail.enabled === true, "rail enables when STRIPE_SECRET_KEY is present");

// Find the registered webhook handler and invoke it with a synthetic completed event.
const layers = app._router.stack.filter(l => l.route && l.route.path === "/v1/fiat/webhook");
ok(layers.length === 1, "POST /v1/fiat/webhook is registered");
const webhookHandlers = layers[0].route.stack.map(s => s.handle);
const webhookFn = webhookHandlers[webhookHandlers.length - 1]; // last = our async handler (raw parser is first)

const sessionId = "cs_test_" + randomUUID();
const event = {
  type: "checkout.session.completed",
  data: { object: { id: sessionId, metadata: { bundle: "starter", credits: "2" }, customer_details: { email: "buyer@example.com" } } },
};
// Webhook expects a raw Buffer body (express.raw normally provides it).
let webhookResp = null;
const fakeRes = { json(b) { webhookResp = b; return this; }, status() { return this; }, send() { return this; } };
await webhookFn({ headers: {}, body: Buffer.from(JSON.stringify(event)) }, fakeRes);
ok(webhookResp && webhookResp.received === true, "webhook acknowledges the event");

const ledger = rail._loadLedger();
const jtis = Object.keys(ledger);
ok(jtis.length === 1 && ledger[jtis[0]].credits === 2, "webhook credited the ledger with 2 credits");

// Retrieve the token the buyer would fetch (via the success/token route logic).
const tokenLayers = app._router.stack.filter(l => l.route && l.route.path === "/v1/fiat/token");
const tokenFn = tokenLayers[0].route.stack.slice(-1)[0].handle;
let tokenResp = null;
await tokenFn({ query: { session_id: sessionId } }, { json(b){ tokenResp = b; return this; }, status(){ return this; } });
ok(tokenResp && typeof tokenResp.access_token === "string", "buyer can retrieve a signed access token");
ok(tokenResp.credits_remaining === 2, "token endpoint reports 2 credits remaining");
const token = tokenResp.access_token;

// ── Gate: first call decrements to 1, marks fiatPaid ──────────────────────────
function runGate(authToken) {
  return new Promise((resolve) => {
    const req = { path: "/cap/ping", headers: { authorization: authToken ? `Bearer ${authToken}` : "" }, fiatPaid: false };
    const res = { setHeader() {}, _status: 200, status(c){ this._status = c; return this; }, json(b){ resolve({ blocked: true, status: this._status, body: b, req }); return this; } };
    rail.fiatGate(req, res, () => resolve({ blocked: false, req }));
  });
}

let g = await runGate(token);
ok(g.blocked === false && g.req.fiatPaid === true, "valid token: gate authorizes and sets req.fiatPaid");
ok(rail._loadLedger()[jtis[0]].credits === 1, "credit decremented 2 -> 1 after one call");

g = await runGate(token);
ok(g.blocked === false && rail._loadLedger()[jtis[0]].credits === 0, "second call decrements 1 -> 0");

g = await runGate(token);
ok(g.blocked === true && g.status === 402 && g.body.error === "fiat_credits_exhausted", "exhausted credits -> 402");

// ── Garbage / non-fiat auth falls through to x402 ─────────────────────────────
g = await runGate("not.a.real.token");
ok(g.blocked === false && !g.req.fiatPaid, "invalid bearer token falls through to x402 (next called, no fiatPaid)");

g = await runGate(null);
ok(g.blocked === false && !g.req.fiatPaid, "no Authorization header falls through to x402");

// cleanup
if (existsSync(ledgerPath)) rmSync(ledgerPath);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
