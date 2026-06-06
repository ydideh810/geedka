// crypto-pulse.js
//
// Crypto market pulse — latest Ethereum block context + top crypto movers in
// one call. Collapses the observed seam:
//   skills.onesource.io/api/chain/block/0x1212D00 → api.printmoneylab.com/api/v1/market-movers
// 5–6 distinct wallets, 8-day persistence, PROSPECTOR signals 60291/60292/60294.
// onesource block seam: 363 payers / 2527 sett/7d @ $0.004.
// printmoneylab movers: 31 payers / 510 sett/7d @ $0.006.
// Priced at $0.007 — 30% below the $0.010 competitor chain.
//
// Free upstream: DRPC.org public JSON-RPC (block) + CoinGecko public API (movers).

const ETH_RPC  = "https://eth.drpc.org";
const BASE_RPC = "https://base.drpc.org";
const CG_BASE  = "https://api.coingecko.com/api/v3/coins/markets";
const UA       = "Mozilla/5.0 (compatible; the-stall/0.9; +https://intuitek.ai)";
const TIMEOUT  = 15_000;

async function fetchBlock(network) {
  const url = network === "base" ? BASE_RPC : ETH_RPC;
  const resp = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.error) throw new Error(`RPC: ${d.error.message}`);
  const b = d.result;
  if (!b) throw new Error("null block result");
  const ts = parseInt(b.timestamp, 16);
  const baseFeeWei = b.baseFeePerGas ? parseInt(b.baseFeePerGas, 16) : null;
  return {
    network,
    block_number:   parseInt(b.number, 16),
    hash:           b.hash,
    miner:          b.miner,
    timestamp_iso:  new Date(ts * 1000).toISOString(),
    timestamp_unix: ts,
    tx_count:       (b.transactions ?? []).length,
    gas_used:       parseInt(b.gasUsed, 16),
    gas_limit:      parseInt(b.gasLimit, 16),
    base_fee_gwei:  baseFeeWei !== null ? Number((baseFeeWei / 1e9).toFixed(4)) : null,
  };
}

async function fetchMovers(limit, order) {
  const url = `${CG_BASE}?vs_currency=usd&order=${order}&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;
  const r   = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
  const d = await r.json();
  if (!Array.isArray(d)) throw new Error("unexpected CoinGecko response");
  return d.map(c => ({
    symbol:     (c.symbol ?? "").toUpperCase(),
    name:       c.name ?? c.symbol,
    price_usd:  c.current_price ?? null,
    change_24h: Number((c.price_change_percentage_24h ?? 0).toFixed(4)),
    volume_24h: c.total_volume ?? null,
    market_cap: c.market_cap ?? null,
  }));
}

export default {
  name:  "crypto-pulse",
  price: "$0.007",

  description:
    "Crypto market pulse — latest Ethereum (or Base) block context plus top crypto gainers and losers by 24h change, in a single call. Returns: block_number, timestamp, gas info (base_fee_gwei, gas_used/limit, tx_count), and top movers (symbol, name, price_usd, change_24h, volume_24h, market_cap). Use for crypto portfolio context, on-chain/market correlation, or pre-trade situational awareness. Free upstream: DRPC + CoinGecko. $0.007/call — 30% below the comparable two-endpoint chain.",

  inputSchema: {
    type: "object",
    properties: {
      network: {
        type: "string",
        enum: ["ethereum", "base"],
        description: "Chain for block context. Default: ethereum.",
        default: "ethereum",
      },
      movers_limit: {
        type: "integer",
        description: "Number of gainers + losers each (1–20). Default 5.",
        default: 5,
        minimum: 1,
        maximum: 20,
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      block: {
        type: "object",
        description: "Latest block header for the selected network.",
        properties: {
          network:        { type: "string"  },
          block_number:   { type: "integer" },
          hash:           { type: "string"  },
          miner:          { type: "string"  },
          timestamp_iso:  { type: "string"  },
          timestamp_unix: { type: "integer" },
          tx_count:       { type: "integer" },
          gas_used:       { type: "integer" },
          gas_limit:      { type: "integer" },
          base_fee_gwei:  { type: ["number", "null"] },
        },
      },
      crypto_gainers: {
        type: "array",
        description: "Top crypto gainers by 24h % change.",
        items: { type: "object" },
      },
      crypto_losers: {
        type: "array",
        description: "Top crypto losers by 24h % change.",
        items: { type: "object" },
      },
      generated_at: { type: "string" },
    },
  },

  async handler(input) {
    const network = input.network || "ethereum";
    const limit   = Math.min(Math.max(parseInt(input.movers_limit || "5", 10), 1), 20);

    const [blockResult, gainersResult, losersResult] = await Promise.allSettled([
      fetchBlock(network),
      fetchMovers(limit, "percent_change_24h_desc"),
      fetchMovers(limit, "percent_change_24h_asc"),
    ]);

    return {
      block:          blockResult.status  === "fulfilled" ? blockResult.value  : { error: blockResult.reason?.message  },
      crypto_gainers: gainersResult.status === "fulfilled" ? gainersResult.value : [],
      crypto_losers:  losersResult.status  === "fulfilled" ? losersResult.value  : [],
      generated_at:   new Date().toISOString(),
    };
  },
};
