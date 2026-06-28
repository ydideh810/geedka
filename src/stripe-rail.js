// stripe-rail.js — FIAT payment rail (Stripe), parallel to the x402 USDC rail.
//
// WHY: x402 only serves crypto-native agents holding USDC on Base. A large share of
// real buyers (humans, fiat-only agent platforms) cannot pay that way. This rail lets
// them pay with a card via Stripe Checkout and receive a short-lived bearer access
// token redeemable as per-call credits against the same /cap/* endpoints.
//
// DESIGN (mirrors the existing retainer token rail so there's ONE token primitive):
//   1. POST /v1/fiat/checkout  -> creates a Stripe Checkout Session for a credit bundle,
//                                 returns { url } to send the buyer to Stripe-hosted checkout.
//   2. POST /v1/fiat/webhook   -> Stripe calls this on payment success
//                                 (checkout.session.completed). We mint a STALL access token
//                                 (EdDSA JWT, same signer as retainer) and credit a ledger.
//   3. GET  /v1/fiat/token?session_id=...  -> buyer polls to retrieve their token + credits.
//   4. fiatGate(...) middleware -> runs BEFORE the x402 paywall. If a valid Bearer token
//                                 with remaining credits is present on a /cap/* request, it
//                                 decrements one credit, marks req.fiatPaid=true, and lets the
//                                 request bypass x402 so the normal cap handler runs.
//
// The credit COUNT is authoritative in a server-side JSON ledger (a JWT alone cannot be
// decremented). The token is the bearer/identity; the ledger holds remaining balance.
//
// SAFETY: this module is additive. If STRIPE_SECRET_KEY is absent it self-disables and
// mounts nothing, so the x402 rail and boot are unaffected.

import Stripe from "stripe";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { mintToken, verifyToken } from "./retainer/token.js";
import { Mppx } from "mppx/server";
import * as stripeServer from "mppx/stripe/server";
import { Challenge } from "mppx";

// Credit bundles purchasable via Stripe. Priced with a deliberate margin over the
// blended ~ $0.01-0.02/call x402 price: fiat buyers pay a convenience premium and
// commit cash up front, which is exactly the high-intent demand we want to capture.
export const FIAT_BUNDLES = {
  starter: { credits: 100,  amount_cents: 500,   label: "100 call credits"  },  // $5  -> $0.05/call
  pro:     { credits: 1000, amount_cents: 3000,  label: "1,000 call credits" }, // $30 -> $0.03/call
  scale:   { credits: 10000, amount_cents: 20000, label: "10,000 call credits" }, // $200 -> $0.02/call
};

const SCOPE = "cap:*"; // a fiat credit pass is valid against every /cap/* endpoint
const TOKEN_WINDOW_SECONDS = 60 * 60 * 24 * 30; // token validity 30d; credits are the real limit

