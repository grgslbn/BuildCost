"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Play } from "lucide-react";

type DossierItem = { dossierId: string; fileName: string };
type ProgressItem = { name: string; status: "pending" | "running" | "done" | "error"; detail?: string };

export function StartRunButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "config" | "running" | "done">("idle");
  const [runName, setRunName] = useState("");
  const [mode, setMode] = useState<"all" | "difficult">("all");

  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [stats, setStats] = useState({ succeeded: 0, failed: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  async function startRun() {
    setState("running");
    setError(null);

    // 1. Create run
    const createRes = await fetch("/api/prompt-lab/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: runName || undefined, mode }),
    });
    const createData = await createRes.json();

    if (!createData.runId) {
      setError(createData.error || "Failed to create run");
      setState("idle");
      return;
    }

    const { runId, dossiers } = createData as { runId: string; dossiers: DossierItem[] };

    // 2. Initialize progress
    const items: ProgressItem[] = dossiers.map((d) => ({
      name: d.fileName,
      status: "pending" as const,
    }));
    setProgress([...items]);
    setStats({ succeeded: 0, failed: 0, total: dossiers.length });

    let succeeded = 0;
    let failed = 0;

    // 3. Process dossiers one by one
    // Flow: init (create estimation) → estimate-process (fire-and-forget) → poll DB → record (compare + store)
    for (let i = 0; i < dossiers.length; i++) {
      items[i].status = "running";
      setProgress([...items]);

      try {
        const dossierId = dossiers[i].dossierId;

        // Step 1: create estimation row
        const initRes = await fetch(`/api/prompt-lab/run/${runId}/init`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dossierId }),
        });
        const initData = await initRes.json();
        if (!initData.estimationId) throw new Error(initData.error ?? "Init failed");

        // Step 2: fire estimate-process — do NOT await the HTTP response.
        // The AI pipeline can take 60–300 s; waiting for the response causes
        // CDN/proxy timeouts that surface as spurious 401/504 errors.
        // This matches the pattern used by the regular estimate page.
        // Benchmark runs use reduced resolution + lower priority than customer estimates.
        fetch("/api/estimate-process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estimationId: initData.estimationId,
            maxWidth: 2500,
            dpi: 150,
            maxPages: 10,
            jobType: "benchmark",
            priority: 10,
          }),
        }).catch(() => {}); // intentional fire-and-forget

        // Step 3: poll the DB until estimation reaches a terminal state (max 10 min)
        // Vercel Pro functions have 300s limit, but cold starts + network add overhead.
        // 240 × 2.5s = 600s = 10 min gives ample buffer.
        const MAX_POLLS = 240;
        let pollDone = false;
        for (let p = 0; p < MAX_POLLS; p++) {
          await new Promise((r) => setTimeout(r, 2500));
          try {
            const pollRes = await fetch(
              `/api/prompt-lab/poll-estimation/${initData.estimationId}`
            );
            if (pollRes.ok) {
              const { done } = (await pollRes.json()) as { done: boolean };
              if (done) { pollDone = true; break; }
            }
          } catch { /* network hiccup — retry */ }
        }
        if (!pollDone) throw new Error("Estimation timed out (>10 min)");

        // Step 4: record result (compare with ground truth)
        const recordRes = await fetch(`/api/prompt-lab/run/${runId}/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dossierId, estimationId: initData.estimationId }),
        });
        const data = await recordRes.json();

        if (data.success) {
          const costErr = data.costErrorPct;
          items[i].status = "done";
          items[i].detail = costErr != null
            ? `${costErr > 0 ? "+" : ""}${costErr.toFixed(1)}%`
            : "ok";
          succeeded++;
        } else {
          items[i].status = "error";
          items[i].detail = data.error?.slice(0, 50) ?? "Error";
          failed++;
        }
      } catch (err) {
        items[i].status = "error";
        items[i].detail = err instanceof Error ? err.message.slice(0, 50) : "Error";
        failed++;
      }

      setProgress([...items]);
      setStats({ succeeded, failed, total: dossiers.length });
    }

    // 4. Finalize run (compute aggregates)
    try {
      await fetch(`/api/prompt-lab/run/${runId}/finalize`, { method: "POST" });
    } catch { /* best effort */ }

    setState("done");
    router.refresh();
  }

  const running = state === "running";
  const current = progress.filter((p) => p.status === "done" || p.status === "error").length;

  return (
    <div className="space-y-3">
      {state === "idle" && (
        <Button onClick={() => setState("config")} variant="outline" size="sm">
          <Play className="mr-2 h-4 w-4" /> Start Run
        </Button>
      )}

      {state === "config" && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name (optional)</label>
            <Input
              placeholder="Auto-generated from active prompt versions..."
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Mode</label>
            <div className="flex gap-2">
              <Button
                variant={mode === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("all")}
              >
                All dossiers
              </Button>
              <Button
                variant={mode === "difficult" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("difficult")}
              >
                Difficult only (&gt;15%)
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={startRun} size="sm">
              <Play className="mr-2 h-4 w-4" /> Start
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setState("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {running && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{current}/{stats.total} dossiers processed...</span>
          </div>
          {/* Progress bar */}
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${stats.total ? (current / stats.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {(running || state === "done") && stats.total > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {progress.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {item.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-amber-500 shrink-0" />}
              {item.status === "done" && <span className="text-green-600 shrink-0">✓</span>}
              {item.status === "error" && <span className="text-destructive shrink-0">✗</span>}
              {item.status === "pending" && <span className="text-muted-foreground shrink-0">·</span>}
              <span className="truncate">{item.name}</span>
              {item.detail && (
                <span className={`ml-auto shrink-0 ${item.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                  {item.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {state === "done" && (
        <p className="text-xs text-muted-foreground">
          Done: {stats.succeeded} succeeded, {stats.failed} failed
        </p>
      )}
    </div>
  );
}
