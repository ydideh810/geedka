// ping.js — the deliberately trivial, domain-agnostic placeholder.
// Its ONLY jobs: (1) let the stall boot green, (2) be a real paid route so the
// first settled payment catalogs the stall into the Bazaar and proves the rail
// end to end. It is NOT the product. The product slot stays empty until
// signal-intel earns the right to fill it. Delete or keep as a heartbeat probe.

export default {
  name: "ping",
  price: "$0.001",
  description: "Liveness + echo probe. Pays back a timestamp and echoes `msg`. Use to verify the x402 rail and Bazaar listing end to end.",
  inputSchema: {
    type: "object",
    properties: { msg: { type: "string", description: "optional string to echo back" } },
  },
  outputSchema: {
    type: "object",
    properties: {
      pong: { type: "boolean" },
      ts: { type: "string" },
      echo: { type: "string" },
    },
  },
  async handler(query) {
    return { pong: true, ts: new Date().toISOString(), echo: query.msg ?? null };
  },
};
