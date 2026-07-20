// mcp.js — MCP transport integration for MYRIAD
//
// Exposes all enabled MYRIAD capabilities as MCP tools via two transports:
//   - Streamable HTTP (POST /mcp) — stateless, preferred
//   - SSE (GET /sse + POST /messages) — legacy
//
// MCP discovery is free.
// MCP tool execution requires a valid MYRIAD prepaid Bearer token.
// Capability cost is derived from its existing USD/x402 price:
//   1 MYRIAD credit = $0.001 of capability usage.

import { readFileSync } from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

import { creditsForPrice } from "./stripe-rail.js";

// Session store for SSE connections (in-memory, per-process)
const sseSessions = new Map();

const { version: PKG_VERSION } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url))
);

// Convert a single JSON Schema property descriptor to a Zod type
function propToZod(prop) {
  let base;

  if (prop.type === "integer") {
    base = z.number().int();
  } else if (prop.type === "number") {
    base = z.number();
  } else if (prop.type === "boolean") {
    base = z.boolean();
  } else if (prop.type === "array") {
    base = z.array(
      propToZod(
        prop.items ?? {
          type: "string",
        }
      )
    );
  } else {
    base = z.string();
  }

  if (
    prop.description &&
    typeof base.describe === "function"
  ) {
    base = base.describe(prop.description);
  }

  return base;
}

// Build a Zod raw shape from a JSON Schema inputSchema object
function buildZodShape(inputSchema) {
  const required = new Set(
    inputSchema?.required ?? []
  );

  const shape = {};

  for (
    const [key, prop] of Object.entries(
      inputSchema?.properties ?? {}
    )
  ) {
    const base = propToZod(prop);

    shape[key] = required.has(key)
      ? base
      : base.optional();
  }

  return shape;
}

