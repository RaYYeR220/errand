# Claims and their evidence

Each public statement about Errand, the tier of evidence behind it, and how to check it.

- **REPRODUCIBLE** — a script in this repo produces it; run it yourself.
- **VERIFIED-LIVE** — observable on the live deployment right now.
- **NOT-CLAIMED** — said explicitly so nobody reads it in.

| Claim | Tier | Evidence |
|---|---|---|
| With the real password in the browser, it reached an unbound host 15 of 15 times; with Errand, 0 of 15 | REPRODUCIBLE | [`eval/results/containment.json`](eval/results/containment.json) from [`eval/containment.ts`](eval/containment.ts), run on the VX1 instance |
| Sign-in still works: the real value reaches the bound host (3 of 3 positive controls) | REPRODUCIBLE | same file, case `form-urlencoded-bound` |
| A request without the credential to the unbound host still passes (3 of 3) | REPRODUCIBLE | same file, case `no-credential-unbound` (the sandbox is not simply blocking everything) |
| Every browser and every piece of model-written code runs in its own microVM with its own kernel | VERIFIED-LIVE | each run page shows the kernel and caps per microVM; ledger `sandbox` entries record start and destroy |
| The landed-cost microVM has no network | REPRODUCIBLE | `createComputeSandbox` in [`microsandbox.ts`](services/orchestrator/src/sandbox/microsandbox.ts) (`disableNetwork()`); the run page shows `no network` |
| The order request is held until a person approves it; a failing check rejects it | VERIFIED-LIVE | run page *Order held* card; ledger `hold` / `verify` / `approval` entries; logic in [`hold.ts`](services/orchestrator/src/browser/hold.ts) and [`runner.ts`](services/orchestrator/src/runs/runner.ts) |
| The held request body contains no password | VERIFIED-LIVE | the *Request body as held* panel on a held order |
| All model calls go to Vultr Serverless Inference, and the answering model is checked | VERIFIED-LIVE | `/api/health`; `sameModel` check in [`client.ts`](services/orchestrator/src/inference/client.ts); `model` recorded in ledger entries |
| The first live errand on Vultr picked Northwind's Dell WD19S at $2,340.00 and placed the order after review | VERIFIED-LIVE | the landing hero links to that errand; its ledger and receipt are public |
| That pick is the only one that meets every constraint | REPRODUCIBLE | [`suppliers/EXPECTED.md`](suppliers/EXPECTED.md), `python suppliers/scripts/reference_task.py`; `reproduces the supplier network's reference answer` test |
| The ledger is hash-chained and tamper-evident | REPRODUCIBLE | [`ledger.test.ts`](services/orchestrator/src/runs/ledger.test.ts) (edited and removed entries are detected); `/api/runs/<id>/ledger` returns `intact` |
| 24 unit tests pass | REPRODUCIBLE | `pnpm -r test` |

## NOT-CLAIMED

- That page text never steers the agent. Steering was not measured; the guarantees above hold whether or not it is steered.
- That the session cookie stays out of the browser. It does not; the password does.
- That the order hold stops requests from processes other than the browser inside the microVM.
- That `clef` checks money. It does not; the budget is computed in code.
- That the suppliers are real distributors. They are a demo network on real open-source commerce software, paid "on account"; no money moves.
