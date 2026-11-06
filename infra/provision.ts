/**
 * Provision Errand on Vultr with the Vultr API v2:
 *   - one VX1 instance (nested virtualization → Microsandbox microVMs) for the control plane
 *   - one Cloud Compute instance for the demo supplier network
 *   - a firewall group that admits only HTTP/HTTPS and SSH
 *
 * Usage: VULTR_API_KEY=... SSH_KEY_NAME=... npx tsx infra/provision.ts [--region ewr]
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const API = "https://api.vultr.com/v2";
const key = process.env.VULTR_API_KEY;
if (!key) throw new Error("VULTR_API_KEY is required");
const region = process.argv.includes("--region") ? process.argv[process.argv.indexOf("--region") + 1]! : "ewr";
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

async function vultr<T = any>(method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const userData = (file: string) => Buffer.from(readFileSync(path.join(here, "cloud-init", file), "utf8")).toString("base64");

async function osId(name: RegExp) {
  const { os } = await vultr<{ os: { id: number; name: string }[] }>("GET", "/os?per_page=500");
  const hit = os.find((o) => name.test(o.name));
  if (!hit) throw new Error(`no OS matching ${name}`);
  return hit.id;
}

async function sshKeyId() {
  const want = process.env.SSH_KEY_NAME;
  const { ssh_keys } = await vultr<{ ssh_keys: { id: string; name: string }[] }>("GET", "/ssh-keys");
  return want ? ssh_keys.find((k) => k.name === want)?.id : ssh_keys[0]?.id;
}

async function firewall() {
  const existing = await vultr<{ firewall_groups: { id: string; description: string }[] }>("GET", "/firewalls?per_page=100");
  const found = existing.firewall_groups.find((g) => g.description === "errand-web");
  if (found) return found.id;
  const { firewall_group } = await vultr("POST", "/firewalls", { description: "errand-web" });
  for (const port of ["22", "80", "443"]) {
    for (const ip_type of ["v4", "v6"]) {
      await vultr("POST", `/firewalls/${firewall_group.id}/rules`, { ip_type, protocol: "tcp", subnet: ip_type === "v4" ? "0.0.0.0" : "::", subnet_size: 0, port });
    }
  }
  return firewall_group.id as string;
}

const ubuntu = await osId(/^Ubuntu 24\.04 LTS x64$/);
const ssh = await sshKeyId();
const fw = await firewall();

const control = await vultr("POST", "/instances", {
  region,
  plan: process.env.CONTROL_PLAN ?? "vx1-g-2c-8g-120s",
  os_id: ubuntu,
  label: "errand-control",
  hostname: "errand-control",
  tags: ["errand"],
  firewall_group_id: fw,
  user_data: userData("control.yaml"),
  ...(ssh ? { sshkey_id: [ssh] } : {}),
});
const suppliers = await vultr("POST", "/instances", {
  region,
  plan: process.env.SUPPLIERS_PLAN ?? "vc2-2c-4gb",
  os_id: ubuntu,
  label: "errand-suppliers",
  hostname: "errand-suppliers",
  tags: ["errand"],
  firewall_group_id: fw,
  user_data: userData("suppliers.yaml"),
  ...(ssh ? { sshkey_id: [ssh] } : {}),
});

console.log(JSON.stringify({ region, firewall_group: fw, control: control.instance.id, suppliers: suppliers.instance.id }, null, 2));
console.log("Wait for both instances to report main_ip, then point BASE_DOMAIN at <supplier-ip>.sslip.io.");