export function mountStripeRail(app, { signer, baseUrl, ledgerPath, log = console }) {
  // Test key takes priority over live key — enables test mode with no real charges.
  // STRIPE_SECRET_KEY_TEST=sk_test_... activates test mode; test webhook secret goes in STRIPE_WEBHOOK_SECRET_TEST.
  const testKey = process.env.STRIPE_SECRET_KEY_TEST;
  const liveKey = process.env.STRIPE_SECRET_KEY;
  const secretKey = testKey || liveKey;
  const isTestMode = testKey ? true : (liveKey?.startsWith("sk_test_") ?? false);

  if (!secretKey) {
    log.warn?.("  [stripe-rail] No Stripe key — fiat rail DISABLED (x402 rail unaffected). Set STRIPE_SECRET_KEY_TEST (test) or STRIPE_SECRET_KEY (live) to enable.");
    return { enabled: false, isTestMode: false, fiatGate: (_req, _res, next) => next(), getStripeChallenge: () => null, getMppChallenge: () => null, mppGate: (_req, _res, next) => next() };
  }
  const webhookSecret = testKey
    ? (process.env.STRIPE_WEBHOOK_SECRET_TEST || null)
    : (process.env.STRIPE_WEBHOOK_SECRET || null);
  const stripe = new Stripe(secretKey);

  // ── MPP (Machine Payment Protocol) — agent-payable Stripe via Shared Payment Tokens ──
  // Hermes link-cli / mppx agents settle headlessly: decode a `Payment` challenge, mint an
  // SPT (one human Link approval covers a capped budget), present it in `x-payment-info`.
  // verifyCredential checks HMAC provenance + expiry, then charges the SPT via Stripe
  // (replay-protected). On success we mint a 100-credit bundle token (mirrors the webhook
  // fulfilment path) so the agent reuses it via Bearer for the remaining calls.
  const mppSecret = process.env.MPP_SECRET_KEY;
  let mpp = null;
  let _mppChallenge = null; // cached serialized `Payment` challenge (refreshed below)
  if (mppSecret) {
    mpp = Mppx.create({
      realm: "the-stall",
      secretKey: mppSecret,
      methods: [ stripeServer.charge({
        secretKey,
        networkId: "the-stall",
        paymentMethodTypes: ["card"],
        amount: "5.00", currency: "usd", decimals: 2,
        description: "The Stall — 100 API credits ($5 bundle)",
      }) ],
    });
    const refreshMppChallenge = async () => {
      try {
        const ch = await mpp.challenge.stripe.charge({ amount: "5.00", currency: "usd", decimals: 2 });
        _mppChallenge = Challenge.serialize(ch);
      } catch (e) { log.error?.("  [stripe-rail] MPP challenge refresh failed:", e.message); }
    };
    refreshMppChallenge();
    const _t = setInterval(refreshMppChallenge, 60 * 1000); _t.unref?.();
  }
  function getMppChallenge() { return _mppChallenge; }
  async function mppGate(req, res, next) {
    if (!mpp || !req.path.startsWith("/cap/")) return next();
    const credential = req.headers["x-payment-info"];
    if (!credential) return next();
    let receipt;
    try {
      receipt = await mpp.verifyCredential(String(credential));
    } catch (e) {
      log.warn?.("  [stripe-rail] MPP verify failed:", e.message);
      return res.status(402).json({ error: "mpp_settlement_failed", message: e.message });
    }
    const bundle = FIAT_BUNDLES.starter;
    const jti = randomUUID();
    const token = mintToken(signer, {
      payer: receipt?.reference || "mpp-stripe",
      plan: "fiat:starter:mpp",
      scope: [SCOPE],
      windowSeconds: TOKEN_WINDOW_SECONDS,
      jti,
    });
    const ledger = loadLedger();
    ledger[jti] = { credits: bundle.credits - 1, granted: bundle.credits, created: Date.now(), mpp: receipt?.reference || null };
    saveLedger(ledger);
    req.fiatPaid = true;
    res.setHeader("X-Stall-Token", token);
    res.setHeader("X-Fiat-Credits-Remaining", String(bundle.credits - 1));
    log.log?.(`  [stripe-rail] MPP settled (ref ${String(receipt?.reference || "").slice(0,12)}): +${bundle.credits} credits (jti ${jti.slice(0,8)})`);
    return next();
  }

  // ── Credit ledger (token jti -> remaining credits) ────────────────────────────
  // Small JSON file; fine for current volume. Swap for SQLite if it grows hot.
  function loadLedger() {
    try { return existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : {}; }
    catch { return {}; }
  }
  function saveLedger(l) {
    try { mkdirSync(dirname(ledgerPath), { recursive: true }); writeFileSync(ledgerPath, JSON.stringify(l)); }
    catch (e) { log.error?.("  [stripe-rail] ledger write failed:", e.message); }
  }
  // Maps Stripe session id -> { token, jti } so the buyer can fetch their token post-payment.
  const sessionTokens = new Map();

  // ── 1. Create a checkout session ──────────────────────────────────────────────
  app.post("/v1/fiat/checkout", express_json(), async (req, res) => {
    try {
      const bundleKey = String(req.body?.bundle || "starter");
      const bundle = FIAT_BUNDLES[bundleKey];
      if (!bundle) return res.status(400).json({ error: "unknown_bundle", available: Object.keys(FIAT_BUNDLES) });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: bundle.amount_cents,
            product_data: { name: `THE STALL — ${bundle.label}`, description: `${bundle.credits} pay-per-call credits, redeemable on any of the API's caps.` },
          },
        }],
        metadata: { bundle: bundleKey, credits: String(bundle.credits) },
        success_url: `${baseUrl}/v1/fiat/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/`,
      });
      return res.json({ checkout_url: session.url, session_id: session.id, bundle: bundleKey, credits: bundle.credits, amount_usd: bundle.amount_cents / 100 });
    } catch (e) {
      log.error?.("  [stripe-rail] checkout create failed:", e.message);
      return res.status(500).json({ error: "checkout_failed", message: e.message });
    }
  });

  // ── 2. Stripe webhook — fulfilment ────────────────────────────────────────────
  // MUST receive the raw body for signature verification, so it uses express.raw.
  app.post("/v1/fiat/webhook", express_raw(), async (req, res) => {
    let event;
    try {
      if (webhookSecret) {
        const sig = req.headers["stripe-signature"];
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        // No signing secret configured (local/dev): accept parsed JSON unverified.
        event = JSON.parse(req.body.toString("utf8"));
        log.warn?.("  [stripe-rail] STRIPE_WEBHOOK_SECRET unset — webhook signature NOT verified (dev only).");
      }
    } catch (e) {
      log.error?.("  [stripe-rail] webhook signature verification failed:", e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const credits = parseInt(session.metadata?.credits || "0", 10);
      if (credits > 0) {
        const jti = randomUUID();
        const token = mintToken(signer, {
          payer: session.customer_details?.email || session.id,
          plan: `fiat:${session.metadata?.bundle || "starter"}`,
          scope: [SCOPE],
          windowSeconds: TOKEN_WINDOW_SECONDS,
          jti,
        });
        const ledger = loadLedger();
        ledger[jti] = { credits, granted: credits, created: Date.now(), session: session.id };
        saveLedger(ledger);
        sessionTokens.set(session.id, { token, jti });
        log.log?.(`  [stripe-rail] fulfilled session ${session.id}: +${credits} credits (jti ${jti.slice(0, 8)})`);
      }
    }
    return res.json({ received: true });
  });

  // ── 3. Token retrieval (buyer polls after redirect) ───────────────────────────
  app.get("/v1/fiat/token", async (req, res) => {
    const sessionId = String(req.query.session_id || "");
    if (!sessionId) return res.status(400).json({ error: "missing_session_id" });
    const rec = sessionTokens.get(sessionId);
    if (!rec) return res.status(404).json({ error: "not_ready", message: "Payment not yet confirmed or session unknown. Retry shortly." });
    const ledger = loadLedger();
    const remaining = ledger[rec.jti]?.credits ?? 0;
    return res.json({
      access_token: rec.token,
      token_type: "Bearer",
      credits_remaining: remaining,
      usage: `Send header: Authorization: Bearer <access_token> to any GET/POST ${baseUrl}/cap/<name>. One credit per successful call.`,
    });
  });

  // Friendly landing after Stripe redirect.
  app.get("/v1/fiat/success", (req, res) => {
    res.type("html").send(`<!doctype html><meta charset=utf8><body style="font-family:system-ui;max-width:640px;margin:3rem auto">
<h2>Payment received ✓</h2><p>Fetch your access token:</p>
<pre>curl "${baseUrl}/v1/fiat/token?session_id=${req.query.session_id || ""}"</pre>
<p>Then call any cap:</p>
<pre>curl -H "Authorization: Bearer &lt;token&gt;" "${baseUrl}/cap/ping"</pre></body>`);
  });

  // ── 4. Pre-x402 gate ──────────────────────────────────────────────────────────
  // If a valid fiat token with remaining credit is present on a /cap/* request,
  // decrement one credit and mark req.fiatPaid so the x402 middleware is bypassed.
  function fiatGate(req, res, next) {
    if (!req.path.startsWith("/cap/")) return next();
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) return next(); // no fiat token -> fall through to x402
    const token = auth.slice(7);
    let payload;
    try { payload = verifyToken(signer, token, { requiredScope: SCOPE }); }
    catch { return next(); } // invalid/expired -> let x402 handle (may still pay in USDC)

    const ledger = loadLedger();
    const entry = ledger[payload.jti];
    if (!entry || entry.credits <= 0) {
      return res.status(402).json({ error: "fiat_credits_exhausted", message: `Buy more credits: POST ${baseUrl}/v1/fiat/checkout` });
    }
    entry.credits -= 1;
    saveLedger(ledger);
    req.fiatPaid = true;
    res.setHeader("X-Fiat-Credits-Remaining", String(entry.credits));
    return next();
  }

  // Returns a WWW-Authenticate challenge string for Stripe payment discovery.
  // MPP-aware agents (e.g. Hermes stripe-link-cli) parse this to find the checkout endpoint.
  function getStripeChallenge() {
    return (
      `Stripe realm="the-stall" checkout_url="${baseUrl}/v1/fiat/checkout"` +
      ` bundles="starter:100calls:$5.00,pro:1000calls:$30.00,scale:10000calls:$200.00"` +
      ` mode="${isTestMode ? "test" : "live"}"`
    );
  }

  log.log?.(`  [stripe-rail] ENABLED (${isTestMode ? "TEST" : "LIVE"} mode) — fiat rail mounted at /v1/fiat/* (bundles: ${Object.keys(FIAT_BUNDLES).join(", ")})`);
  return { enabled: true, isTestMode, fiatGate, getStripeChallenge, getMppChallenge, mppGate, _stripe: stripe, _loadLedger: loadLedger };
}

// Local helpers so the webhook gets raw body while checkout gets JSON, without
// disturbing the app-level express.json() already installed in server.js.
import express from "express";
function express_json() { return express.json(); }
function express_raw() { return express.raw({ type: "application/json" }); }
