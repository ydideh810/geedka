export function createReplayGuard({ ttlSeconds = 60*60*24*45 } = {}) {
  const seen = new Map();
  function prune(){ const now=Date.now(); for(const[k,exp]of seen) if(exp<=now) seen.delete(k); }
  return {
    claim(settlementId){ if(!settlementId) throw new Error("settlementId required"); prune(); if(seen.has(settlementId)) return false; seen.set(settlementId, Date.now()+ttlSeconds*1000); return true; },
    size(){ return seen.size; },
  };
}
// in-memory = single-instance only. Back with SQLite before multi-instance (RR-3).
