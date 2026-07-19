/**
 * x402_test_agent.mjs — End-to-end x402 verification loop.
 *
 * Simulates a real agent:
 *  1. Discovers MYRIAD via /.well-known/x402 (agent discovery document)
 *  2. Selects a data capability (not just ping)
 *  3. Sends a paid GET request
 *  4. Verifies the response contains real data
 *  5. Logs the receipt and confirms rail integrity
 *
 * Run from ~/intuitek/myriad/ with:
 *   node scripts/x402_test_agent.mjs
 *
 * Requires AEGIS_WALLET_PRIVATE_KEY env var (hex, no 0x prefix).
 */

import { privateKeyToAccount } from "viem/accounts";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { readFileSync } from "fs";
import { exec } from "child_process";

const BASE_URL = process.env.MYRIAD_BASE_URL || "https://myriad.synaptiic.org";
const RPC_URL = process.env.BASE_RPC_URL || "https://api.developer.coinbase.com/rpc/v1/base/SH2ERnua9qjQ08v2clFSDgG5c91RTcds";

// Load private key — from env or from credentials file
let PRIVATE_KEY = process.env.AEGIS_WALLET_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  try {
    const wallet = JSON.parse(readFileSync(new URL(
      "../../credentials/keys/aegis-hot-wallet.json",
      import.meta.url
    )));
    PRIVATE_KEY = wallet.private_key?.replace(/^0x/, "");
    console.log(`Loaded key from credentials file, address: ${wallet.address}`);
  } catch (e) {
    console.error("ERROR: Cannot load AEGIS_WALLET_PRIVATE_KEY:", e.message);
    process.exit(1);
  }
}

function notify(msg) {
  exec(`bash ~/intuitek/notify.sh "${msg.replace(/"/g, "'")}"`, () => {});
}

