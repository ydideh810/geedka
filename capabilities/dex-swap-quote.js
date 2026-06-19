// dex-swap-quote.js
//
// Cross-chain and same-chain DEX swap quote via Li.Fi aggregator.
// Returns best route, expected output amount, exchange rate, gas cost,
// and DEX/bridge names used. Covers ETH, Base, Polygon, Arbitrum,
// Optimism, BSC, Avalanche, and more.
//
// Seam: proxy.suverse.io/v1/swap/base/quote
//       64 settlements/week, 1 payer, $0.255/call (signal-intel archive 2026-06-06)
//
// Free upstream: li.quest/v1/quote — no API key, aggregates 1inch, Uniswap, Relay, etc.
// Priced at $0.012 — 95% below suverse's $0.255; also covers cross-chain routes suverse doesn't.

const LIFI_URL = "https://li.quest/v1/quote";
const UA       = "the-stall/3.74 (https://intuitek.ai)";
const TIMEOUT  = 20_000;

const CHAIN_IDS = {
  ethereum: 1, eth: 1,
  base: 8453,
  polygon: 137, matic: 137,
  arbitrum: 42161, arb: 42161,
  optimism: 10, op: 10,
  bsc: 56, binance: 56,
  avalanche: 43114, avax: 43114,
  gnosis: 100, xdai: 100,
  zksync: 324,
  scroll: 534352,
  linea: 59144,
  blast: 81457,
  mode: 34443,
};

// Decimals for common tokens when parsing human-readable amounts
const KNOWN_DECIMALS = {
  ETH: 18, WETH: 18, MATIC: 18, AVAX: 18, BNB: 18, OP: 18, ARB: 18,
  USDC: 6, USDT: 6, DAI: 18, FRAX: 18, BUSD: 18,
  WBTC: 8, CBBTC: 8,
  LINK: 18, UNI: 18, AAVE: 18, CRV: 18, SNX: 18, MKR: 18,
};

function resolveChain(name) {
  if (/^\d+$/.test(String(name))) return Number(name);
  const id = CHAIN_IDS[String(name).toLowerCase().trim()];
  if (!id) throw new Error(`Unknown chain '${name}'. Use chain ID or: ${Object.keys(CHAIN_IDS).filter(k => !CHAIN_IDS[k + "_alias"]).slice(0, 12).join(", ")}`);
  return id;
}

function toWei(amount, decimals) {
  const parts = String(amount).split(".");
  const whole  = BigInt(parts[0] || "0");
  const frac   = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  return (whole * BigInt(10 ** decimals) + BigInt(frac || "0")).toString();
}

function fromWei(weiStr, decimals) {
  const n = BigInt(weiStr || "0");
  const d = BigInt(10 ** decimals);
  const whole = n / d;
  const frac  = n % d;
  return Number(`${whole}.${frac.toString().padStart(decimals, "0")}`);
}

