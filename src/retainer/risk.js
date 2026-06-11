// scoreSignals math is final (from directive). mockProvider() retained for test harness only.
// Live provider: eth_getLogs on Base — ERC-20 Transfer events, bounded window.
// No Alchemy key available; Coinbase CDP RPC returns -32002 for alchemy_getAssetTransfers.
// Standard eth_getLogs works on all public RPC endpoints.

const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const LOOKBACK_BLOCKS = parseInt(process.env.STALL_RISK_LOOKBACK_BLOCKS || "50000", 10); // ~27h at 2s/block
const PAGE_CAP = 150; // max events per direction before capping

// OFAC/sanctioned addresses — local set-membership (refresh this set on SDN list updates)
const OFAC_SET = new Set([
  "0x8589427373d6d84e98730d7795d8f6f8731fda16", // Tornado Cash router
  "0x722122df12d4e14e13ac3b6895a86e84145b6967",
  "0xdd4c48c0b24039969fc16d1cdf626eab821d3384",
  "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",
  "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf",
  "0xa160cdab225685da1d56aa342ad8841c3b53f291",
  "0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144",
  "0xf60dd140cff0706bae9cd734ac3ae76ad9ebc32a",
  "0x22aaa7720ddd5388a3c0a3333430953c68f1849b",
  "0xba214c1c1928a32bffe790263e38b4af9bfcd659",
  "0xb1c8094b234efc18d2e9b9ca73d98f2dfd4dcfb9",
  "0x03893a7c7463ae47d46bc7f091665f1893656003", // Blender.io
  "0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3", // Chipmixer
  "0x4f47bc496083c727c5fbe3ce9cdf2b0882be5a10", // Sinbad
]);

async function rpcCall(url, method, params) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const d = await resp.json();
  if (d.error) throw new Error(`RPC: ${d.error.message}`);
  return d.result;
}

async function getLogs(url, padded, fromBlock, dir) {
  const topics = dir === "out"
    ? [TRANSFER_TOPIC, padded]
    : [TRANSFER_TOPIC, null, padded];
  return rpcCall(url, "eth_getLogs", [{ fromBlock, toBlock: "latest", topics }]);
}

export function makeLiveProvider({ rpcUrl = BASE_RPC } = {}) {
  return {
    async getSignals(address) {
      const addr = address.toLowerCase();
      const padded = "0x" + "0".repeat(24) + addr.slice(2);

      const latestHex = await rpcCall(rpcUrl, "eth_blockNumber", []);
      const latest = parseInt(latestHex, 16);

      // Try full lookback; fall back to 10k blocks if RPC rejects the range
      let outLogs = [], inLogs = [], lookback = LOOKBACK_BLOCKS, degraded = false;
      for (const window of [LOOKBACK_BLOCKS, 10000]) {
        const fromBlock = "0x" + Math.max(0, latest - window).toString(16);
        try {
          [outLogs, inLogs] = await Promise.all([
            getLogs(rpcUrl, padded, fromBlock, "out"),
            getLogs(rpcUrl, padded, fromBlock, "in"),
          ]);
          lookback = window;
          break;
        } catch (e) {
          if (window === 10000) { degraded = true; break; } // both windows failed
        }
      }

      const out = outLogs.slice(0, PAGE_CAP);
      const in_ = inLogs.slice(0, PAGE_CAP);
      const txCount = out.length + in_.length;

      // Counterparties: outbound → topic[2] (to), inbound → topic[1] (from)
      const counterparties = new Map();
      for (const log of out) {
        const to = "0x" + (log.topics[2] || "").slice(26).toLowerCase();
        if (to.length === 42 && to !== addr) counterparties.set(to, (counterparties.get(to) || 0) + 1);
      }
      for (const log of in_) {
        const from = "0x" + (log.topics[1] || "").slice(26).toLowerCase();
        if (from.length === 42 && from !== addr) counterparties.set(from, (counterparties.get(from) || 0) + 1);
      }
      const distinctCounterparties = Math.max(counterparties.size, txCount > 0 ? 1 : 0);
      const topCount = counterparties.size > 0 ? Math.max(...counterparties.values()) : 0;
      const topCounterpartyShare = txCount > 0 ? topCount / txCount : 0;

      // Wallet age from earliest event block (bounded by lookback window)
      const allBlocks = [...out, ...in_].map(l => parseInt(l.blockNumber, 16));
      const earliestBlock = allBlocks.length > 0 ? Math.min(...allBlocks) : latest;
      const blockAge = latest - earliestBlock;
      const ageDays = Math.max(0, Math.floor(blockAge * 2 / 86400)); // ~2s/block on Base

      // Inbound from OFAC-sanctioned address
      const inboundFromFlagged = in_.some(log => {
        const from = "0x" + (log.topics[1] || "").slice(26).toLowerCase();
        return OFAC_SET.has(from);
      });

      return {
        ageDays,
        txCount,
        distinctCounterparties,
        topCounterpartyShare,
        inboundFromFlagged,
        largestTransferUsd: 0, // not used in scoreSignals; skip expensive price lookup
        bounded: true,
        lookbackBlocks: lookback,
        degraded,
      };
    },
  };
}

export function mockProvider() { // TEST ONLY
  const h=(s)=>{let x=2166136261>>>0;for(const c of String(s)){x^=c.charCodeAt(0);x=Math.imul(x,16777619)>>>0;}return x;};
  return { async getSignals(address){ const a=h(address); return { ageDays:a%900, txCount:(a>>3)%5000, distinctCounterparties:1+((a>>7)%300), topCounterpartyShare:((a>>5)%100)/100, inboundFromFlagged:((a>>11)%10)===0, largestTransferUsd:(a%250000) }; } };
}

export function scoreSignals(s){
  const factors=[]; let score=0;
  const conc=Math.round(s.topCounterpartyShare*40); score+=conc; factors.push({factor:"counterparty_concentration",weight:conc,detail:Math.round(s.topCounterpartyShare*100)+"% to top counterparty"});
  const youth=s.ageDays<7?25:s.ageDays<30?15:s.ageDays<90?7:0; score+=youth; factors.push({factor:"wallet_age",weight:youth,detail:s.ageDays+" days old"});
  const thin=s.distinctCounterparties<5?15:s.distinctCounterparties<20?7:0; score+=thin; factors.push({factor:"graph_diversity",weight:thin,detail:s.distinctCounterparties+" distinct counterparties"});
  const flagged=s.inboundFromFlagged?20:0; score+=flagged; factors.push({factor:"flagged_exposure",weight:flagged,detail:s.inboundFromFlagged?"inbound from flagged address":"no flagged exposure"});
  score=Math.max(0,Math.min(100,score));
  const band=score>=70?"high":score>=40?"elevated":score>=20?"moderate":"low";
  const recommendation=score>=70?"block":score>=40?"review":"allow";
  return { score, band, recommendation, factors };
}

export function makeRiskService(provider){
  return { async assess(address){
    if(!/^0x[a-fA-F0-9]{40}$/.test(String(address))){ const e=new Error("invalid EVM address"); e.status=400; throw e; }
    const signals=await provider.getSignals(address);
    const result=scoreSignals(signals);
    return { address, ...result, signals, scored_at:new Date().toISOString(), oracle:"the-stall.intuitek.ai/v1/risk" };
  } };
}
