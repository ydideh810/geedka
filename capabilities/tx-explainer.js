// tx-explainer.js
//
// Decodes and explains a blockchain transaction in one call.
// Collapses the observed seam: x402.ottoai.services/tx-explainer ($0.0164 avg) +
// skills.onesource.io chain block query ($0.004 avg) — 18 distinct wallets,
// 7-day persistence, signal-intel signal 52760, strength 1.0.
// Priced at $0.014 (70% of $0.020 combined chain).
//
// Free upstream: public JSON-RPC nodes (drpc.org) — no API key required.

const CHAINS = {
  ethereum: "https://eth.drpc.org",
  base:     "https://base.drpc.org",
  polygon:  "https://polygon.drpc.org",
  arbitrum: "https://arbitrum.drpc.org",
};

const METHOD_SELECTORS = {
  "0xa9059cbb": "transfer",
  "0x23b872dd": "transferFrom",
  "0x095ea7b3": "approve",
  "0x40c10f19": "mint",
  "0x42966c68": "burn",
  "0x7ff36ab5": "swapExactETHForTokens",
  "0x18cbafe5": "swapExactTokensForETH",
  "0x38ed1739": "swapExactTokensForTokens",
  "0x5c11d795": "swapExactTokensForTokensSupportingFeeOnTransfer",
  "0xfb3bdb41": "swapETHForExactTokens",
  "0xd0e30db0": "deposit",
  "0x2e1a7d4d": "withdraw",
  "0xe8e33700": "addLiquidity",
  "0x02751cec": "removeLiquidityETH",
  "0x6a761202": "execTransaction",
  "0x12aa3caf": "swap",        // 1inch
  "0xe449022e": "uniswapV3Swap",
  "0xac9650d8": "multicall",
};

const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function rpc(url, method, params) {
  const resp = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal:  AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.error) throw new Error(`RPC: ${d.error.message}`);
  return d.result;
}

function hexToInt(hex) {
  if (!hex) return null;
  return parseInt(hex, 16);
}

function hexToEth(hex) {
  if (!hex || hex === "0x0" || hex === "0x") return 0;
  return parseInt(hex, 16) / 1e18;
}

function hexToGwei(hex) {
  if (!hex) return null;
  return parseInt(hex, 16) / 1e9;
}

function decodeTransferTo(input) {
  // transfer(address,uint256): selector(4) + address(32) + uint256(32)
  if (!input || input.length < 138) return null;
  const addrPad = input.slice(10, 74);
  const amtHex  = input.slice(74, 138);
  const to      = "0x" + addrPad.slice(24);
  let amount_raw;
  try { amount_raw = BigInt("0x" + amtHex).toString(); } catch (_) { amount_raw = "0"; }
  return { to, amount_raw };
}

