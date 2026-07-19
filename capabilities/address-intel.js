// address-intel.js
//
// On-chain wallet intelligence for any Base network address.
// Classifies EOA vs contract, profiles USDC transfer activity, scores payer
// diversity (distinct counterparties / total transfers), detects sybil
// vanity-lookalike address pairs (same first-4 + last-4 hex, different middle),
// and identifies x402 facilitator SKIM legs (same-block receive+re-send).
//
// Three modes via the `mode` parameter:
//   quick    : address type, nonce, USDC balance, 24h USDC transfer summary
//   standard : + full USDC transfer history, payer diversity score, counterparty map
//   deep     : + sybil/vanity-lookalike detection, SKIM-leg pattern, risk label
//
// Runtime-capture seam: agent pipelines that qualify or classify a counterparty
// wallet before committing to a transaction or interpreting settlement data.
// Designed for x402 counterparty trust scoring (t54 category).
// Zero data COGS — Base public JSON-RPC only, no API key required.
//
// RPC pool: base-rpc.publicnode.com + 1rpc.io/base + base.drpc.org (3-way rotation).
// USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913.
// Price: $0.050.

const UA             = "Mozilla/5.0 (compatible; myriad/4.69; +https://synaptiic.org)";
const TIMEOUT        = 15_000;
const USDC_BASE      = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f202e161af3603141f5d74c1a5";
const USDC_DECIMALS  = 6;

// Base ≈ 2s/block: 43200 ≈ 24h, 302400 ≈ 7d
const BLOCKS_24H = 43_200;
const BLOCKS_7D  = 302_400;

const RPC_POOL = [
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
  "https://base.drpc.org",
];
let _rpcIdx = 0;

async function rpc(method, params, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const url = RPC_POOL[(_rpcIdx + attempt) % RPC_POOL.length];
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
      _rpcIdx = (_rpcIdx + attempt) % RPC_POOL.length;
      return d.result;
    } catch (e) {
      if (attempt === retries) throw e;
    }
  }
}

function padAddress(addr) {
  return "0x" + "000000000000000000000000" + addr.slice(2).toLowerCase();
}

function unpadAddress(padded) {
  return "0x" + padded.slice(-40).toLowerCase();
}

function hexToUsdc(hex) {
  if (!hex || hex === "0x") return 0;
  return Number(BigInt(hex)) / 10 ** USDC_DECIMALS;
}

function hexToInt(hex) {
  if (!hex || hex === "0x") return 0;
  return parseInt(hex, 16);
}

function r4(n) { return Math.round(n * 10000) / 10000; }
function r2(n) { return Math.round(n * 100) / 100; }

function parseTransferLog(log) {
  const from  = unpadAddress(log.topics[1]);
  const to    = unpadAddress(log.topics[2]);
  const value = hexToUsdc(log.data);
  return {
    from,
    to,
    value_usdc: r4(value),
    block:      hexToInt(log.blockNumber),
    tx:         log.transactionHash,
  };
}

// Detect vanity-lookalike clusters: same first-4 + last-4 hex chars of address body.
// Used for address-spoofing and sybil consolidation obfuscation.
function detectVanityLookalikes(addresses) {
  const byFp = {};
  for (const addr of addresses) {
    const a  = addr.toLowerCase();
    const fp = a.slice(2, 6) + a.slice(-4);
    if (!byFp[fp]) byFp[fp] = [];
    byFp[fp].push(addr);
  }
  return Object.entries(byFp)
    .filter(([, group]) => group.length >= 2)
    .map(([fp, addresses]) => ({ fingerprint: fp, addresses, count: addresses.length }));
}

// Detect SKIM legs: address received USDC and re-sent in the same block.
function detectSkimLegs(received, sent) {
  const recvByBlock = {};
  for (const t of received) {
    if (!recvByBlock[t.block]) recvByBlock[t.block] = [];
    recvByBlock[t.block].push(t);
  }
  return sent
    .filter(t => recvByBlock[t.block]?.length > 0)
    .map(t => ({
      block:          t.block,
      received_from:  recvByBlock[t.block].map(r => r.from),
      received_usdc:  r4(recvByBlock[t.block].reduce((s, r) => s + r.value_usdc, 0)),
      sent_to:        t.to,
      sent_usdc:      t.value_usdc,
      tx_sent:        t.tx,
    }));
}

async function classifyAddress(addr) {
  try {
    const code = await rpc("eth_getCode", [addr, "latest"]);
    return code && code !== "0x" ? "contract" : "eoa";
  } catch { return "unknown"; }
}

async function getNonce(addr) {
  try {
    const hex = await rpc("eth_getTransactionCount", [addr, "latest"]);
    return hexToInt(hex);
  } catch { return null; }
}

