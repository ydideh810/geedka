// _TEMPLATE.js — copy this to capabilities/<your-name>.js to add a capability.
// Files prefixed with "_" are ignored by the registry, so this never mounts.
//
// This is the entire contract between PROSPECTOR's excavation and the Stall.
// PROSPECTOR surfaces a function the bazaar will pay for; you express it here;
// it goes live on the next deploy. The chassis code is never touched.

export default {
  // url-safe id; becomes the route GET /cap/<name>
  name: "example-name",

  // per-call price in USDC, string form
  price: "$0.001",

  // one sentence an AGENT will read to decide whether to pay. Be concrete:
  // what goes in, what comes out, why it's worth a micropayment mid-task.
  description: "What this returns and why an agent would pay for it.",

  // JSON Schema for query params (x402 GET convention). Surfaces in the Bazaar.
  inputSchema: {
    type: "object",
    properties: {
      q: { type: "string", description: "the input" },
    },
    required: ["q"],
  },

  // JSON Schema for the response. Surfaces in the Bazaar.
  outputSchema: {
    type: "object",
    properties: {
      result: { type: "string" },
    },
  },

  // the actual work. `query` = parsed req.query. Return a JSON-serializable object.
  // Keep it fast and deterministic where possible — agents rank on reliability.
  async handler(query /*, { req } */) {
    return { result: `did the thing with: ${query.q}` };
  },
};