export default {
  name: "dex-swap-quote",
  price: "$0.012",

  description:
    "Best-route DEX swap quote across 20+ chains via Li.Fi aggregator. Returns expected output, exchange rate, gas cost, price impact, and route (DEX/bridge names). Works for same-chain and cross-chain swaps. Use ETH/USDC/WBTC symbols or ERC-20 addresses. Chains: ethereum, base, polygon, arbitrum, optimism, bsc, avalanche, and more. $0.012/call — free upstream.",

  inputSchema: {
    type: "object",
    properties: {
      from_chain: {
        type: "string",
        description: "Source chain — name (ethereum, base, polygon, arbitrum, optimism, bsc, avalanche) or chain ID integer.",
      },
      to_chain: {
        type: "string",
        description: "Destination chain. Same as from_chain for same-chain swaps. Use chain name or ID.",
      },
      from_token: {
        type: "string",
        description: "Source token — symbol (ETH, USDC, WBTC, USDT, MATIC, LINK) or ERC-20 contract address.",
      },
      to_token: {
        type: "string",
        description: "Destination token — symbol or ERC-20 contract address.",
      },
      from_amount: {
        type: "string",
        description: "Amount of source token to swap, in human-readable units (e.g. '0.1' for 0.1 ETH, '100' for 100 USDC). For unknown tokens, provide wei/smallest-unit string with '!' prefix (e.g. '!1000000').",
      },
      slippage: {
        type: "number",
        description: "Max slippage tolerance as a decimal (0.005 = 0.5%). Default 0.03 (3%).",
        minimum: 0.0001,
        maximum: 0.5,
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      from_chain:    { type: "string" },
      to_chain:      { type: "string" },
      from_token:    { type: "string" },
      to_token:      { type: "string" },
      from_amount:   { type: "number", description: "Human-readable input amount." },
      to_amount:     { type: "number", description: "Expected output amount (before slippage)." },
      to_amount_min: { type: "number", description: "Minimum guaranteed output (after slippage)." },
      exchange_rate: { type: "number", description: "toToken per fromToken." },
      price_impact:  { type: "string", description: "Estimated price impact percentage, if available." },
      gas_cost_usd:  { type: "number", description: "Estimated gas cost in USD." },
      fee_usd:       { type: "number", description: "Protocol/integrator fees in USD." },
      route:         { type: "array",  items: { type: "string" }, description: "Ordered list of DEX/bridge names used." },
      cross_chain:   { type: "boolean", description: "True if this is a cross-chain swap/bridge." },
      execution_time_seconds: { type: "number", description: "Estimated execution time (bridge + swap)." },
      quote_ts:      { type: "string", description: "ISO-8601 timestamp of this quote." },
    },
  },

  async handler(query) {
    const fromChainId = resolveChain(query.from_chain || "base");
    const toChainId   = resolveChain(query.to_chain   || "base");
    const slippage    = Number(query.slippage ?? 0.03);

    // Resolve fromToken decimals
    const fromSym = String(query.from_token || "ETH").toUpperCase();
    let fromAmountWei;
    if (String(query.from_amount).startsWith("!")) {
      fromAmountWei = String(query.from_amount).slice(1);
    } else {
      const decimals = KNOWN_DECIMALS[fromSym] ?? 18;
      fromAmountWei = toWei(query.from_amount || "0.1", decimals);
    }

    const params = new URLSearchParams({
      fromChain:   fromChainId,
      toChain:     toChainId,
      fromToken:   query.from_token || "ETH",
      toToken:     query.to_token   || "USDC",
      fromAmount:  fromAmountWei,
      fromAddress: "0x0000000000000000000000000000000000000001",
      slippage:    slippage,
      integrator:  "the-stall",
    });

    const resp = await fetch(`${LIFI_URL}?${params}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });

    const data = await resp.json();
    if (!resp.ok || data.code || !data.estimate) {
      const msg = data.message || data.error || `HTTP ${resp.status}`;
      throw new Error(`Li.Fi quote error: ${msg}`);
    }

    const est = data.estimate;
    const act = data.action || {};
    const fromTok = act.fromToken || {};
    const toTok   = act.toToken   || {};

    const fromDec = fromTok.decimals ?? (KNOWN_DECIMALS[fromSym] ?? 18);
    const toSym   = String(query.to_token).toUpperCase();
    const toDec   = toTok.decimals ?? (KNOWN_DECIMALS[toSym] ?? 18);

    const fromAmt  = fromWei(est.fromAmount, fromDec);
    const toAmt    = fromWei(est.toAmount,    toDec);
    const toAmtMin = fromWei(est.toAmountMin || est.toAmount, toDec);

    const gasCosts  = est.gasCosts  || [];
    const feeCosts  = est.feeCosts  || [];
    const totalGas  = gasCosts.reduce((s, g) => s + Number(g.amountUSD || 0), 0);
    const totalFee  = feeCosts.reduce((s, f) => s + Number(f.amountUSD || 0), 0);

    const steps  = data.includedSteps || [data];
    const route  = steps.map(s => s.toolDetails?.name || s.tool || "?").filter(Boolean);

    const execTime = steps.reduce((s, st) => s + Number(st.estimate?.executionDuration || 0), 0);

    return {
      from_chain:   fromTok.chainId ? String(fromTok.chainId) : String(fromChainId),
      to_chain:     toTok.chainId   ? String(toTok.chainId)   : String(toChainId),
      from_token:   fromTok.symbol  || query.from_token,
      to_token:     toTok.symbol    || query.to_token,
      from_amount:  fromAmt,
      to_amount:    toAmt,
      to_amount_min: toAmtMin,
      exchange_rate: fromAmt > 0 ? toAmt / fromAmt : 0,
      price_impact:  est.priceImpactPercentage != null
                       ? `${(Number(est.priceImpactPercentage) * 100).toFixed(3)}%`
                       : "unknown",
      gas_cost_usd:  totalGas,
      fee_usd:       totalFee,
      route,
      cross_chain:   fromChainId !== toChainId,
      execution_time_seconds: execTime || null,
      quote_ts: new Date().toISOString(),
    };
  },
};
