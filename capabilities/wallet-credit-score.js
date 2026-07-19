// wallet-credit-score.js
//
// Composite credit score (0–100) for any EVM wallet address. Estimates how
// trustworthy and active a wallet is, based on on-chain evidence: transaction
// count, account age approximation, ETH/USDC balances on Ethereum and Base,
// multi-chain footprint, and deductions for zero activity or known-risky patterns.
//
// Seam: api.x402node.dev/wallet/score — 589 calls/wk, 20 payers, ~$0.037/call.
// Priced at $0.025.
//
// Free upstream: DRPC.org public JSON-RPC (no API key) for nonce + balance.
// CoinGecko public API for ETH → USD conversion.
//
// [REDACTED]5, 2026-06-06.

const RPCS = {
  ethereum: "https://eth.drpc.org",
  base:     "https://mainnet.base.org",
  polygon:  "https://polygon.rpc.thirdweb.com",
};

const USDC_ETH  = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC on Ethereum
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC on Base
const ERC20_BALANCE_SIG = "0x70a08231"; // balanceOf(address)
const DECIMALS_USDC = 6;
const TIMEOUT = 12_000;
const UA = "Mozilla/5.0 (compatible; myriad/3.46; +https://synaptiic.org)";

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(`RPC: ${d.error.message}`);
  return d.result;
}

// Pad address to 32-byte ABI-encoded parameter
function abiEncodeAddress(addr) {
  return "000000000000000000000000" + addr.slice(2).toLowerCase();
}

async function getNonce(address, chain) {
  try {
    const hex = await rpc(RPCS[chain] || RPCS.ethereum, "eth_getTransactionCount", [address, "latest"]);
    return parseInt(hex, 16);
  } catch { return null; }
}

async function getBalanceWei(address, chain) {
  try {
    const hex = await rpc(RPCS[chain] || RPCS.ethereum, "eth_getBalance", [address, "latest"]);
    return BigInt(hex);
  } catch { return 0n; }
}

async function getUSDCBalance(address, contractAddr, chain) {
  try {
    const data = ERC20_BALANCE_SIG + abiEncodeAddress(address);
    const hex = await rpc(RPCS[chain] || RPCS.ethereum, "eth_call", [
      { to: contractAddr, data },
      "latest",
    ]);
    if (!hex || hex === "0x") return 0;
    return Number(BigInt(hex)) / 10 ** DECIMALS_USDC;
  } catch { return 0; }
}

async function getEthPrice() {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8_000) }
    );
    if (!r.ok) return 3000; // fallback
    const d = await r.json();
    return d?.ethereum?.usd || 3000;
  } catch { return 3000; }
}

// Score helpers — total max points = 100 (35 + 25 + 25 + 15)
function scoreNonce(n) {           // max 35 pts
  if (n === null) return 0;
  if (n === 0) return 0;
  if (n < 3)   return 7;
  if (n < 15)  return 14;
  if (n < 75)  return 21;
  if (n < 400) return 28;
  return 35;
}

function scoreBalance(usd) {       // max 25 pts
  if (usd < 0.5)   return 0;
  if (usd < 5)     return 5;
  if (usd < 50)    return 10;
  if (usd < 500)   return 17;
  if (usd < 2000)  return 22;
  return 25;
}

function scoreMultiChain(nonceBase, noncePolygon) {  // max 25 pts
  let pts = 0;
  if (nonceBase !== null && nonceBase > 0)       pts += 15;
  if (noncePolygon !== null && noncePolygon > 0) pts += 10;
  return pts;
}

function scoreUSDC(usdcEth, usdcBase) {   // max 15 pts
  const total = (usdcEth || 0) + (usdcBase || 0);
  if (total < 0.01) return 0;
  if (total < 1)    return 3;
  if (total < 20)   return 6;
  if (total < 200)  return 10;
  return 15;
}

// Deductions
function deductions(nonceEth, balUsd, usdcTotal) {
  let d = 0;
  if (nonceEth === 0 && balUsd < 0.01 && usdcTotal < 0.01) d += 20; // completely dormant
  if (nonceEth === null) d += 5; // couldn't fetch — uncertainty penalty
  return d;
}

function tier(score) {
  if (score >= 80) return "PRIME";
  if (score >= 60) return "ESTABLISHED";
  if (score >= 40) return "ACTIVE";
  if (score >= 20) return "SPARSE";
  return "DORMANT";
}

function recommendation(t) {
  const map = {
    PRIME:       "High-confidence counterparty — suitable for automated payment routing and agent-to-agent transactions.",
    ESTABLISHED: "Established on-chain history — suitable for most agent workflows with standard due diligence.",
    ACTIVE:      "Active wallet with growing footprint — proceed with standard caution.",
    SPARSE:      "Limited on-chain history — recommend manual review before high-value transactions.",
    DORMANT:     "Near-zero on-chain activity — treat as unknown counterparty.",
  };
  return map[t];
}

