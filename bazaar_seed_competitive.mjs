/**
 * bazaar_seed_competitive.mjs — seed high-priority unseeded caps into CDP Bazaar.
 *
 * Targets capabilities that compete directly with top-earning x402 services
 * (blockrun.ai, orbisapi, onesource.io) but haven't been seeded yet.
 * Running this ensures CDP Bazaar has verified settlement records for each cap
 * so agents with proven demand can discover them.
 *
 * Competitive rationale (from archive.db analysis 2026-06-09):
 *   us-stock-history: blockrun earned $1,445/93K calls @ $0.0155 — STALL at $0.0009 (17x cheaper)
 *   crypto-news-impact: orbisapi dead (2026-06-09), 6-8 wallets need alternative
 *   block-intel: onesource.io seam, STALL 33% cheaper at $0.002
 *   defi-state-pack: multi-protocol DeFi snapshot, no direct competitor indexed
 *   funding-rates: crypto trader essential, not covered by other x402 services
 *   stablecoin-watch: $1B+ market tracking, zero x402 alternatives found
 *   eth-block: raw block data, complements block-intel for Ethereum/Base
 *   global-news-intel: $0.003/call, no x402 news service this cheap
 *
 * Run: cd ~/intuitek/the-stall && node bazaar_seed_competitive.mjs
 */

import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { readFileSync } from "fs";
import { exec } from "child_process";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { encodePaymentSignatureHeader, decodePaymentRequiredHeader } from "@x402/core/http";

const BASE_URL = process.env.STALL_BASE_URL || "https://the-stall.intuitek.ai";
const RPC_URL = process.env.BASE_RPC_URL || "https://api.developer.coinbase.com/rpc/v1/base/SH2ERnua9qjQ08v2clFSDgG5c91RTcds";

// Competitive gap caps — none of these are in the existing bazaar_seed_batch.mjs
// Format: [capName, queryParams]
const TARGET_CAPS = [
  ["us-stock-history",   "ticker=AAPL&resolution=D"],
  ["crypto-news-impact", "limit=5"],
  ["block-intel",        "network=base"],
  ["defi-state-pack",    ""],
  ["funding-rates",      ""],
  ["stablecoin-watch",   ""],
  ["eth-block",          "network=base"],
  ["global-news-intel",  "query=crypto+markets"],
  ["macro-indicators",   ""],
  ["sector-rotation",    ""],
];

let PRIVATE_KEY = process.env.AEGIS_WALLET_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  try {
    const w = JSON.parse(readFileSync(new URL("../credentials/keys/aegis-hot-wallet.json", import.meta.url)));
    PRIVATE_KEY = w.private_key;
    console.log(`Loaded wallet: ${w.address}`);
  } catch (e) {
    console.error("Cannot load private key:", e.message);
    process.exit(1);
  }
}

function notify(msg) {
  exec(`bash ~/intuitek/notify.sh "${msg.replace(/"/g, "'")}"`, () => {});
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function seedCap(signer, evmScheme, capName, params = "") {
  const url = `${BASE_URL}/cap/${capName}`;

  const probeResp = await fetch(url);
  if (probeResp.status !== 402) {
    return { cap: capName, status: "skip", reason: `Got ${probeResp.status} not 402` };
  }

  const prHeader = probeResp.headers.get("payment-required");
  if (!prHeader) {
    return { cap: capName, status: "skip", reason: "No payment-required header" };
  }

  const requirements = decodePaymentRequiredHeader(prHeader);
  const payReq = requirements.accepts?.[0];
  if (!payReq) {
    return { cap: capName, status: "skip", reason: "No accepts" };
  }

  const partialPayload = await evmScheme.createPaymentPayload(requirements.x402Version, payReq);
  const paymentPayload = {
    x402Version: partialPayload.x402Version,
    payload: partialPayload.payload,
    resource: requirements.resource,
    accepted: payReq,
  };

  const paymentHeader = encodePaymentSignatureHeader(paymentPayload);

  const queryStr = params ? `${params}&msg=bazaar_seed_competitive` : "msg=bazaar_seed_competitive";
  const paidResp = await fetch(`${url}?${queryStr}`, {
    headers: {
      "X-PAYMENT": paymentHeader,
      "PAYMENT-SIGNATURE": paymentHeader,
    },
  });

  const statusCode = paidResp.status;
  const bodyText = await paidResp.text();
  let data;
  try { data = JSON.parse(bodyText); } catch { data = bodyText; }

  const amount = Number(payReq.amount) / 1e6;
  return {
    cap: capName,
    status: statusCode === 200 ? "ok" : "fail",
    statusCode,
    amount_usd: amount,
    response: typeof data === "object" ? Object.keys(data).join(",") : String(data).slice(0, 60),
  };
}

async function main() {
  console.log(`\n=== STALL CDP Bazaar Competitive Seed ===`);
  console.log(`Seeding ${TARGET_CAPS.length} capabilities (competitive gap coverage)`);

  const account = privateKeyToAccount(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);
  console.log(`Signer: ${account.address}\n`);

  const walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL) });
  const signer = {
    address: account.address,
    signTypedData: (args) => walletClient.signTypedData(args),
  };
  const evmScheme = new ExactEvmScheme(signer);

  const results = [];
  let totalSpent = 0;

  for (const [cap, params] of TARGET_CAPS) {
    process.stdout.write(`  Seeding ${cap}... `);
    try {
      const result = await seedCap(signer, evmScheme, cap, params);
      results.push(result);
      if (result.status === "ok") {
        totalSpent += result.amount_usd;
        console.log(`✅ $${result.amount_usd.toFixed(4)} (${result.response})`);
      } else {
        console.log(`⚠️ ${result.reason || result.statusCode}`);
      }
    } catch (e) {
      console.log(`❌ ${e.message?.slice(0, 80)}`);
      results.push({ cap, status: "error", reason: e.message });
    }
    await sleep(1500);
  }

  const ok = results.filter(r => r.status === "ok").length;
  const failedCaps = results.filter(r => r.status !== "ok").map(r => `${r.cap}(${r.statusCode || r.reason})`).join(", ");

  console.log(`\n=== RESULTS ===`);
  console.log(`Seeded: ${ok}/${TARGET_CAPS.length} capabilities`);
  if (failedCaps) console.log(`Failed/Skipped: ${failedCaps}`);
  console.log(`Total spent: $${totalSpent.toFixed(4)} USDC`);
  console.log(`CDP Bazaar indexing: 24-48h (async)`);

  if (ok > 0) {
    notify(`✅ [STALL Competitive Seed] ${ok}/${TARGET_CAPS.length} caps seeded — $${totalSpent.toFixed(4)} USDC — CDP Bazaar indexing 24-48h`);
    process.exitCode = 0;
  } else {
    notify(`⚠️ [STALL Competitive Seed] All ${TARGET_CAPS.length} seeds failed`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error("Fatal:", err.stack || err);
  notify(`⚠️ [STALL Competitive Seed] FATAL: ${String(err.message || err).slice(0, 100)}`);
  process.exitCode = 1;
});
