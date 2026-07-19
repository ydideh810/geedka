// cross-chain-bridge-status.js
//
// Cross-chain bridge availability and route discovery via Li.Fi aggregator.
// Free, no API key. Covers 32 bridges (Stargate, Across, Hop, CCTP, Relay, etc.)
// across 75 chains. Call before any cross-chain transfer to identify live routes.
//
// Sourced from li.quest/v1/tools + li.quest/v1/chains (public, unauthenticated).
// Seam origin: Track 3 DeFi expansion per K¹ directive 2026-06-27 ("do these things").

const LIFI_BASE = "https://li.quest/v1";
const UA = "myriad/4.64 (https://synaptiic.org)";
const TIMEOUT = 15_000;

const CHAIN_IDS = {
  ethereum: 1, eth: 1,
  base: 8453,
  polygon: 137, matic: 137, pol: 137,
  arbitrum: 42161, arb: 42161,
  optimism: 10, op: 10,
  bsc: 56, binance: 56, bnb: 56,
  avalanche: 43114, avax: 43114,
  gnosis: 100, xdai: 100,
  zksync: 324,
  scroll: 534352,
  linea: 59144,
  blast: 81457,
  mode: 34443,
  solana: 1151111081099710,
  unichain: 130,
  sei: 1329,
  hyperliquid: 1337,
  monad: 143,
};

function resolveChain(name) {
  if (/^\d+$/.test(String(name))) return Number(name);
  const id = CHAIN_IDS[String(name).toLowerCase().trim()];
  if (!id) throw new Error(`Unknown chain '${name}'. Use chain ID or name: ${Object.keys(CHAIN_IDS).filter((k) => !["matic","pol","arb","eth","op","bnb","avax","xdai"].includes(k)).slice(0, 14).join(", ")}`);
  return id;
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!resp.ok) throw new Error(`LiFi HTTP ${resp.status}: ${url}`);
  return resp.json();
}

export default {
  name: "cross-chain-bridge-status",
  price: "$0.025",
  description: "Live cross-chain bridge availability and route discovery. Given a from/to chain pair, returns all active bridges (Stargate, Across, CCTP, Relay, Squid, etc.), chain metadata, and bridge coverage breadth. Use before any cross-chain transfer or arbitrage to identify available routes. Free — powered by Li.Fi aggregator.",

  inputSchema: {
    type: "object",
    properties: {
      from_chain: {
        type: "string",
        description: "Source chain name or ID (default: base). Examples: ethereum, base, arbitrum, polygon, bsc, optimism, avalanche, zksync, 8453, 1.",
      },
      to_chain: {
        type: "string",
        description: "Destination chain name or ID (default: ethereum). Same options as from_chain.",
      },
      show_all_bridges: {
        type: "boolean",
        description: "If true, return all 32 bridges with their chain coverage (ignores from/to filter). Default false.",
      },
    },
  },

  outputSchema: {
    type: "object",
    properties: {
      from_chain: { type: "object", description: "Source chain info." },
      to_chain: { type: "object", description: "Destination chain info." },
      route_available: { type: "boolean", description: "True if at least one bridge supports this chain pair." },
      bridge_count: { type: "integer", description: "Number of bridges supporting this route." },
      bridges: {
        type: "array",
        description: "Bridges that support this chain pair, sorted by chain-pair coverage breadth (most versatile first).",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            name: { type: "string" },
            chain_pairs_supported: { type: "integer", description: "Total chain pairs this bridge supports across all networks — a proxy for maturity/liquidity." },
          },
        },
      },
      recommendation: { type: "string", description: "Top bridge recommendation for this route." },
      ts: { type: "string" },
    },
  },

  async handler(query) {
    const showAll = Boolean(query.show_all_bridges);

    const fromChainId = showAll ? null : resolveChain(query.from_chain || "base");
    const toChainId = showAll ? null : resolveChain(query.to_chain || "ethereum");

    // Parallel fetch: all bridge tools + all chain info
    const toolsUrl = showAll
      ? `${LIFI_BASE}/tools`
      : `${LIFI_BASE}/tools?chains=${fromChainId},${toChainId}`;

    const [toolsData, chainsData] = await Promise.all([
      fetchJson(toolsUrl),
      fetchJson(`${LIFI_BASE}/chains`),
    ]);

    const allBridges = toolsData.bridges || [];
    const allChains = chainsData.chains || [];

    const chainIndex = Object.fromEntries(allChains.map((c) => [c.id, c]));

    if (showAll) {
      const sorted = [...allBridges].sort(
        (a, b) => (b.supportedChains || []).length - (a.supportedChains || []).length
      );
      return {
        mode: "all_bridges",
        total_bridges: sorted.length,
        bridges: sorted.map((b) => ({
          key: b.key,
          name: b.name,
          chain_pairs_supported: (b.supportedChains || []).length,
        })),
        ts: new Date().toISOString(),
      };
    }

    const fromInfo = chainIndex[fromChainId];
    const toInfo = chainIndex[toChainId];

    if (!fromInfo) throw new Error(`Chain ID ${fromChainId} not found in LiFi chain registry.`);
    if (!toInfo) throw new Error(`Chain ID ${toChainId} not found in LiFi chain registry.`);

    // Get total chain pairs per bridge across ALL networks (not just this route pair)
    // — need to fetch without chain filter for breadth signal
    let allBridgesGlobal = allBridges;
    try {
      const globalTools = await fetchJson(`${LIFI_BASE}/tools`);
      allBridgesGlobal = globalTools.bridges || allBridges;
    } catch {
      // fall back to route-filtered list
    }
    const globalCoverage = Object.fromEntries(
      allBridgesGlobal.map((b) => [b.key, (b.supportedChains || []).length])
    );

    // Bridges supporting this specific route (filtered by LiFi tools endpoint)
    const routeBridges = allBridges
      .filter((b) => (b.supportedChains || []).some(
        (p) => p.fromChainId === fromChainId && p.toChainId === toChainId
      ))
      .map((b) => ({
        key: b.key,
        name: b.name,
        chain_pairs_supported: globalCoverage[b.key] ?? (b.supportedChains || []).length,
      }))
      .sort((a, b) => b.chain_pairs_supported - a.chain_pairs_supported);

    const routeAvailable = routeBridges.length > 0;
    const top = routeBridges[0];

    let recommendation = "No bridges found for this chain pair.";
    if (top) {
      const runners = routeBridges.slice(1, 3).map((b) => b.name).join(", ");
      recommendation = `Use ${top.name} (${top.chain_pairs_supported} chain pairs — highest coverage).${runners ? ` Alternatives: ${runners}.` : ""}`;
    }

    return {
      from_chain: {
        id: fromChainId,
        name: fromInfo.name,
        native_token: fromInfo.nativeToken?.symbol ?? "ETH",
        mainnet: fromInfo.mainnet ?? true,
      },
      to_chain: {
        id: toChainId,
        name: toInfo.name,
        native_token: toInfo.nativeToken?.symbol ?? "ETH",
        mainnet: toInfo.mainnet ?? true,
      },
      route_available: routeAvailable,
      bridge_count: routeBridges.length,
      bridges: routeBridges,
      recommendation,
      ts: new Date().toISOString(),
    };
  },
};
