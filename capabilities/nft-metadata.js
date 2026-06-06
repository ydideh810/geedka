// nft-metadata.js
//
// NFT metadata, traits, image URL, and collection stats for any ERC-721 or ERC-1155 token.
// Collapses the observed seam:
//   skills.onesource.io/api/chain/nft-metadata (Media category, last seen 2026-06-06T16:10Z)
// Media is the fastest-growing x402 category (38.5 settlements/day slope, 2026-06-06).
//
// Free upstream: Alchemy NFT API v3 public demo endpoint — no API key, no auth.
// Supports Ethereum, Polygon, Base, Arbitrum mainnet.
// PROSPECTOR signal: Media growth + OneSource seam — 2026-06-06.

const ALCHEMY_BASE = "https://{network}.g.alchemy.com/nft/v3/demo/getNFTMetadata";
const UA = "Mozilla/5.0 (compatible; the-stall/3.58; +https://intuitek.ai)";
const TIMEOUT = 12_000;

const NETWORK_MAP = {
  ethereum: "eth-mainnet",
  eth: "eth-mainnet",
  mainnet: "eth-mainnet",
  "eth-mainnet": "eth-mainnet",
  polygon: "polygon-mainnet",
  matic: "polygon-mainnet",
  "polygon-mainnet": "polygon-mainnet",
  base: "base-mainnet",
  "base-mainnet": "base-mainnet",
  arbitrum: "arb-mainnet",
  arb: "arb-mainnet",
  "arb-mainnet": "arb-mainnet",
  optimism: "opt-mainnet",
  "opt-mainnet": "opt-mainnet",
};

export default {
  name: "nft-metadata",
  price: "$0.002",

  description:
    "Fetch NFT metadata, traits, image URL, and collection floor price for any ERC-721 or ERC-1155 token. Returns name, description, all attributes/traits, cached image CDN URL, collection name, OpenSea floor price, token type, and mint block. Supports Ethereum, Polygon, Base, Arbitrum mainnet. Useful for NFT valuation research, portfolio analysis, content generation, and collection intelligence. Free upstream: Alchemy NFT API.",

  inputSchema: {
    type: "object",
    properties: {
      contract: {
        type: "string",
        description: "NFT contract address (0x hex, 42 chars). Example: 0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D (BAYC).",
        pattern: "^0x[a-fA-F0-9]{40}$",
      },
      token_id: {
        type: "string",
        description: "Token ID as a string or integer. Example: '42' or '1000'. ERC-1155 token IDs also accepted.",
      },
      network: {
        type: "string",
        description: "Blockchain network. Options: ethereum, polygon, base, arbitrum, optimism. Default: ethereum.",
        default: "ethereum",
        enum: ["ethereum", "eth", "mainnet", "polygon", "matic", "base", "arbitrum", "arb", "optimism"],
      },
    },
    required: ["contract", "token_id"],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      name:           { type: "string", description: "NFT name (e.g. 'Azuki #42')." },
      description:    { type: "string", description: "NFT description text." },
      image_url:      { type: "string", description: "CDN-cached image URL (PNG/SVG/GIF)." },
      image_original: { type: "string", description: "Original image URL or IPFS URI." },
      attributes:     { type: "array", description: "Array of {trait_type, value} objects." },
      token_type:     { type: "string", description: "ERC721 or ERC1155." },
      collection:     { type: "object", description: "Collection info: name, openSea floor price ETH, total supply." },
      contract:       { type: "object", description: "Contract details: address, name, symbol, deployer." },
      token_uri:      { type: "string", description: "Raw token URI (IPFS or HTTP)." },
      mint_block:     { type: "integer", description: "Block number when this token was minted." },
      network:        { type: "string" },
      ts:             { type: "string" },
    },
  },

  async handler(query) {
    const contract = String(query.contract || "").trim().toLowerCase();
    const tokenId  = String(query.token_id || "").trim();
    const netKey   = String(query.network || "ethereum").toLowerCase().trim();

    if (!/^0x[a-f0-9]{40}$/.test(contract)) {
      throw new Error("contract must be a valid 0x hex address (42 chars)");
    }
    if (!tokenId || tokenId === "") {
      throw new Error("token_id is required");
    }

    const network = NETWORK_MAP[netKey] ?? "eth-mainnet";
    const url = ALCHEMY_BASE.replace("{network}", network) +
      `?contractAddress=${contract}&tokenId=${encodeURIComponent(tokenId)}`;

    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!resp.ok) throw new Error(`Alchemy NFT API HTTP ${resp.status}`);

    const d = await resp.json();
    if (d.error) throw new Error(`Alchemy error: ${d.error.message || JSON.stringify(d.error)}`);

    const imgBlock = d.image || {};
    const rawMeta  = d.raw?.metadata || {};
    const osData   = d.contract?.openSeaMetadata || {};
    const col      = d.collection || {};
    const mintData = d.mint || {};
    const attrs    = rawMeta.attributes || [];

    return {
      name:           d.name ?? rawMeta.name ?? null,
      description:    d.description ?? rawMeta.description ?? null,
      image_url:      imgBlock.cachedUrl ?? imgBlock.thumbnailUrl ?? null,
      image_original: imgBlock.originalUrl ?? rawMeta.image ?? null,
      attributes:     attrs,
      token_type:     d.tokenType ?? null,
      collection: {
        name:              osData.collectionName ?? col.name ?? d.contract?.name ?? null,
        floor_price_eth:   osData.floorPrice ?? null,
        total_supply:      d.contract?.totalSupply ?? null,
        opensea_slug:      osData.collectionSlug ?? null,
      },
      contract: {
        address:   d.contract?.address ?? contract,
        name:      d.contract?.name ?? null,
        symbol:    d.contract?.symbol ?? null,
        deployer:  d.contract?.contractDeployer ?? null,
      },
      token_uri:  d.tokenUri ?? null,
      mint_block: mintData.blockNumber ?? null,
      network,
      ts: new Date().toISOString(),
    };
  },
};
