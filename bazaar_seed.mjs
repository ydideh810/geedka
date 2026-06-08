/**
 * bazaar_seed.mjs — One-shot Bazaar seed payment script.
 * Sends $0.001 USDC to /cap/ping via x402 v2 exact EVM scheme
 * to trigger auto-cataloging in the CDP x402 Bazaar.
 *
 * x402 v2 protocol:
 *   402 response: payment requirements in PAYMENT-REQUIRED header (base64 JSON)
 *   Payment:      PAYMENT-SIGNATURE header (base64 JSON of paymentPayload)
 *
 * Run from ~/intuitek/the-stall/ with: node bazaar_seed.mjs
 */

import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const PRIVATE_KEY = process.env.AEGIS_WALLET_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("ERROR: AEGIS_WALLET_PRIVATE_KEY not set");
  process.exit(1);
}

const RESOURCE_URL = "https://the-stall.intuitek.ai/cap/ping";
const RPC_URL = process.env.BASE_RPC_URL || "https://base-rpc.publicnode.com";

function decodeHeader(b64) {
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function main() {
  const account = privateKeyToAccount(`0x${PRIVATE_KEY.replace(/^0x/, "")}`);
  console.log(`Signer: ${account.address}`);

  // ExactEvmScheme reads signer.address + signer.signTypedData directly —
  // a viem LocalAccount (from privateKeyToAccount) satisfies both without WalletClient.
  // Build x402 v2 client — ExactEvmScheme handles eip155:* networks
  const client = new x402Client();
  const evmScheme = new ExactEvmScheme(account);
  client.register("eip155:*", evmScheme);

  // Step 1: fetch 402 to get payment requirements from PAYMENT-REQUIRED header
  console.log(`Fetching payment requirements from ${RESOURCE_URL}...`);
  const r402 = await fetch(RESOURCE_URL);
  if (r402.status !== 402) {
    const body = await r402.text();
    console.error(`Expected 402, got ${r402.status}: ${body}`);
    process.exit(1);
  }

  const paymentRequiredHeader = r402.headers.get("PAYMENT-REQUIRED") || r402.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    console.error("No PAYMENT-REQUIRED header in 402 response. Headers:", [...r402.headers.entries()]);
    process.exit(1);
  }

  const paymentRequired = decodeHeader(paymentRequiredHeader);
  console.log(`x402 version: ${paymentRequired.x402Version}`);
  console.log(`Networks offered: ${paymentRequired.accepts?.map(a => a.network).join(", ")}`);
  const accept = paymentRequired.accepts?.[0];
  if (!accept) {
    console.error("No accepts in payment required:", JSON.stringify(paymentRequired));
    process.exit(1);
  }
  console.log(`Payment required: ${Number(accept.amount) / 1e6} USDC → ${accept.payTo} on ${accept.network}`);

  // Step 2: create signed payment payload using @x402/evm ExactEvmScheme
  console.log("Signing payment...");
  const paymentPayload = await client.createPaymentPayload(paymentRequired);
  const encoded = encodePayload(paymentPayload);
  console.log(`PAYMENT-SIGNATURE length: ${encoded.length} chars`);

  // Step 3: submit with PAYMENT-SIGNATURE header (x402 v2)
  console.log("Submitting paid request...");
  const response = await fetch(`${RESOURCE_URL}?msg=bazaar_seed`, {
    headers: { "PAYMENT-SIGNATURE": encoded },
  });

  const status = response.status;
  const body = await response.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = body; }

  console.log(`Response status: ${status}`);
  console.log(`Response body: ${JSON.stringify(parsed)}`);

  const receiptHeader = response.headers.get("X-PAYMENT-RESPONSE") || response.headers.get("x-payment-response");
  if (receiptHeader) {
    console.log(`Payment receipt header present: ${receiptHeader.slice(0, 100)}...`);
  }

  if (status === 200) {
    console.log("SUCCESS: Payment settled. STALL should now appear in the x402 Bazaar.");
    process.exitCode = 0;
  } else {
    const errorHeader = response.headers.get("PAYMENT-REQUIRED") || response.headers.get("payment-required");
    if (errorHeader) {
      const errDecoded = decodeHeader(errorHeader);
      console.error(`Error from server: ${JSON.stringify(errDecoded, null, 2)}`);
    }
    console.error(`FAILED: Unexpected status ${status}`);
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error("FATAL:", e.message || e);
  process.exit(1);
});
