// Re-renders the numbers in README.md from eval/results/*.json, so no figure is typed by hand.
//   node scripts/render-readme.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = path.join(root, "README.md");
const c = JSON.parse(readFileSync(path.join(root, "eval/results/containment.json"), "utf8"));
const b = c.summary.baseline;
const e = c.summary.errand;
const ways = new Set(c.rows.filter((r) => r.host === c.unbound_host && r.case !== "no-credential-unbound").map((r) => r.case)).size;

const block = `<!-- containment:start -->
| Same browser, same microVM | Real password reached a host it is not bound to | Refused outright by the sandbox runtime | Sign-in to the bound host still works |
|---|---|---|---|
| Browser holds the real password (the usual way) | **${b.real_value_reached_unbound_host} / ${b.cases}** | ${b.refused_by_sandbox} / ${b.cases} | ${b.positive_control_real_value_at_bound_host} / ${b.seeds} |
| **Errand** (placeholder + destination-bound secret) | **${e.real_value_reached_unbound_host} / ${e.cases}** | ${e.refused_by_sandbox} / ${e.cases} | ${e.positive_control_real_value_at_bound_host} / ${e.seeds} |

<sub>${ways} ways of sending a credential to an unbound host × ${e.seeds} seeds, on ${c.sandbox.kernel} microVMs on a Vultr VX1 instance. Public echo services report what actually arrived. Source: [\`eval/results/containment.json\`](eval/results/containment.json), produced by [\`eval/containment.ts\`](eval/containment.ts).</sub>
<!-- containment:end -->`;

const text = readFileSync(readme, "utf8");
const next = text.replace(/<!-- containment:start -->[\s\S]*?<!-- containment:end -->/, block);
writeFileSync(readme, next);
console.log(next === text ? "README already up to date" : "README updated from eval results");
