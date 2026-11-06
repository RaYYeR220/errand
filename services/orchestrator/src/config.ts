import path from "node:path";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

export const config = {
  port: Number(env("PORT", "4000")),
  publicUrl: env("PUBLIC_URL", "http://localhost:4000"),
  dataDir: path.resolve(env("DATA_DIR", "./data")),
  /** Required for evaluation-only features (auto-approve). Unset → those features are off. */
  adminToken: optional("ADMIN_TOKEN"),
  /**
   * Company deployment: when set, creating an errand requires `Authorization: Bearer <RUN_TOKEN>`.
   * The public demo leaves it unset so visitors can run errands against the demo supplier network.
   */
  runToken: optional("RUN_TOKEN"),
  /** The company's address book; an errand can only ship to one of these. */
  companyAddresses: (process.env.COMPANY_ADDRESSES ?? "Lumen Labs, 500 Market St, Suite 400, San Francisco, CA 94105|Lumen Labs Warehouse, 2200 Harbor Blvd, Oakland, CA 94607")
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean),
  /** Origin of the web app allowed by CORS. */
  webOrigin: env("WEB_ORIGIN", "http://localhost:3317"),

  inference: {
    baseUrl: env("INFERENCE_BASE_URL", "https://api.vultrinference.com/v1"),
    apiKey: optional("INFERENCE_API_KEY"),
    models: {
      planner: env("MODEL_PLANNER", "glm-5.3"),
      actor: env("MODEL_ACTOR", "glm-5.3-flash"),
      coder: env("MODEL_CODER", "glm-5.3"),
      verifier: env("MODEL_VERIFIER", "clef"),
      safety: env("MODEL_SAFETY", "nemotron-3.5-content-safety"),
    },
  },

  hold: {
    timeoutS: Number(env("HOLD_TIMEOUT_S", "600")),
  },

  suppliers: {
    file: env("SUPPLIERS_FILE", "../../suppliers/suppliers.json"),
    baseDomain: env("BASE_DOMAIN", "localtest.me"),
    scheme: env("SUPPLIER_SCHEME", "https"),
  },

  receipts: {
    endpoint: optional("OBJECT_STORAGE_ENDPOINT"),
    bucket: optional("OBJECT_STORAGE_BUCKET"),
    accessKey: optional("OBJECT_STORAGE_ACCESS_KEY"),
    secretKey: optional("OBJECT_STORAGE_SECRET_KEY"),
    region: env("OBJECT_STORAGE_REGION", "us-east-1"),
  },

  limits: {
    maxConcurrentRuns: Number(env("MAX_CONCURRENT_RUNS", "2")),
    actorMaxSteps: Number(env("ACTOR_MAX_STEPS", "40")),
    browserMemoryMb: Number(env("BROWSER_MEMORY_MB", "1536")),
    computeMemoryMb: Number(env("COMPUTE_MEMORY_MB", "512")),
  },
};
