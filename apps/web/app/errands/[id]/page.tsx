import { Suspense } from "react";
import { RunView } from "@/components/run/RunView";

export default function ErrandPage({ params }: PageProps<"/errands/[id]">) {
  return (
    <main className="shell">
      <Suspense fallback={<div className="run-empty">Loading errand…</div>}>
        <Errand params={params} />
      </Suspense>
    </main>
  );
}

async function Errand({ params }: { params: PageProps<"/errands/[id]">["params"] }) {
  const { id } = await params;
  return <RunView id={id} />;
}
