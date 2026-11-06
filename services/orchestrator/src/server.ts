import Fastify from "fastify";
import cors from "@fastify/cors";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { timingSafeEqual } from "node:crypto";
import { enqueue, runs, decideHold, queuePosition, checkReviewToken, ErrandInput, restoreRuns } from "./runs/runner.js";
import { showcase } from "./showcase.js";
import { verifyChain } from "./runs/ledger.js";
import { supplierDefs } from "./suppliers.js";
import * as sandboxes from "./sandbox/microsandbox.js";
import { registerMcp } from "./mcp.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 2 * 1024 * 1024 });
await app.register(cors, { origin: [config.webOrigin] });

function isAdmin(header: string | undefined): boolean {
  if (!config.adminToken || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${config.adminToken}`);
  return a.length === b.length && timingSafeEqual(a, b);
}


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

function hasRunToken(header: string | undefined): boolean {
  if (!config.runToken) return true; // public demo mode
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${config.runToken}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.get("/api/company", async () => ({ addresses: config.companyAddresses, demo_mode: !config.runToken }));

const EVAL_DIR = path.resolve(process.env.EVAL_DIR ?? "../../eval/results");
app.get<{ Params: { name: string } }>("/api/eval/:name", async (req, reply) => {
  if (!/^[a-z0-9-]{1,40}$/.test(req.params.name)) return reply.code(400).send({ error: "bad name" });
  const file = path.join(EVAL_DIR, `${req.params.name}.json`);
  if (!existsSync(file)) return reply.code(404).send({ error: "no such result" });
  reply.header("cache-control", "public, max-age=300");
  return JSON.parse(readFileSync(file, "utf8"));
});

app.get("/api/showcase", async (_req, reply) => {
  const s = showcase();
  return s ?? reply.code(404).send({ error: "no completed errand yet" });
});

app.post("/api/runs", async (req, reply) => {
  if (!hasRunToken(req.headers.authorization) && !isAdmin(req.headers.authorization)) {
    return reply.code(401).send({ error: "this deployment requires a run token" });
  }
  const parsed = ErrandInput.safeParse(req.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: "invalid errand", issues: parsed.error.issues });
  if (parsed.data.auto_approve && !isAdmin(req.headers.authorization)) {
    return reply.code(403).send({ error: "auto_approve is reserved for evaluation runs" });
  }
  let run;
  try {
    run = enqueue(parsed.data);
  } catch (e) {
    return reply.code(400).send({ error: String((e as Error).message).slice(0, 300) });
  }
  return reply.code(202).send({ id: run.state.id, status: run.state.status, queue_position: queuePosition(run.state.id), review_token: run.reviewToken });
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
    "access-control-allow-origin": config.webOrigin,
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
  const token = req.headers["x-review-token"];
  if (!checkReviewToken(run, typeof token === "string" ? token : undefined) && !isAdmin(req.headers.authorization)) {
    return reply.code(403).send({ error: "only the reviewer of this errand can decide its held order" });
  }
  const res = decideHold(req.params.id, req.params.holdId, {
    decision: body.decision,
    reason: body.reason || (body.decision === "approve" ? "Approved by reviewer" : "Rejected by reviewer"),
    by: "reviewer",
  });
  if (!res.ok) return reply.code(409).send({ error: res.error });
  return { ok: true };
});

registerMcp(app);
app.log.info({ restored: restoreRuns() }, "restored errands from disk");

const shutdown = async () => {
  await sandboxes.destroyAll();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: process.env.HOST ?? "127.0.0.1" });
