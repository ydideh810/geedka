/**
 * bazaar_seed.mjs — One-shot Bazaar seed payment script.
 * Sends $0.001 USDC to /cap/ping via the x402 exact EVM scheme
 * to trigger auto-cataloging in the CDP x402 Bazaar.
 *
 * Uses the x402 library already installed in node_modules.
 * Run from ~/intuitek/the-stall/ with: node bazaar_seed.mjs
 */

import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { createPaymentHeader } from "x402/client";

const PRIVATE_KEY = process.env.AEGIS_WALLET_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("ERROR: AEGIS_WALLET_PRIVATE_KEY not set");
  process.exit(1);
}

const RESOURCE_URL = "https://the-stall.intuitek.ai/cap/ping";
const RPC_URL = process.env.BASE_RPC_URL || "https://base-rpc.publicnode.com";

async function main() {
  const account = privateKeyToAccount(`0x${PRIVATE_KEY.replace(/^0x/, "")}`);
  console.log(`Signer: ${account.address}`);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(RPC_URL),
  });

  // Step 1: fetch 402 to get payment requirements
  console.log(`Fetching payment requirements from ${RESOURCE_URL}...`);
  const r402 = await fetch(RESOURCE_URL);
  if (r402.status !== 402) {
    const body = await r402.text();
    console.error(`Expected 402, got ${r402.status}: ${body}`);
    process.exit(1);
  }
  const requirements = await r402.json();
  const paymentReq = requirements.accepts?.[0];
  if (!paymentReq) {
    console.error("No accepts in 402 response:", JSON.stringify(requirements));
    process.exit(1);
  }
  console.log(`Payment required: ${Number(paymentReq.maxAmountRequired) / 1e6} USDC → ${paymentReq.payTo}`);

  // Step 2: build and sign payment header
  console.log("Signing payment...");
  const paymentHeader = await createPaymentHeader(walletClient, requirements.x402Version ?? 1, paymentReq);
  console.log(`Payment header length: ${paymentHeader.length} chars`);

  // Step 3: submit with payment
  console.log("Submitting paid request...");
  const response = await fetch(`${RESOURCE_URL}?msg=bazaar_seed`, {
    headers: { "X-PAYMENT": paymentHeader },
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
    console.error(`FAILED: Unexpected status ${status}`);
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error("FATAL:", e.message || e);
  process.exit(1);
});
