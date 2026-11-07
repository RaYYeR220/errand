# Review Errand in five minutes

Everything below runs on two Vultr instances and needs no account, key or install.

## 1. Run an errand (about 3–5 minutes of agent time)

Open **https://errand.207-246-93-94.sslip.io** and press **Run an errand**. You become the reviewer of that errand.

Watch the run page:

- **Two supplier panels** fill with live frames from two browsers, each in its own microVM. Under each frame: the microVM's kernel and caps, and the line *placeholder only; real value released to `<supplier host>`*.
- **Offers appear with a check** (`pass` / `fail` / `unverified`) from `clef`. Hover a check for the probabilities. Click a product to open the screenshot it was read from.
- **Landed cost** shows the table the model's code produced inside a no-network microVM, the winner, and whether the control plane's own computation agreed. Open *Code that ran in the sandbox* to read it.

## 2. The containment moment: the held order

When the run reaches **Order held — waiting for you**:

- the **request as held** carries no password: Northwind places the order from the signed-in cart, so the place-order request has no body at all, and the card says so;
- the **order check** lists item, quantity, ship-to and PO number as read by `clef`, and the budget as computed in code;
- **Approve and release** sends the request on to the supplier; **Reject** answers the browser with a 403 and nothing reaches the supplier.

Approve it. The order microVM finishes the checkout, reads the supplier's order number, and is destroyed.

## 3. Check the ledger

At the bottom of the run page, **verify chain** opens `/api/runs/<id>/ledger`: every entry with its `prev_hash` and `hash`, and `"intact": true` when the chain recomputes. **receipt** opens the sealed receipt. The landing page's hero is drawn from the most recent completed errand's real ledger entries.

## 4. The containment numbers

[`eval/results/containment.json`](eval/results/containment.json) — same browser and microVM, real password in the browser vs Errand's placeholder, five ways of sending the credential to an unbound host, three seeds, run on the VX1 instance. Re-run: `cd services/orchestrator && SEEDS=3 npx tsx ../../eval/containment.ts`.

## 5. Where to look in the code

| What | File |
|---|---|
| Destination-bound secrets, microVM lifecycle | [`services/orchestrator/src/sandbox/microsandbox.ts`](services/orchestrator/src/sandbox/microsandbox.ts) |
| The order hold (CDP request interception, fail-closed) | [`services/orchestrator/src/browser/hold.ts`](services/orchestrator/src/browser/hold.ts) |
| Calibrated checks via `/v1/systemone`, budget in code | [`services/orchestrator/src/agent/verify.ts`](services/orchestrator/src/agent/verify.ts) |
| Landed cost in a no-network microVM + reference check | [`services/orchestrator/src/agent/compute.ts`](services/orchestrator/src/agent/compute.ts) |
| Browser operator loop | [`services/orchestrator/src/agent/actor.ts`](services/orchestrator/src/agent/actor.ts) |
| Hash-chained ledger | [`services/orchestrator/src/runs/ledger.ts`](services/orchestrator/src/runs/ledger.ts) |
| Supplier network (Medusa B2B, WooCommerce) | [`suppliers/`](suppliers/) |
| Vultr provisioning and deploy | [`infra/`](infra/) |

Three errands run side by side, each signed in as a different buyer on the Lumen Labs team, so concurrent orders never share a cart. If all three slots are busy, a new errand waits in the queue and the status pill shows its position. Short on time: **Open a finished errand** on the landing page shows a completed run with every frame, check and ledger entry, and the [3-minute video](https://youtu.be/9DKPpHRY748) shows one end to end.
