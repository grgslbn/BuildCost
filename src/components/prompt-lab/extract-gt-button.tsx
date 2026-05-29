"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";

type PendingDossier = { id: string; name: string };
type ProgressItem = { name: string; status: "pending" | "running" | "done" | "error"; detail?: string };

export function ExtractGroundTruthButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "running" | "done">("idle");
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [stats, setStats] = useState({ succeeded: 0, failed: 0, total: 0 });

  async function handleClick() {
    setState("loading");

    // Fetch pending dossiers
    const res = await fetch("/api/prompt-lab/extract-gt");
    const { pending, alreadyExtracted } = (await res.json()) as {
      pending: PendingDossier[];
      total: number;
      alreadyExtracted: number;
    };

    if (pending.length === 0) {
      setState("done");
      setStats({ succeeded: 0, failed: 0, total: 0 });
      return;
    }

    // Initialize progress
    const items: ProgressItem[] = pending.map((d) => ({
      name: d.name,
      status: "pending" as const,
    }));
    setProgress([...items]);
    setStats({ succeeded: 0, failed: 0, total: pending.length });
    setState("running");

    let succeeded = 0;
    let failed = 0;

    // Process one by one
    for (let i = 0; i < pending.length; i++) {
      items[i].status = "running";
      setProgress([...items]);

      try {
        const r = await fetch("/api/prompt-lab/extract-gt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dossierId: pending[i].id }),
        });
        const data = await r.json();

        if (data.success) {
          const price = data.result?.expert_total_price;
          items[i].status = "done";
          items[i].detail = price ? `€${Math.round(price).toLocaleString("nl-BE")}` : "extracted";
          succeeded++;
        } else {
          items[i].status = "error";
          items[i].detail = data.error?.slice(0, 60) ?? "Error";
          failed++;
        }
      } catch (err) {
        items[i].status = "error";
        items[i].detail = err instanceof Error ? err.message.slice(0, 60) : "Error";
        failed++;
      }

      setProgress([...items]);
      setStats({ succeeded, failed, total: pending.length });
    }

    setState("done");
    // Refresh page to show new ground truth data
    router.refresh();
  }

  const running = state === "running";
  const done = state === "done";
  const current = progress.filter((p) => p.status === "running").length > 0
    ? progress.findIndex((p) => p.status === "running") + 1
    : stats.succeeded + stats.failed;

  return (
    <div className="space-y-3">
      <Button
        onClick={handleClick}
        disabled={state === "loading" || running}
        variant="outline"
        size="sm"
      >
        {state === "loading" ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
        ) : running ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {current}/{stats.total} extracting...</>
        ) : (
          <><Sparkles className="mr-2 h-4 w-4" /> Extract Expert</>
        )}
      </Button>

      {done && stats.total === 0 && (
        <p className="text-xs text-muted-foreground">Alle dossiers hebben al expert-data.</p>
      )}

      {(running || done) && stats.total > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {progress.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {item.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-amber-500 shrink-0" />}
              {item.status === "done" && <span className="text-green-600 shrink-0">✓</span>}
              {item.status === "error" && <span className="text-destructive shrink-0">✗</span>}
              {item.status === "pending" && <span className="text-muted-foreground shrink-0">·</span>}
              <span className="truncate">{item.name}</span>
              {item.detail && <span className="text-muted-foreground ml-auto shrink-0">{item.detail}</span>}
            </div>
          ))}
        </div>
      )}

      {done && stats.total > 0 && (
        <p className="text-xs text-muted-foreground">
          Done: {stats.succeeded} succeeded, {stats.failed} failed
        </p>
      )}
    </div>
  );
}