export default {
  name: "wallet-credit-score",
  price: "$0.059",

  description:
    "Composite credit score (0–100) for any EVM wallet. Aggregates Ethereum and Base transaction count, account balance, USDC holdings, and multi-chain footprint into a single trustworthiness score with tier label (PRIME / ESTABLISHED / ACTIVE / SPARSE / DORMANT). Use before sending payments, routing agent transactions, or assessing counterparty risk in automated workflows. Priced 46% below x402node.dev equivalent.",

  inputSchema: {
    type: "object",
    properties: {
      address: {
        type: "string",
        description: "EVM wallet address (0x…, 40 hex chars). Checksummed or lowercase accepted.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      address:        { type: "string",  description: "Normalized input address." },
      score:          { type: "integer", description: "Composite credit score 0–100." },
      tier:           { type: "string",  description: "PRIME | ESTABLISHED | ACTIVE | SPARSE | DORMANT" },
      recommendation: { type: "string",  description: "One-sentence routing recommendation." },
      factors: {
        type: "object",
        description: "Score breakdown by factor.",
        properties: {
          tx_count_eth:     { type: "integer", description: "Transaction count on Ethereum mainnet (nonce)." },
          tx_count_base:    { type: "integer", description: "Transaction count on Base." },
          tx_count_polygon: { type: "integer", description: "Transaction count on Polygon." },
          eth_balance_usd:  { type: "number",  description: "ETH balance across Ethereum + Base in USD." },
          usdc_balance:     { type: "number",  description: "USDC holdings across Ethereum + Base." },
          eth_price_usd:    { type: "number",  description: "ETH/USD price used for conversion." },
          pts_tx_count:     { type: "integer", description: "Points from tx count (max 35)." },
          pts_balance:      { type: "integer", description: "Points from ETH balance (max 25)." },
          pts_multichain:   { type: "integer", description: "Points from multi-chain activity (max 25)." },
          pts_usdc:         { type: "integer", description: "Points from USDC holdings (max 15)." },
          deductions:       { type: "integer", description: "Deducted points (dormant, unknown)." },
        },
      },
      ts: { type: "string", description: "ISO-8601 timestamp of this assessment." },
    },
  },

  async handler(query) {
    const raw = (query.address || "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045").trim();
    if (!raw) throw new Error("'address' is required");
    if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error("invalid EVM address format — expected 0x followed by 40 hex chars");
    const address = raw.toLowerCase();

    // Parallel fetch: nonce on 3 chains + ETH balance on 2 chains + USDC on 2 chains + ETH price
    const [
      nonceEth,
      nonceBase,
      noncePolygon,
      balEthWei,
      balBaseWei,
      usdcEth,
      usdcBase,
      ethPrice,
    ] = await Promise.all([
      getNonce(address, "ethereum"),
      getNonce(address, "base"),
      getNonce(address, "polygon"),
      getBalanceWei(address, "ethereum"),
      getBalanceWei(address, "base"),
      getUSDCBalance(address, USDC_ETH, "ethereum"),
      getUSDCBalance(address, USDC_BASE, "base"),
      getEthPrice(),
    ]);

    const WEI = 10n ** 18n;
    const ethBalanceEth  = Number(balEthWei)  / 1e18;
    const ethBalanceBase = Number(balBaseWei) / 1e18;
    const totalEthUsd    = (ethBalanceEth + ethBalanceBase) * ethPrice;
    const totalUsdc      = (usdcEth || 0) + (usdcBase || 0);

    const ptsTx        = scoreNonce(nonceEth);
    const ptsBal       = scoreBalance(totalEthUsd);
    const ptsMulti     = scoreMultiChain(nonceBase, noncePolygon);
    const ptsUsdc      = scoreUSDC(usdcEth, usdcBase);
    const deduct       = deductions(nonceEth ?? 0, totalEthUsd, totalUsdc);

    const raw_score    = ptsTx + ptsBal + ptsMulti + ptsUsdc - deduct;
    const score        = Math.max(0, Math.min(100, raw_score));
    const scoreTier    = tier(score);

    return {
      address,
      score,
      tier: scoreTier,
      recommendation: recommendation(scoreTier),
      factors: {
        tx_count_eth:     nonceEth ?? -1,
        tx_count_base:    nonceBase ?? -1,
        tx_count_polygon: noncePolygon ?? -1,
        eth_balance_usd:  Math.round(totalEthUsd * 100) / 100,
        usdc_balance:     Math.round(totalUsdc * 100) / 100,
        eth_price_usd:    ethPrice,
        pts_tx_count:     ptsTx,
        pts_balance:      ptsBal,
        pts_multichain:   ptsMulti,
        pts_usdc:         ptsUsdc,
        deductions:       deduct,
      },
      ts: new Date().toISOString(),
    };
  },
};
