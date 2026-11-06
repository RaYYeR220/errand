import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { config } from "./config.js";
import { enqueue, runs } from "./runs/runner.js";
import { supplierDefs } from "./suppliers.js";

/**
 * MCP endpoint: other agents can send Errand on a purchasing errand and follow it.
 * There is deliberately no approve tool — releasing a held order stays with a person in the web app.
 */
function buildServer() {
  const server = new McpServer({ name: "errand", version: "0.1.0" });

  server.registerTool(
    "list_suppliers",
    { description: "List the supplier portals Errand can sign in to for this company.", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: JSON.stringify(supplierDefs().map((s) => ({ id: s.id, name: s.name, platform: s.platform })), null, 2) }] }),
  );

  server.registerTool(
    "run_errand",
    {
      description:
        "Start a purchasing errand: Errand signs in to the supplier portals in disposable microVMs (the browser never holds the passwords), compares offers, and prepares the order. " +
        "The order is held until a person approves it at the returned review_url.",
      inputSchema: {
        task: z.string().min(10).max(2000).describe("What to buy and any constraints, in plain language."),
        quantity: z.number().int().min(1).max(500),
        budget_usd: z.number().positive().max(100_000),
        deadline_business_days: z.number().int().min(1).max(60),
        ship_to: z.string().min(5).max(300),
        suppliers: z.array(z.string().max(40)).min(1).max(5).optional(),
      },
    },
    async (args) => {
      let run;
      try {
        run = enqueue(args);
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: String((e as Error).message).slice(0, 300) }] };
      }
      const review_url = `${config.webOrigin}/errands/${run.state.id}#review=${run.reviewToken}`;
      return { content: [{ type: "text", text: JSON.stringify({ id: run.state.id, status: run.state.status, review_url }, null, 2) }] };
    },
  );

  server.registerTool(
    "get_errand",
    { description: "Current status of an errand: per-supplier quotes with verification, the landed-cost comparison, and the held order.", inputSchema: { id: z.string() } },
    async ({ id }) => {
      const run = runs.get(id);
      if (!run) return { isError: true, content: [{ type: "text", text: `No errand ${id}` }] };
      const s = run.state;
      const summary = {
        id: s.id,
        status: s.status,
        suppliers: s.suppliers.map((x) => ({ id: x.id, status: x.status, quotes: x.quotes.map((q) => ({ ...q.quote, verdict: q.verification.verdict })) })),
        winner: s.compute?.result.winner ?? null,
        order: s.order ? { supplier: s.order.supplier, product: s.order.product, quantity: s.order.quantity, po_number: s.order.po_number, status: s.order.status, order_number: s.order.order_number } : null,
        ledger_head: s.ledger_head,
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  );

  return server;
}

function authorized(header: string | undefined): boolean {
  const token = process.env.MCP_TOKEN;
  if (!token || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerMcp(app: FastifyInstance) {
  app.post("/mcp", async (req, reply) => {
    if (!authorized(req.headers.authorization)) return reply.code(401).send({ error: "MCP token required" });
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  app.get("/mcp", async (_req, reply) => reply.code(405).send({ error: "use POST" }));
}
