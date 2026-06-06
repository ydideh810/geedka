// payment.js — THE ONLY FILE THAT TOUCHES THE x402 PROTOCOL WIRING.
// x402 is moving fast (it just went to the Linux Foundation). Everything that
// can churn is quarantined here so a protocol bump is a one-file edit.
//
// DEFAULT: legacy `x402-express` (installs cleanly today; matches the live
//   Railway/Express/USDC-on-Base proof points in the wild as of 2026).
// FUTURE:  the foundation-canonical `@x402/express` + x402ResourceServer +
//   ExactEvmScheme. The migration shim is documented at the bottom.

import { paymentMiddleware } from "x402-express";
import { getAuthHeaders } from "@coinbase/cdp-sdk/auth";

/**
 * Build the x402 payment middleware from a list of capability modules.
 *
 * @param {object} opts
 * @param {string} opts.payTo        Receiving wallet address (0x... on Base). MUST be verified-owned.
 * @param {string} opts.network      "base-sepolia" (test, default) or "base" (mainnet, live USDC).
 * @param {string} opts.facilitator  Facilitator URL. Testnet: https://x402.org/facilitator.
 *                                    Mainnet auto-catalog into the Bazaar requires the CDP facilitator.
 * @param {Array}  opts.capabilities Loaded capability modules (see capabilities/_TEMPLATE.js).
 * @returns {Function} express middleware
 */
export function buildPaymentMiddleware({ payTo, network, facilitator, capabilities }) {
  if (!payTo || !/^0x[a-fA-F0-9]{40}$/.test(payTo)) {
    throw new Error(
      "payment.js: WALLET_ADDRESS (payTo) is missing or not a valid 0x EVM address. " +
      "No payment can settle without a verified-owned wallet. Refusing to boot blind."
    );
  }

  // Each capability becomes a paid GET route at /cap/<name>.
  // The `config` block (description + schemas) is what surfaces the route in
  // the x402 Bazaar discovery layer so agents can find and evaluate it.
  // CDP facilitator enforces a 500-char max on the description field in paymentRequirements.
  // Caps with longer descriptions trigger a 400 "invalid_request" at the verify step,
  // causing the middleware to re-issue a 402 with an empty "error": {} body.
  const routeConfig = {};
  for (const cap of capabilities) {
    routeConfig[`GET /cap/${cap.name}`] = {
      price: cap.price,
      network,
      config: {
        description: cap.description.slice(0, 499),
        inputSchema: cap.inputSchema,
        outputSchema: cap.outputSchema,
      },
    };
  }

  // Build the facilitator config. When CDP credentials are present and the
  // facilitator URL is the CDP endpoint, attach createAuthHeaders so the
  // middleware generates fresh JWTs on each verify/settle call.
  const cdpKeyId = process.env.CDP_API_KEY_ID;
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET;
  const isCdpFacilitator = facilitator?.includes("cdp.coinbase.com");

  let facilitatorConfig = { url: facilitator };

  if (isCdpFacilitator && cdpKeyId && cdpKeySecret) {
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

  return paymentMiddleware(payTo, routeConfig, facilitatorConfig);
}

/*
 * ── MIGRATION SHIM (foundation-canonical @x402/express) ───────────────────────
 * When you move to the Linux Foundation packages, replace the import + body above
 * with the pattern below. Nothing else in the codebase changes.
 *
 *   import { paymentMiddleware, x402ResourceServer } from "@x402/express";
 *   import { ExactEvmScheme } from "@x402/evm/exact/server";
 *   import { HTTPFacilitatorClient } from "@x402/core/server";
 *
 *   // network identifiers become CAIP-2: eip155:84532 (Base Sepolia), eip155:8453 (Base mainnet)
 *   const routeConfig = {};
 *   for (const cap of capabilities) {
 *     routeConfig[`GET /cap/${cap.name}`] = {
 *       accepts: { scheme: "exact", price: cap.price, network: caip2(network), payTo },
 *       description: cap.description,
 *       mimeType: "application/json",
 *     };
 *   }
 *   const resourceServer = new x402ResourceServer(
 *     new HTTPFacilitatorClient({ url: facilitator })
 *   ).register("eip155:*", new ExactEvmScheme());
 *   return paymentMiddleware(routeConfig, resourceServer);
 * ──────────────────────────────────────────────────────────────────────────────
 */