export default {
  name:  "tx-explainer",
  price: "$0.014",

  description:
    "Given a transaction hash and chain, returns a decoded breakdown: sender, recipient, ETH value transferred, gas used, transaction fee, decoded method name (transfer/approve/swap/deposit/etc.), ERC-20 token transfer details if applicable, block number, block timestamp, and a one-sentence agent-readable summary. Supports Ethereum (default), Base, Polygon, and Arbitrum mainnet. Uses free public JSON-RPC nodes — no API key required, results in ~1-2s.",

  inputSchema: {
    type: "object",
    properties: {
      tx_hash: {
        type:        "string",
        description: "Transaction hash — 0x-prefixed, 66 characters total.",
      },
      chain: {
        type:        "string",
        enum:        ["ethereum", "base", "polygon", "arbitrum"],
        description: "Chain to query. Default: ethereum.",
      },
    },
    required:             ["tx_hash"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      hash:           { type: "string",            description: "Transaction hash." },
      chain:          { type: "string",            description: "Chain queried." },
      status:         { type: "string", enum: ["success","failed","pending"], description: "Execution status." },
      block_number:   { type: ["integer","null"],  description: "Block number, null if pending." },
      timestamp:      { type: ["string","null"],   description: "ISO-8601 block timestamp, null if pending." },
      from:           { type: "string",            description: "Sender address." },
      to:             { type: ["string","null"],   description: "Recipient address (contract or EOA); null for contract creation." },
      value_eth:      { type: "number",            description: "ETH value transferred (does not include gas fee)." },
      gas_used:       { type: ["integer","null"],  description: "Gas units consumed." },
      gas_price_gwei: { type: ["number","null"],   description: "Gas price in Gwei." },
      fee_eth:        { type: ["number","null"],   description: "Transaction fee in ETH (gas_used × gas_price)." },
      method:         { type: ["string","null"],   description: "Decoded method name if recognized, 4-byte selector if not, null for plain ETH transfer." },
      erc20_transfer: {
        type: ["object","null"],
        description: "ERC-20 token transfer details, null if not a token transfer.",
        properties: {
          token_contract: { type: "string", description: "Token contract address." },
          to:             { type: "string", description: "Token recipient." },
          amount_raw:     { type: "string", description: "Raw token amount (before applying decimals)." },
        },
      },
      summary: { type: "string", description: "One-sentence agent-readable description of what this transaction did." },
      ts:      { type: "string", description: "ISO-8601 timestamp of this response." },
    },
  },

  async handler(query) {
    const tx_hash = (query.tx_hash || "").trim().toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(tx_hash)) {
      throw new Error("tx_hash must be a 0x-prefixed 64-hex-char transaction hash");
    }
    const chain  = (query.chain || "ethereum").toLowerCase();
    const rpcUrl = CHAINS[chain];
    if (!rpcUrl) throw new Error(`unsupported chain: ${chain}`);

    const [tx, receipt] = await Promise.all([
      rpc(rpcUrl, "eth_getTransactionByHash", [tx_hash]),
      rpc(rpcUrl, "eth_getTransactionReceipt", [tx_hash]),
    ]);

    if (!tx) throw new Error("transaction not found");

    const status = !receipt
      ? "pending"
      : receipt.status === "0x1" ? "success" : "failed";

    let timestamp = null;
    if (tx.blockNumber) {
      try {
        const block = await rpc(rpcUrl, "eth_getBlockByNumber", [tx.blockNumber, false]);
        if (block?.timestamp) {
          timestamp = new Date(hexToInt(block.timestamp) * 1000).toISOString();
        }
      } catch (_) {}
    }

    const gas_used      = receipt ? hexToInt(receipt.gasUsed) : null;
    const gas_price_raw = hexToInt(tx.gasPrice);
    const gas_price_gwei = gas_price_raw != null ? Math.round((gas_price_raw / 1e9) * 100) / 100 : null;
    const fee_eth = (gas_used != null && gas_price_raw != null)
      ? Math.round((gas_used * gas_price_raw / 1e18) * 1e10) / 1e10
      : null;

    const input    = (tx.input || tx.data || "0x").toLowerCase();
    const selector = input !== "0x" && input.length >= 10 ? input.slice(0, 10) : null;
    const method   = selector ? (METHOD_SELECTORS[selector] || selector) : null;

    let erc20_transfer = null;

    if (selector === "0xa9059cbb") {
      const decoded = decodeTransferTo(input);
      if (decoded) {
        erc20_transfer = {
          token_contract: tx.to,
          to:             decoded.to,
          amount_raw:     decoded.amount_raw,
        };
      }
    } else if (receipt?.logs?.length) {
      const tLog = receipt.logs.find(
        l => l.topics?.[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC && l.topics?.length === 3
      );
      if (tLog) {
        let amount_raw = "0";
        try { amount_raw = BigInt(tLog.data).toString(); } catch (_) {}
        erc20_transfer = {
          token_contract: tLog.address,
          to:             "0x" + tLog.topics[2].slice(26),
          amount_raw,
        };
      }
    }

    const value_eth = hexToEth(tx.value);

    let summary;
    if (erc20_transfer) {
      summary = `Token transfer on ${chain}: ${tx.from} sent ${erc20_transfer.amount_raw} raw token units of ${erc20_transfer.token_contract} to ${erc20_transfer.to} (${status}).`;
    } else if (value_eth > 0 && !selector) {
      summary = `Plain ETH transfer on ${chain}: ${tx.from} sent ${value_eth.toFixed(6)} ETH to ${tx.to || "contract creation"} (${status}).`;
    } else if (method) {
      const displayVal = value_eth > 0 ? ` with ${value_eth.toFixed(6)} ETH` : "";
      summary = `Contract call on ${chain}: ${tx.from} called ${method}()${displayVal} on ${tx.to} (${status}).`;
    } else {
      summary = `Transaction on ${chain}: ${tx.from} → ${tx.to || "contract creation"}, ${value_eth.toFixed(6)} ETH (${status}).`;
    }

    return {
      hash:           tx_hash,
      chain,
      status,
      block_number:   tx.blockNumber ? hexToInt(tx.blockNumber) : null,
      timestamp,
      from:           tx.from,
      to:             tx.to || null,
      value_eth,
      gas_used,
      gas_price_gwei,
      fee_eth,
      method,
      erc20_transfer,
      summary,
      ts: new Date().toISOString(),
    };
  },
};
