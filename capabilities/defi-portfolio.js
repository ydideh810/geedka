// defi-portfolio.js
//
// Multi-chain DeFi portfolio scanner — token holdings and USD values for any
// EVM wallet across Ethereum, Base, Polygon, and Arbitrum mainnet.
//
// Seam: defi.hugen.tokyo/defi/address — 41 payers, ~1,010 sett/7d, $0.0108 avg.
// Priced at $0.007 (35% below hugen's $0.0108 avg).
//
// Free upstream: DRPC.org public RPCs (no auth) + CoinGecko public API.

const RPCS = {
  ethereum: "https://eth.drpc.org",
  base:     "https://mainnet.base.org",
  polygon:  "https://polygon.drpc.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
};

const TOKENS = {
  ethereum: {
    native: { symbol: "ETH",   cgId: "ethereum",      decimals: 18 },
    erc20: [
      { symbol: "USDC",  addr: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6,  cgId: "usd-coin"        },
      { symbol: "USDT",  addr: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6,  cgId: "tether"          },
      { symbol: "DAI",   addr: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18, cgId: "dai"             },
      { symbol: "WBTC",  addr: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", decimals: 8,  cgId: "wrapped-bitcoin" },
      { symbol: "WETH",  addr: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", decimals: 18, cgId: "ethereum"        },
    ],
  },
  base: {
    native: { symbol: "ETH",   cgId: "ethereum",      decimals: 18 },
    erc20: [
      { symbol: "USDC",  addr: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6,  cgId: "usd-coin" },
      { symbol: "USDbC", addr: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", decimals: 6,  cgId: "usd-coin" },
      { symbol: "cbETH", addr: "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", decimals: 18, cgId: "coinbase-wrapped-staked-eth" },
    ],
  },
  polygon: {
    native: { symbol: "POL",   cgId: "polygon-ecosystem-token", decimals: 18 },
    erc20: [
      { symbol: "USDC.e",addr: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", decimals: 6,  cgId: "usd-coin" },
      { symbol: "USDT",  addr: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", decimals: 6,  cgId: "tether"   },
      { symbol: "WETH",  addr: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", decimals: 18, cgId: "ethereum"  },
    ],
  },
  arbitrum: {
    native: { symbol: "ETH",   cgId: "ethereum",      decimals: 18 },
    erc20: [
      { symbol: "USDC",  addr: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", decimals: 6,  cgId: "usd-coin" },
      { symbol: "USDT",  addr: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", decimals: 6,  cgId: "tether"   },
      { symbol: "ARB",   addr: "0x912ce59144191c1204e64559fe8253a0e49e6548", decimals: 18, cgId: "arbitrum"  },
    ],
  },
};

function balanceOfData(wallet) {
  return "0x70a08231" + wallet.slice(2).toLowerCase().padStart(64, "0");
}

async function rpcCall(rpcUrl, method, params) {
  const resp = await fetch(rpcUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal:  AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.error) return "0x0";
  return d.result || "0x0";
}

async function scanChain(chainName, wallet) {
  const rpcUrl = RPCS[chainName];
  const cfg    = TOKENS[chainName];
  const data   = balanceOfData(wallet);

  // Send all calls in parallel (individual requests to avoid free-tier batch limits)
  const [nativeHex, ...tokenHexes] = await Promise.all([
    rpcCall(rpcUrl, "eth_getBalance", [wallet, "latest"]),
    ...cfg.erc20.map(t => rpcCall(rpcUrl, "eth_call", [{ to: t.addr, data }, "latest"])),
  ]);

  const holdings = [];

  const nativeVal = BigInt(nativeHex);
  if (nativeVal > 0n) {
    holdings.push({
      symbol: cfg.native.symbol, cgId: cfg.native.cgId, decimals: cfg.native.decimals,
      balance: Number(nativeVal) / 10 ** cfg.native.decimals,
    });
  }

  for (let i = 0; i < cfg.erc20.length; i++) {
    const t   = cfg.erc20[i];
    const hex = tokenHexes[i] || "0x0";
    const raw = hex === "0x" || hex === "0x0" ? 0n : BigInt(hex);
    if (raw > 0n) {
      holdings.push({
        symbol: t.symbol, cgId: t.cgId, decimals: t.decimals,
        balance: Number(raw) / 10 ** t.decimals,
      });
    }
  }

  return { chain: chainName, holdings };
}

async function getPrices(cgIds) {
  const ids = [...new Set(cgIds)].filter(Boolean).join(",");
  if (!ids) return {};
  const r = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    { signal: AbortSignal.timeout(8_000) }
  );
  if (!r.ok) return {};
  return r.json();
}

export default {
  name:  "defi-portfolio",
  price: "$0.010",

  description:
    "Multi-chain DeFi portfolio scanner. Returns token holdings and USD values for any EVM wallet across Ethereum, Base, Polygon, and Arbitrum mainnet. Covers ETH, major stablecoins (USDC, USDT, DAI), WBTC, ARB, cbETH, and chain-native assets. Collapses the defi.hugen.tokyo/defi/address seam — 41 payers. $0.010/call.",

  inputSchema: {
    type: "object",
    required: ["address"],
    properties: {
      address: {
        type: "string",
        description: "EVM wallet address (0x + 40 hex chars).",
        pattern: "^0x[0-9a-fA-F]{40}$",
      },
      chains: {
        type: "array",
        items: { type: "string", enum: ["ethereum", "base", "polygon", "arbitrum"] },
        description: "Chains to scan. Defaults to all four.",
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      address:    { type: "string", description: "Wallet address queried." },
      total_usd:  { type: "number", description: "Total portfolio value in USD." },
      chains:     { type: "array",  description: "Per-chain token holdings with USD values." },
      scanned_at: { type: "string", description: "ISO-8601 scan timestamp." },
    },
  },

  async handler(query) {
    const address = (query.address || "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error("address must be 0x + 40 hex chars (EVM address)");
    }
    const wallet = address.toLowerCase();

    const chainsToScan = Array.isArray(query.chains) && query.chains.length > 0
      ? query.chains.filter(c => TOKENS[c])
      : Object.keys(TOKENS);

    const chainResults = await Promise.allSettled(
      chainsToScan.map(c => scanChain(c, wallet))
    );

    const cgIds = [];
    for (const r of chainResults) {
      if (r.status === "fulfilled") r.value.holdings.forEach(h => cgIds.push(h.cgId));
    }
    const prices = await getPrices(cgIds);

    let totalUsd = 0;
    const enrichedChains = chainResults.map((r, i) => {
      const chainName = chainsToScan[i];
      if (r.status === "rejected") return { chain: chainName, error: r.reason.message, holdings: [] };
      const enriched = r.value.holdings.map(h => {
        const priceUsd = prices[h.cgId]?.usd ?? null;
        const value    = priceUsd !== null ? +(h.balance * priceUsd).toFixed(4) : null;
        if (value !== null) totalUsd += value;
        return { symbol: h.symbol, balance: +h.balance.toFixed(8), price_usd: priceUsd, value_usd: value };
      });
      return { chain: chainName, holdings: enriched };
    });

    return {
      address: wallet,
      total_usd: +totalUsd.toFixed(4),
      chains: enrichedChains,
      scanned_at: new Date().toISOString(),
    };
  },
};
