import Fastify from "fastify";
import cors from "@fastify/cors";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { enqueue, runs, decideHold, queuePosition } from "./runs/runner.js";
import { verifyChain } from "./runs/ledger.js";
import { supplierDefs } from "./suppliers.js";
import * as sandboxes from "./sandbox/microsandbox.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 2 * 1024 * 1024 });
await app.register(cors, { origin: true });

const DEFAULT_TASK =
  "Order 12 USB-C docking stations for the new hires. Each must drive two 4K monitors and deliver at least 90 W to the laptop. Budget $2,400 all-in, and they must arrive within 3 business days.";

const RunBody = z.object({
  task: z.string().min(10).max(2000).default(DEFAULT_TASK),
  quantity: z.number().int().min(1).max(500).default(12),
  budget_usd: z.number().positive().max(100_000).default(2400),
  deadline_business_days: z.number().int().min(1).max(60).default(3),
  ship_to: z.string().min(5).max(300).default("Lumen Labs, 500 Market St, Suite 400, San Francisco, CA 94105"),
  suppliers: z.array(z.string()).min(1).max(5).optional(),
  test_case: z.string().regex(/^[a-z0-9-]{1,32}$/).optional(),
  auto_approve: z.boolean().optional(),
});

app.get("/api/health", async () => {
  const keyed = Boolean(config.inference.apiKey);
  return {
    ok: true,
    inference: { base_url: config.inference.baseUrl, configured: keyed, models: config.inference.models },
    sandboxes: { backend: "microsandbox", live: sandboxes.liveCount() },
    suppliers: supplierDefs().map((s) => s.id),
    runs: { total: runs.size },
  };
});

app.get("/api/suppliers", async () =>
  supplierDefs().map((s) => ({ id: s.id, name: s.name, platform: s.platform, base_url: s.base_url.replace("{BASE_DOMAIN}", config.suppliers.baseDomain) })),
);

app.post("/api/runs", async (req, reply) => {
  const body = RunBody.parse(req.body ?? {});
  if (body.auto_approve && req.headers.authorization !== `Bearer ${config.adminToken}`) {
    return reply.code(403).send({ error: "auto_approve is reserved for evaluation runs" });
  }
  const run = enqueue({ ...body, suppliers: body.suppliers ?? supplierDefs().map((s) => s.id) });
  return reply.code(202).send({ id: run.state.id, status: run.state.status, queue_position: queuePosition(run.state.id) });
});

app.get("/api/runs", async () =>
  [...runs.values()]
    .map((r) => ({ id: r.state.id, status: r.state.status, created_at: r.state.created_at, test_case: r.state.request.test_case, order: r.state.order?.status }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 50),
);

app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
  const run = runs.get(req.params.id);
  if (!run) return reply.code(404).send({ error: "not found" });
  return { ...run.state, queue_position: queuePosition(run.state.id) };
});

app.get<{ Params: { id: string } }>("/api/runs/:id/ledger", async (req, reply) => {
  const run = runs.get(req.params.id);
  if (!run) return reply.code(404).send({ error: "not found" });
  const broken = verifyChain(run.ledger.entries);
  return { intact: broken === -1, first_broken: broken, head: run.ledger.head, entries: run.ledger.entries };
});

app.get<{ Params: { id: string } }>("/api/runs/:id/events", async (req, reply) => {
  const run = runs.get(req.params.id);
  if (!run) return reply.code(404).send({ error: "not found" });
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "access-control-allow-origin": "*",
  });
  const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("state", run.state);
  for (const e of run.ledger.entries) send("entry", e);
  const onEntry = (e: unknown) => send("entry", e);
  const onState = (s: unknown) => send("state", s);
  run.on("entry", onEntry);
  run.on("state", onState);
  const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
  req.raw.on("close", () => {
    clearInterval(ping);
    run.off("entry", onEntry);
    run.off("state", onState);
  });
  return reply;
});

app.get<{ Params: { id: string; name: string } }>("/api/runs/:id/frames/:name", async (req, reply) => {
  const name = path.basename(req.params.name);
  const file = path.join(config.dataDir, "runs", path.basename(req.params.id), "frames", name);
  if (!existsSync(file)) return reply.code(404).send({ error: "not found" });
  reply.header("cache-control", "public, max-age=86400, immutable").type("image/jpeg");
  return reply.send(createReadStream(file));
});

app.get<{ Params: { id: string } }>("/api/runs/:id/receipt", async (req, reply) => {
  const file = path.join(config.dataDir, "runs", path.basename(req.params.id), "receipt.json");
  if (!existsSync(file)) return reply.code(404).send({ error: "not sealed yet" });
  return JSON.parse(readFileSync(file, "utf8"));
});

const Decision = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(300).default("") });

app.post<{ Params: { id: string; holdId: string } }>("/api/runs/:id/holds/:holdId", async (req, reply) => {
  const body = Decision.parse(req.body ?? {});
  const run = runs.get(req.params.id);
  if (!run) return reply.code(404).send({ error: "not found" });
  const verdict = run.state.order?.hold?.verification?.verdict;
  if (body.decision === "approve" && verdict === undefined) {
    return reply.code(409).send({ error: "the order check is still running" });
  }
  const ok = decideHold(req.params.id, req.params.holdId, {
    decision: body.decision,
    reason: body.reason || (body.decision === "approve" ? "Approved by reviewer" : "Rejected by reviewer"),
    by: "reviewer",
  });
  if (!ok) return reply.code(409).send({ error: "no pending hold with that id" });
  return { ok: true };
});

const shutdown = async () => {
  await sandboxes.destroyAll();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