async function getUSDCBalance(addr) {
  try {
    const data = "0x70a08231" + padAddress(addr).slice(2);
    const hex  = await rpc("eth_call", [{ to: USDC_BASE, data }, "latest"]);
    return hexToUsdc(hex);
  } catch { return null; }
}

async function getBlockNumber() {
  const hex = await rpc("eth_blockNumber", []);
  return hexToInt(hex);
}

async function getTransferLogs(addr, fromBlock, toBlock, direction) {
  const topicAddr = padAddress(addr);
  const topics    = direction === "sent"
    ? [TRANSFER_TOPIC, topicAddr, null]
    : [TRANSFER_TOPIC, null, topicAddr];

  try {
    const logs = await rpc("eth_getLogs", [{
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock:   "0x" + toBlock.toString(16),
      address:   USDC_BASE,
      topics,
    }]);
    return Array.isArray(logs) ? logs.map(parseTransferLog) : [];
  } catch (e) {
    // Split range on limit errors
    if (e.message && (e.message.includes("limit") || e.message.includes("range") || e.message.includes("too many"))) {
      const mid = Math.floor((fromBlock + toBlock) / 2);
      if (mid === fromBlock) return [];
      const [a, b] = await Promise.all([
        getTransferLogs(addr, fromBlock, mid, direction),
        getTransferLogs(addr, mid + 1, toBlock, direction),
      ]);
      return [...a, ...b];
    }
    throw e;
  }
}

function buildDiversityScore(senderSet, totalReceived) {
  if (totalReceived === 0) return 0;
  const distinct = senderSet.size;
  const ratio    = distinct / totalReceived;
  return Math.min(100, Math.round((distinct * 2 + ratio * 100) / 3));
}

function interpretDiversity(score) {
  if (score >= 70) return "HIGH_DIVERSITY — diverse organic payer pattern";
  if (score >= 40) return "MEDIUM_DIVERSITY — moderate counterparty spread";
  if (score >= 10) return "LOW_DIVERSITY — few distinct counterparties";
  return "SINGLE_PARTY — concentrated or automated single payer";
}

function computeRiskLabel(divScore, received, sent, lookalikes, skimLegs, nonce) {
  if (skimLegs.length > 0 && sent.length > 0) {
    const skimPct = skimLegs.length / sent.length;
    return skimPct > 0.5 ? "FACILITATOR_SKIM" : "FACILITATOR_SKIM_PARTIAL";
  }
  if (lookalikes.length >= 2) return "SYBIL_CLUSTER";
  if (divScore < 10 && received.length > 20) return "SEEDER_PATTERN";
  if (divScore >= 70 && received.length >= 5) return "ORGANIC";
  if (received.length === 0 && nonce !== null && nonce < 5) return "FRESH_WALLET";
  if (received.length === 0 && (nonce === null || nonce === 0)) return "INACTIVE";
  return "ORGANIC_LIKELY";
}

