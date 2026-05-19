"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { markDossierError } from "@/app/actions/mark-dossier-error";

const TIMEOUT_MS = 120_000;

type BatchState = {
  current: number;
  total: number;
  succeeded: number;
  failed: number;
};

async function processOneDossier(id: string): Promise<"success" | "failed"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/process-dossier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dossierId: id }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok ? "success" : "failed";
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      await markDossierError(id, "Processing timed out after 120s").catch(() => {});
    }
    return "failed";
  }
}

export function BatchProcessButton({ dossierIds }: { dossierIds: string[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<BatchState | null>(null);

  if (dossierIds.length === 0) return null;

  async function handleBatch() {
    if (running) return;
    setRunning(true);
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < dossierIds.length; i++) {
      setState({ current: i + 1, total: dossierIds.length, succeeded, failed });
      try {
        const result = await processOneDossier(dossierIds[i]);
        if (result === "success") succeeded++;
        else failed++;
      } catch {
        failed++;
      }
      router.refresh();
    }

    setState(null);
    setRunning(false);
    router.refresh();
    toast({
      title: `Batch complete: ${succeeded} succeeded, ${failed} failed`,
      variant: failed > 0 ? "destructive" : "default",
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="outline" size="sm" onClick={handleBatch} disabled={running}>
        {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {running ? "Processing…" : `Process All Pending (${dossierIds.length})`}
      </Button>
      {running && state && (
        <div className="w-full space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.round((state.current / state.total) * 100)}%` }}
            />
          </div>
          <p className="text-right text-xs text-muted-foreground">
            Processing {state.current}/{state.total}… ({state.succeeded} succeeded, {state.failed} failed)
          </p>
        </div>
      )}
    </div>
  );
}
