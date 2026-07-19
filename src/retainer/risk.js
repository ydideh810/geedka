// risk.js — counterparty concentration-risk scoring for a Base wallet.
// Live provider: chunked eth_getLogs (ERC-20 Transfer topic), <=1000 blocks/call
// because the Base RPC caps getLogs range at 1000 blocks (-32005). Bounded scan.
const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const CHUNK = parseInt(process.env.STALL_RISK_CHUNK_BLOCKS || "1000", 10); // RPC hard cap
const MAX_CHUNKS = parseInt(process.env.STALL_RISK_MAX_CHUNKS || "15", 10); // ~15k blocks ~8h bounded
const PAGE_CAP = 150;

const OFAC_SET = new Set([
  "0x8589427373d6d84e98730d7795d8f6f8731fda16",
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
  "0x03893a7c7463ae47d46bc7f091665f1893656003",
  "0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3",
  "0x4f47bc496083c727c5fbe3ce9cdf2b0882be5a10",
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
  if (d.error) throw new Error(`RPC ${d.error.code}: ${d.error.message}`);
  return d.result;
}

export function makeLiveProvider({ rpcUrl = BASE_RPC } = {}) {
  return {
    async getSignals(address) {
      const addr = address.toLowerCase();
      const padded = "0x" + "0".repeat(24) + addr.slice(2);
      const latest = parseInt(await rpcCall(rpcUrl, "eth_blockNumber", []), 16);

      let out = [], in_ = [], degraded = false, scanned = 0;
      for (let i = 0; i < MAX_CHUNKS && out.length < PAGE_CAP && in_.length < PAGE_CAP; i++) {
        const toB = latest - i * CHUNK;
        if (toB < 0) break;
        const fromB = Math.max(0, toB - CHUNK + 1);
        const toHex = "0x" + toB.toString(16);
        const fromHex = "0x" + fromB.toString(16);
        try {
          const [o, n] = await Promise.all([
            rpcCall(rpcUrl, "eth_getLogs", [{ fromBlock: fromHex, toBlock: toHex, topics: [TRANSFER_TOPIC, padded] }]),
            rpcCall(rpcUrl, "eth_getLogs", [{ fromBlock: fromHex, toBlock: toHex, topics: [TRANSFER_TOPIC, null, padded] }]),
          ]);
          out = out.concat(o); in_ = in_.concat(n); scanned += (toB - fromB + 1);
        } catch (e) { degraded = true; break; }
        if (fromB === 0) break;
      }
      out = out.slice(0, PAGE_CAP); in_ = in_.slice(0, PAGE_CAP);
      const txCount = out.length + in_.length;

      const counterparties = new Map();
      for (const log of out) { const to = "0x" + (log.topics[2] || "").slice(26).toLowerCase(); if (to.length === 42 && to !== addr) counterparties.set(to, (counterparties.get(to) || 0) + 1); }
      for (const log of in_) { const from = "0x" + (log.topics[1] || "").slice(26).toLowerCase(); if (from.length === 42 && from !== addr) counterparties.set(from, (counterparties.get(from) || 0) + 1); }
      const distinctCounterparties = Math.max(counterparties.size, txCount > 0 ? 1 : 0);
      const topCount = counterparties.size > 0 ? Math.max(...counterparties.values()) : 0;
      const topCounterpartyShare = txCount > 0 ? topCount / txCount : 0;

      const allBlocks = [...out, ...in_].map(l => parseInt(l.blockNumber, 16));
      const earliestBlock = allBlocks.length > 0 ? Math.min(...allBlocks) : latest;
      const ageDays = Math.max(0, Math.floor((latest - earliestBlock) * 2 / 86400));

      const inboundFromFlagged = in_.some(log => OFAC_SET.has("0x" + (log.topics[1] || "").slice(26).toLowerCase()));

      return { ageDays, txCount, distinctCounterparties, topCounterpartyShare, inboundFromFlagged, largestTransferUsd: 0, bounded: true, scannedBlocks: scanned, degraded };
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
    return { address, ...result, signals, scored_at:new Date().toISOString(), oracle:"myriad.synaptiic.org/v1/risk" };
  } };
}