// Build a fresh MCP server.
//
// Discovery operations such as tools/list are free because they never invoke
// the registered tool callbacks.
//
// Billing occurs only when a registered MYRIAD tool is actually executed.
function buildServer(
  capabilities,
  consumeCredits,
  authHeader
) {
  const server = new McpServer({
    name: "MYRIAD",
    version: PKG_VERSION,
  });

  for (const cap of capabilities) {
    const inputSchema =
      buildZodShape(cap.inputSchema);

    server.registerTool(
      cap.name,

      {
        description:
          `${cap.description} ` +
          `[MYRIAD cost: ${creditsForPrice(cap.price)} credits / ${cap.price}]`,

        inputSchema,
      },

      async (params) => {
        // Derive prepaid-credit cost from the capability's canonical price.
        //
        // Examples:
        // $0.001 -> 1 credit
        // $0.012 -> 12 credits
        // $0.200 -> 200 credits
        const creditCost =
          creditsForPrice(cap.price);

        // No billing implementation available.
        if (
          typeof consumeCredits !== "function"
        ) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "myriad_billing_unavailable",

                    capability:
                      cap.name,

                    credits_required:
                      creditCost,

                    message:
                      "MYRIAD prepaid billing is currently unavailable.",
                  },
                  null,
                  2
                ),
              },
            ],

            isError: true,
          };
        }

        // Validate token and debit the capability cost.
        const payment =
          consumeCredits(
            authHeader,
            creditCost
          );

        if (!payment.ok) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error:
                      "myriad_payment_required",

                    capability:
                      cap.name,

                    price:
                      cap.price,

                    credits_required:
                      creditCost,

                    credits_remaining:
                      payment.creditsRemaining ??
                      null,

                    reason:
                      payment.reason,

                    message:
                      "A valid MYRIAD prepaid Bearer token with sufficient credits is required to execute this capability.",
                  },
                  null,
                  2
                ),
              },
            ],

            isError: true,
          };
        }

        try {
          const result =
            await cap.handler(
              params,
              {}
            );

          return {
            content: [
              {
                type: "text",

                text: JSON.stringify(
                  {
                    result,

                    _myriad: {
                      capability:
                        cap.name,

                      price:
                        cap.price,

                      credits_used:
                        payment.creditsUsed,

                      credits_remaining:
                        payment.creditsRemaining,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (err) {
          // NOTE:
          // Credits have already been consumed at this point.
          //
          // In the next billing iteration we will replace immediate debit
          // with reserve -> execute -> commit/refund.
          return {
            content: [
              {
                type: "text",

                text: JSON.stringify(
                  {
                    error:
                      "capability_error",

                    capability:
                      cap.name,

                    message:
                      String(
                        err?.message ??
                        err
                      ),

                    credits_used:
                      payment.creditsUsed,

                    credits_remaining:
                      payment.creditsRemaining,
                  },
                  null,
                  2
                ),
              },
            ],

            isError: true,
          };
        }
      }
    );
  }

  return server;
}


// -----------------------------------------------------------------------------
// SSE TRANSPORT
// -----------------------------------------------------------------------------
//
// Authorization is captured when the SSE session is opened and remains attached
// to that MCP server instance for the lifetime of the session.

export function makeSSEHandlers(
  capabilities,
  consumeCredits
) {
  async function connect(req, res) {
    try {
      const authHeader =
        req.headers.authorization || "";

      const transport =
        new SSEServerTransport(
          "/messages",
          res
        );

      const sessionId =
        transport.sessionId;

      const server =
        buildServer(
          capabilities,
          consumeCredits,
          authHeader
        );

      sseSessions.set(
        sessionId,
        {
          transport,
          server,
        }
      );

      res.on(
        "close",
        () => {
          sseSessions.delete(
            sessionId
          );

          server
            .close()
            .catch(
              () => {}
            );
        }
      );

      await server.connect(
        transport
      );

    } catch (err) {
      console.error(
        "[SSE] connect error:",
        err
      );

      if (!res.headersSent) {
        res
          .status(500)
          .end(
            "SSE setup failed"
          );
      }
    }
  }


  async function message(req, res) {
    const sessionId =
      req.query.sessionId;

    if (!sessionId) {
      return res
        .status(400)
        .json({
          error:
            "Missing sessionId",
        });
    }

    const session =
      sseSessions.get(
        String(sessionId)
      );

    if (!session) {
      return res
        .status(404)
        .json({
          error:
            "Unknown session",
        });
    }

    try {
      await session.transport
        .handlePostMessage(
          req,
          res,
          req.body
        );

    } catch (err) {
      console.error(
        "[SSE] message error:",
        err
      );

      if (!res.headersSent) {
        res
          .status(500)
          .end(
            "Message handling failed"
          );
      }
    }
  }

  return {
    connect,
    message,
  };
}


// -----------------------------------------------------------------------------
// STREAMABLE HTTP TRANSPORT
// -----------------------------------------------------------------------------
//
// Attach with:
//
// app.post(
//   "/mcp",
//   makeMcpHandler(
//     capabilities,
//     stripeRail.consumeCredits
//   )
// );
//
// The Authorization header is captured for the current stateless MCP request.
// Tool discovery remains free; tool callbacks enforce billing.

export function makeMcpHandler(
  capabilities,
  consumeCredits
) {
  return async (req, res) => {

    const authHeader =
      req.headers.authorization || "";

    // Normalize Accept header.
    //
    // The MCP SDK requires both application/json and text/event-stream
    // in many client scenarios.
    const accept =
      req.headers["accept"] || "";

    const wantsJsonOnly =
      accept.includes(
        "application/json"
      ) &&
      !accept.includes(
        "text/event-stream"
      ) &&
      !accept.includes(
        "*/*"
      );

    if (
      !wantsJsonOnly &&
      (
        !accept.includes(
          "application/json"
        ) ||
        !accept.includes(
          "text/event-stream"
        )
      )
    ) {
      const normalized =
        "application/json, text/event-stream";

      req.headers["accept"] =
        normalized;

      const newRaw = [];

      let found = false;

      for (
        let i = 0;
        i < req.rawHeaders.length;
        i += 2
      ) {
        if (
          req.rawHeaders[
            i
          ].toLowerCase() ===
          "accept"
        ) {
          newRaw.push(
            "accept",
            normalized
          );

          found = true;

        } else {
          newRaw.push(
            req.rawHeaders[i],
            req.rawHeaders[i + 1]
          );
        }
      }

      if (!found) {
        newRaw.push(
          "accept",
          normalized
        );
      }

      req.rawHeaders =
        newRaw;
    }

    const server =
      buildServer(
        capabilities,
        consumeCredits,
        authHeader
      );

    try {
      const transport =
        new StreamableHTTPServerTransport(
          {
            sessionIdGenerator:
              undefined,
          }
        );

      await server.connect(
        transport
      );

      await transport
        .handleRequest(
          req,
          res,
          req.body
        );

      res.on(
        "close",
        () => {
          transport.close();
          server.close();
        }
      );

    } catch (err) {
      console.error(
        "[MCP] request error:",
        err
      );

      if (!res.headersSent) {
        res
          .status(500)
          .json({
            jsonrpc:
              "2.0",

            error: {
              code:
                -32603,

              message:
                "Internal server error",
            },

            id:
              null,
          });
      }
    }
  };
}