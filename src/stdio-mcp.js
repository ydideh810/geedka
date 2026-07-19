// stdio-mcp.js — Stdio MCP entrypoint for Glama / mcp-proxy compatibility.
//
// Exposes all MYRIAD capabilities as MCP tools over StdioServerTransport.
// stdout is reserved exclusively for JSON-RPC frames — no banner, no logging.
// All diagnostic output goes to stderr so the mcp-proxy handshake succeeds.
//
// Run directly:   node src/stdio-mcp.js
// Via mcp-proxy:  npx -y mcp-proxy -- node src/stdio-mcp.js
//
// Does NOT start the HTTP listener or initialize the x402 facilitator —
// tool enumeration is payment-independent and completes instantly.

import "dotenv/config";
import { readFileSync } from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadCapabilities } from "./registry.js";

const { version: PKG_VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url))
);

// Mirrors propToZod / buildZodShape / buildServer from mcp.js.
// loadCapabilities() is the single source of truth for the cap list — no drift.
function propToZod(prop) {
  let base;
  if (prop.type === "integer") base = z.number().int();
  else if (prop.type === "number") base = z.number();
  else if (prop.type === "boolean") base = z.boolean();
  else if (prop.type === "array") base = z.array(propToZod(prop.items ?? { type: "string" }));
  else base = z.string();
  if (prop.description && typeof base.describe === "function") base = base.describe(prop.description);
  return base;
}

function buildZodShape(inputSchema) {
  const required = new Set(inputSchema?.required ?? []);
  const shape = {};
  for (const [key, prop] of Object.entries(inputSchema?.properties ?? {})) {
    const base = propToZod(prop);
    shape[key] = required.has(key) ? base : base.optional();
  }
  return shape;
}

const capabilities = await loadCapabilities();
process.stderr.write(`[stdio-mcp] loaded ${capabilities.length} capabilities (v${PKG_VERSION})\n`);

const server = new McpServer({ name: "MYRIAD", version: PKG_VERSION });

for (const cap of capabilities) {
  const inputSchema = buildZodShape(cap.inputSchema);
  server.registerTool(
    cap.name,
    { description: cap.description, inputSchema },
    async (params) => {
      try {
        const result = await cap.handler(params, {});
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${String(err?.message ?? err)}` }],
          isError: true,
        };
      }
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[stdio-mcp] MCP stdio transport connected — ${capabilities.length} tools available\n`);