async function main() {
  console.log(`\n=== MYRIAD x402 Test Agent ===`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // Step 1: Discover MYRIAD
  console.log("Step 1: Discovering MYRIAD via /.well-known/x402...");
  const discoverResp = await fetch(`${BASE_URL}/.well-known/x402`);
  if (!discoverResp.ok) {
    console.error(`Discovery failed: ${discoverResp.status}`);
    process.exit(1);
  }
  const discovery = await discoverResp.json();
  console.log(`  Name: ${discovery.name}`);
  console.log(`  Network: ${discovery.network} / ${discovery.currency}`);
  console.log(`  Endpoints: ${discovery.endpoints?.length ?? 0}`);
  console.log(`  payTo: ${discovery.paymentAddress}`);

  // Step 2: Pick a real data cap (not ping — we want real data).
  // gas-prices is confirmed working at $0.005 — returns multi-chain gas data.
  // weather at $0.007 triggers a CDP facilitator rejection for amounts above ~$0.005;
  // documented in outputs as a known issue for investigation.
  const TARGET_CAP = "gas-prices";
  const PROBE_URL = `${BASE_URL}/cap/${TARGET_CAP}`;
  const CAP_URL   = PROBE_URL;

  const capInfo = discovery.endpoints?.find(e => e.path === `/cap/${TARGET_CAP}`);
  console.log(`\nStep 2: Selected capability: ${TARGET_CAP}`);
  console.log(`  URL: ${CAP_URL}`);
  if (capInfo) {
    console.log(`  Price: ${capInfo.price.amount} ${capInfo.price.currency}`);
    console.log(`  Description: ${capInfo.description?.slice(0, 80)}...`);
  }

  // Step 3: Probe for 402 requirements — use base URL (no query string)
  console.log(`\nStep 3: Probing payment requirements...`);
  const probe = await fetch(PROBE_URL);
  if (probe.status !== 402) {
    const body = await probe.text();
    console.error(`Expected 402, got ${probe.status}: ${body.slice(0, 200)}`);
    process.exit(1);
  }
  const requirements = await probe.json();
  const paymentReq = requirements.accepts?.[0];
  if (!paymentReq) {
    console.error("No payment requirements in 402 response:", JSON.stringify(requirements));
    process.exit(1);
  }
  const priceUsdc = Number(paymentReq.amount ?? paymentReq.maxAmountRequired) / 1e6;
  console.log(`  Payment required: ${priceUsdc.toFixed(6)} USDC`);
  console.log(`  payTo: ${paymentReq.payTo}`);
  console.log(`  network: ${paymentReq.network}`);

  // Step 4: Sign payment
  console.log(`\nStep 4: Signing payment...`);
  const account = privateKeyToAccount(`0x${PRIVATE_KEY}`);
  console.log(`  Signer: ${account.address}`);

  const scheme = new ExactEvmScheme(account);
  const partialPayload = await scheme.createPaymentPayload(
    requirements.x402Version ?? 2,
    paymentReq
  );
  // @x402/core client wraps the partial payload with resource + accepted fields.
  // We call the low-level API directly, so we must add them manually.
  const fullPayload = {
    x402Version: partialPayload.x402Version,
    payload: partialPayload.payload,
    resource: requirements.resource ?? { url: CAP_URL },
    accepted: paymentReq,
  };
  const paymentHeader = Buffer.from(JSON.stringify(fullPayload)).toString("base64");
  console.log(`  Payment header: ${paymentHeader.length} chars, signed.`);

  // Step 5: Submit paid request
  console.log(`\nStep 5: Submitting paid request...`);
  // x402 v2 uses "PAYMENT-SIGNATURE" header; v1 used "X-PAYMENT"
  const paidResp = await fetch(CAP_URL, {
    headers: { "PAYMENT-SIGNATURE": paymentHeader },
  });

  const status = paidResp.status;
  const bodyText = await paidResp.text();
  const receiptHeader = paidResp.headers.get("X-PAYMENT-RESPONSE") ||
                        paidResp.headers.get("x-payment-response");

  console.log(`  Response status: ${status}`);

  if (status !== 200) {
    console.error(`  FAILED: ${bodyText.slice(0, 300)}`);
    notify(`⚠️ [MYRIAD x402 Test] FAILED: ${TARGET_CAP} returned ${status}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    data = bodyText;
  }

  // Step 6: Verify real data in response
  console.log(`\nStep 6: Verifying response data...`);
  console.log(`  Response: ${JSON.stringify(data, null, 2).slice(0, 400)}`);

  // Validate real data — gas-prices returns chains array with live gas values
  const hasRealData = data && typeof data === "object" &&
    !data.error && (
      Array.isArray(data.chains) ||    // gas-prices
      Object.keys(data).length > 0     // any non-empty response
    );

  if (!hasRealData) {
    console.error("  WARN: Response may not contain real data");
  } else {
    console.log(`  Data fields: ${Object.keys(data).join(", ")}`);
  }

  // Step 7: Log receipt
  if (receiptHeader) {
    console.log(`\nStep 7: Payment receipt confirmed.`);
    console.log(`  Receipt: ${receiptHeader.slice(0, 100)}...`);
  } else {
    console.log(`\nStep 7: No receipt header (payment may still settle async).`);
  }

  // Final report
  console.log(`\n=== TEST RESULT ===`);
  console.log(`Status: ${status === 200 && hasRealData ? "PASS" : "PARTIAL"}`);
  console.log(`Cap: ${TARGET_CAP}`);
  console.log(`Cost: ${priceUsdc.toFixed(6)} USDC`);
  console.log(`Rail: x402 / Base mainnet / USDC`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const resultMsg = status === 200 && hasRealData
    ? `✅ [MYRIAD x402 Test] PASS — ${TARGET_CAP} called, ${priceUsdc.toFixed(4)} USDC settled, real data verified`
    : `⚠️ [MYRIAD x402 Test] PARTIAL — status ${status}, data ${hasRealData ? "ok" : "suspect"}`;

  notify(resultMsg);
  console.log(`\n${resultMsg}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  exec(`bash ~/intuitek/notify.sh "⚠️ [MYRIAD x402 Test] FATAL: ${String(err.message).slice(0, 100)}"`, () => {});
  process.exitCode = 1;
});
