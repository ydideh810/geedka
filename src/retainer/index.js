// Retainer mount — adapted from v1 x402-express spec to v2 @x402/express API.
// The subscribe routes (POST /v1/subscribe/:plan) use x402 for payment.
// The product route (GET /v1/risk/:address) is token-gated (JWT, no x402).
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { getAuthHeaders } from "@coinbase/cdp-sdk/auth";
import { loadSigner, mintToken, verifyToken } from "./token.js";
import { createReplayGuard } from "./replayGuard.js";
import { makeRiskService } from "./risk.js";
import { PLANS } from "./plans.js";
import { randomUUID } from "node:crypto";

function toCAIP2(network) {
  if (network === "base") return "eip155:8453";
  if (network === "base-sepolia") return "eip155:84532";
  return network;
}

export function mountRetainer(app, { payTo, network, facilitator, provider }) {
  const signer = loadSigner();
  if (signer.ephemeral) {
    console.warn("  [retainer] WARN: MYRIAD_TOKEN_SK not set — using ephemeral key (tokens invalidated on restart)");
  }

  const replayGuard = createReplayGuard();
  const risk = makeRiskService(provider);
  const windowHits = new Map();
  const caip2Network = toCAIP2(network);

  // x402 v2 route config for subscribe endpoints
  const routeConfig = {};
  for (const [plan, cfg] of Object.entries(PLANS)) {
    routeConfig[`POST /v1/subscribe/${plan}`] = {
      accepts: { scheme: "exact", price: cfg.price, network: caip2Network, payTo },
      description: `MYRIAD risk retainer (${plan}) — ${cfg.windowSeconds / 86400}d access to /v1/risk/:address`,
      mimeType: "application/json",
    };
  }

  // Build CDP-authed facilitator config (mirrors payment.js)
  const cdpKeyId = process.env.CDP_API_KEY_ID;
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET;
  const isCdp = facilitator?.includes("cdp.coinbase.com");
  let facilitatorConfig = { url: facilitator };
  if (isCdp && cdpKeyId && cdpKeySecret) {
    const host = "api.cdp.coinbase.com";
    const basePath = "/platform/v2/x402";
    facilitatorConfig.createAuthHeaders = async () => {
      const [verifyH, settleH, supportedH, listH] = await Promise.all([
        getAuthHeaders({ apiKeyId: cdpKeyId, apiKeySecret: cdpKeySecret, requestMethod: "POST", requestHost: host, requestPath: `${basePath}/verify` }),
        getAuthHeaders({ apiKeyId: cdpKeyId, apiKeySecret: cdpKeySecret, requestMethod: "POST", requestHost: host, requestPath: `${basePath}/settle` }),
        getAuthHeaders({ apiKeyId: cdpKeyId, apiKeySecret: cdpKeySecret, requestMethod: "GET",  requestHost: host, requestPath: `${basePath}/supported` }),
        getAuthHeaders({ apiKeyId: cdpKeyId, apiKeySecret: cdpKeySecret, requestMethod: "GET",  requestHost: host, requestPath: `${basePath}/discovery/resources` }),
      ]);
      return { verify: verifyH, settle: settleH, supported: supportedH, list: listH };
    };
  }

  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient(facilitatorConfig))
    .register(caip2Network, new ExactEvmScheme());

  app.use(paymentMiddleware(routeConfig, resourceServer));

  function paymentContext(req) {
    const raw = req.header("X-PAYMENT");
    if (!raw) return null;
    try {
      const d = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
      const auth = d?.payload?.authorization || d?.authorization || {};
      const payer = auth.from || d?.payload?.from || d?.from || "unknown";
      const nonce = auth.nonce || d?.payload?.nonce || d?.nonce || randomUUID();
      return { payer, settlementId: payer + ":" + nonce };
    } catch { return null; }
  }

  for (const [plan, cfg] of Object.entries(PLANS)) {
    app.post("/v1/subscribe/" + plan, (req, res) => {
      const ctx = paymentContext(req) || { payer: "unknown", settlementId: randomUUID() };
      if (!replayGuard.claim(ctx.settlementId)) {
        return res.status(409).json({ error: "settlement already redeemed" });
      }
      const jti = randomUUID();
      const token = mintToken(signer, { payer: ctx.payer, plan, scope: cfg.scope, windowSeconds: cfg.windowSeconds, jti });
      res.json({
        capability_token: token,
        plan,
        scope: cfg.scope,
        expires_in: cfg.windowSeconds,
        token_type: "Bearer",
        usage: "GET /v1/risk/{address} with header: Authorization: Bearer <capability_token>",
        renew: "On 401/expiry, POST /v1/subscribe/" + plan + " again with x402 payment.",
      });
    });
  }

  function challenge(res, reason) {
    return res.status(401).json({
      error: "subscription required",
      reason,
      renew: Object.keys(PLANS).map(p => ({ plan: p, pay: "POST /v1/subscribe/" + p, price: PLANS[p].price })),
    });
  }

  function requireSubscription(requiredScope) {
    return (req, res, next) => {
      const auth = req.header("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) return challenge(res, "missing capability token");
      try {
        const payload = verifyToken(signer, token, { requiredScope });
        const cfg = PLANS[payload.plan];
        if (cfg?.rateLimitPerMin) {
          const minute = Math.floor(Date.now() / 60000);
          const w = windowHits.get(payload.jti);
          if (!w || w.minute !== minute) windowHits.set(payload.jti, { minute, count: 1 });
          else if (++w.count > cfg.rateLimitPerMin) return res.status(429).json({ error: "rate limit", limit: cfg.rateLimitPerMin });
        }
        req.sub = payload;
        next();
      } catch (e) {
        return challenge(res, e.message);
      }
    };
  }

  app.get("/v1/risk/:address", requireSubscription("risk:read"), async (req, res) => {
    try {
      const result = await risk.assess(req.params.address);
      res.json(result);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  return { plans: PLANS };
}
