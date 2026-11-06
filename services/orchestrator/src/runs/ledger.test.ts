import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Ledger, verifyChain, canonical, GENESIS } from "./ledger.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "ledger-"));

describe("ledger", () => {
  it("chains every entry to the previous hash", () => {
    const l = new Ledger("r1", dir());
    l.append("run", "a");
    l.append("agent", "b", { x: 1 }, "northwind");
    l.append("hold", "c");
    expect(l.entries[0]!.prev_hash).toBe(GENESIS);
    expect(l.entries[1]!.prev_hash).toBe(l.entries[0]!.hash);
    expect(verifyChain(l.entries)).toBe(-1);
  });

  it("detects an edited entry and points at it", () => {
    const l = new Ledger("r2", dir());
    l.append("run", "a");
    l.append("approval", "Released by reviewer", { decision: "approve" });
    l.append("receipt", "sealed");
    const tampered = l.entries.map((e) => ({ ...e }));
    tampered[1] = { ...tampered[1]!, data: { decision: "reject" } };
    expect(verifyChain(tampered)).toBe(1);
  });

  it("detects a removed entry", () => {
    const l = new Ledger("r3", dir());
    for (const t of ["a", "b", "c", "d"]) l.append("agent", t);
    const cut = [l.entries[0]!, l.entries[2]!, l.entries[3]!];
    expect(verifyChain(cut)).toBe(1);
  });

  it("canonical JSON is key-order independent", () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(canonical({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
});
