// mcp.js — MCP transport integration for The Stall
//
// Exposes all STALL capabilities as MCP tools via two transports:
//   - Streamable HTTP (POST /mcp) — stateless, preferred
//   - SSE (GET /sse + POST /messages) — legacy, for clients that require it
// Handlers are called directly — no x402 payment required for MCP callers.
// Direct HTTP calls via /cap/:name remain x402-gated for autonomous agent billing.

import { readFileSync } from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

// Session store for SSE connections (in-memory, per-process)
const sseSessions = new Map();

const { version: PKG_VERSION } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

// Convert a single JSON Schema property descriptor to a Zod type
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
  const server = new McpServer({ name: "The Stall", version: PKG_VERSION });

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

// Returns handlers for SSE transport.
//   app.get("/sse", handlers.connect)
//   app.post("/messages", handlers.message)
export function makeSSEHandlers(capabilities) {
  async function connect(req, res) {
    try {
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      const server = buildServer(capabilities);
      sseSessions.set(sessionId, { transport, server });
      res.on("close", () => {
        sseSessions.delete(sessionId);
        server.close().catch(() => {});
      });
      await server.connect(transport); // also calls transport.start()
    } catch (err) {
      console.error("[SSE] connect error:", err);
      if (!res.headersSent) res.status(500).end("SSE setup failed");
    }
  }

  async function message(req, res) {
    const sessionId = req.query.sessionId;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
    const session = sseSessions.get(String(sessionId));
    if (!session) return res.status(404).json({ error: "Unknown session" });
    try {
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      console.error("[SSE] message error:", err);
      if (!res.headersSent) res.status(500).end("Message handling failed");
    }
  }

  return { connect, message };
}

// Returns an Express request handler for POST /mcp.
// Attach with: app.post("/mcp", makeMcpHandler(capabilities))
export function makeMcpHandler(capabilities) {
  return async (req, res) => {
    // Normalize Accept header — the MCP SDK requires both "application/json" and
    // "text/event-stream" as literal substrings (it uses string.includes, not proper
    // content negotiation). Crawlers often send Accept: */* or omit the header entirely.
    // @hono/node-server reads rawHeaders (not req.headers), so we replace the whole array.
    const accept = req.headers["accept"] || "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      const normalized = "application/json, text/event-stream";
      req.headers["accept"] = normalized;
      // Replace rawHeaders so @hono/node-server sees the correct Accept value
      const newRaw = [];
      let found = false;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i].toLowerCase() === "accept") {
          newRaw.push("accept", normalized);
          found = true;
        } else {
          newRaw.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
        }
      }
      if (!found) newRaw.push("accept", normalized);
      req.rawHeaders = newRaw;
    }
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
