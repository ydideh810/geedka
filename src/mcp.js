// mcp.js — MCP Streamable HTTP integration for The Stall
//
// Exposes all STALL capabilities as MCP tools via Streamable HTTP transport.
// Handlers are called directly — no x402 payment required for MCP callers.
// Direct HTTP calls via /cap/:name remain x402-gated for autonomous agent billing.
//
// Each POST /mcp request gets a fresh McpServer + transport (stateless mode).
// This matches the MCP spec: no session state between calls.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Convert a single JSON Schema property descriptor to a Zod type
function propToZod(prop) {
  let base;
  if (prop.type === "integer") base = z.number().int();
  else if (prop.type === "number") base = z.number();
  else base = z.string();
  if (prop.description) base = base.describe(prop.description);
  return base;
}

// Build a Zod raw shape from a JSON Schema inputSchema object
function buildZodShape(inputSchema) {
  const required = new Set(inputSchema?.required ?? []);
  const shape = {};
  for (const [key, prop] of Object.entries(inputSchema?.properties ?? {})) {
    const base = propToZod(prop);
    shape[key] = required.has(key) ? base : base.optional();
  }
  return shape;
}

// Build a fresh McpServer with all STALL capabilities registered as tools.
// Called once per request (stateless transport requires fresh server per request).
function buildServer(capabilities) {
  const server = new McpServer({ name: "The Stall", version: "0.5.0" });

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

  return server;
}

// Returns an Express request handler for POST /mcp.
// Attach with: app.post("/mcp", makeMcpHandler(capabilities))
export function makeMcpHandler(capabilities) {
  return async (req, res) => {
    const server = buildServer(capabilities);
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      console.error("[MCP] request error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };
}