export default {
  name:  "address-intel",
  price: "$0.050",

  description:
    "On-chain intelligence for any Base network wallet. Classifies EOA vs contract, profiles USDC transfer activity over a configurable block window, scores payer diversity (distinct counterparties / total transfers, 0–100), detects sybil vanity-lookalike address clusters (same first-4 + last-4 hex chars), identifies x402 facilitator SKIM legs (same-block receive+re-send), and assigns a risk label (ORGANIC / ORGANIC_LIKELY / SEEDER_PATTERN / FACILITATOR_SKIM / SYBIL_CLUSTER / FRESH_WALLET / INACTIVE). Three modes: quick (address type+balance+24h USDC summary), standard (+full transfer history+diversity score), deep (+sybil/SKIM detection+risk label). Zero data COGS — Base public RPC only.",

  inputSchema: {
    type: "object",
    properties: {
      address: {
        type: "string",
        description:
          "Base wallet address to analyze (0x-prefixed, 42 hex chars). EOA or contract. Example: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        pattern: "^0x[a-fA-F0-9]{40}$",
      },
      mode: {
        type: "string",
        enum: ["quick", "standard", "deep"],
        description:
          "Analysis depth. quick: address type + USDC balance + 24h USDC summary. standard: + full USDC transfer history + diversity score + counterparty map. deep: + sybil vanity-lookalike detection + SKIM-leg detection + risk label. Default: standard.",
        default: "standard",
      },
      lookback_blocks: {
        type: "integer",
        description:
          "Block window for USDC transfer history (standard and deep modes). Base ≈ 2s/block: 43200 ≈ 24h, 302400 ≈ 7d. Default 43200. Max 302400.",
        default: 43200,
        minimum: 1000,
        maximum: 302400,
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      address:            { type: "string" },
      address_type:       { type: "string" },
      nonce:              { type: ["integer", "null"] },
      usdc_balance:       { type: ["number", "null"] },
      mode:               { type: "string" },
      lookback_blocks:    { type: "integer" },
      block_range:        { type: "object" },
      summary:            { type: "object" },
      transfers_received: { type: "array" },
      transfers_sent:     { type: "array" },
      counterparties:     { type: "object" },
      diversity:          { type: "object" },
      sybil_lookalikes:   { type: "array" },
      skim_legs:          { type: "array" },
      risk_label:         { type: "string" },
    },
    required: [],
  },

  async handler(input) {
    const addr     = (input.address || "0xd8da6bf26964af9d7eed9e03e53415d37aa96045").toLowerCase();
    const mode     = ["quick", "standard", "deep"].includes(input.mode) ? input.mode : "standard";
    const lookback = Math.min(Math.max(parseInt(input.lookback_blocks ?? BLOCKS_24H, 10), 1000), BLOCKS_7D);

    // Phase 1: fundamentals (all modes)
    const [addrType, nonce, usdcBal, currentBlock] = await Promise.all([
      classifyAddress(addr),
      getNonce(addr),
      getUSDCBalance(addr),
      getBlockNumber(),
    ]);

    const fromBlock = Math.max(0, currentBlock - lookback);

    const result = {
      address:         addr,
      address_type:    addrType,
      nonce,
      usdc_balance:    usdcBal != null ? r4(usdcBal) : null,
      mode,
      lookback_blocks: lookback,
      block_range:     { from: fromBlock, to: currentBlock },
    };

    if (mode === "quick") {
      const win24h = Math.min(lookback, BLOCKS_24H);
      const from24 = Math.max(0, currentBlock - win24h);
      const [recv, sent] = await Promise.all([
        getTransferLogs(addr, from24, currentBlock, "received"),
        getTransferLogs(addr, from24, currentBlock, "sent"),
      ]);
      result.summary = {
        window:           "24h",
        received_count:   recv.length,
        received_usdc:    r4(recv.reduce((s, t) => s + t.value_usdc, 0)),
        sent_count:       sent.length,
        sent_usdc:        r4(sent.reduce((s, t) => s + t.value_usdc, 0)),
        unique_senders:   new Set(recv.map(t => t.from)).size,
        unique_receivers: new Set(sent.map(t => t.to)).size,
      };
      return result;
    }

    // Phase 2: full transfer history (standard + deep)
    const [received, sent] = await Promise.all([
      getTransferLogs(addr, fromBlock, currentBlock, "received"),
      getTransferLogs(addr, fromBlock, currentBlock, "sent"),
    ]);

    const recvSorted = received.slice().sort((a, b) => b.block - a.block).slice(0, 100);
    const sentSorted = sent.slice().sort((a, b) => b.block - a.block).slice(0, 100);

    const sendersMap = {};
    for (const t of received) {
      if (!sendersMap[t.from]) sendersMap[t.from] = { calls: 0, total_usdc: 0 };
      sendersMap[t.from].calls++;
      sendersMap[t.from].total_usdc = r4(sendersMap[t.from].total_usdc + t.value_usdc);
    }
    const receiversMap = {};
    for (const t of sent) {
      if (!receiversMap[t.to]) receiversMap[t.to] = { calls: 0, total_usdc: 0 };
      receiversMap[t.to].calls++;
      receiversMap[t.to].total_usdc = r4(receiversMap[t.to].total_usdc + t.value_usdc);
    }

    const senderSet    = new Set(received.map(t => t.from));
    const receiverSet  = new Set(sent.map(t => t.to));
    const totalRecvUSD = r4(received.reduce((s, t) => s + t.value_usdc, 0));
    const totalSentUSD = r4(sent.reduce((s, t) => s + t.value_usdc, 0));
    const divScore     = buildDiversityScore(senderSet, received.length);

    result.summary = {
      lookback_blocks:  lookback,
      received_count:   received.length,
      received_usdc:    totalRecvUSD,
      sent_count:       sent.length,
      sent_usdc:        totalSentUSD,
      unique_senders:   senderSet.size,
      unique_receivers: receiverSet.size,
      net_flow_usdc:    r4(totalRecvUSD - totalSentUSD),
    };
    result.transfers_received = recvSorted;
    result.transfers_sent     = sentSorted;
    result.counterparties     = { senders: sendersMap, receivers: receiversMap };
    result.diversity          = {
      score:           divScore,
      unique_senders:  senderSet.size,
      unique_receivers: receiverSet.size,
      total_received:  received.length,
      interpretation:  interpretDiversity(divScore),
    };

    if (mode === "standard") return result;

    // Phase 3: sybil + SKIM + risk label (deep only)
    const allCounterparties = [...senderSet, ...receiverSet];
    const lookalikes = detectVanityLookalikes(allCounterparties);
    const skimLegs   = detectSkimLegs(received, sent);

    result.sybil_lookalikes = lookalikes;
    result.skim_legs        = skimLegs;
    result.risk_label       = computeRiskLabel(divScore, received, sent, lookalikes, skimLegs, nonce);
    return result;
  },
};
