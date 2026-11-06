"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { rememberReviewToken, startErrand } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await startErrand({});
      rememberReviewToken(r.id, r.review_token);
      router.push(`/errands/${r.id}#review=${r.review_token}`);
    } catch (e) {
      setError(String((e as Error).message));
      setBusy(false);
    }
  };
  return (
    <main className="shell">
      <h1 className="run-title">Your agent works signed in. It never sees the password.</h1>
      <button className="btn primary" onClick={run} disabled={busy}>
        {busy ? "Starting…" : "Run an errand"}
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
