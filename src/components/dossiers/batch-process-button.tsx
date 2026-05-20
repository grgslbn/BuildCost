"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { processOneDossier } from "@/lib/dossiers/process-one";

export type BatchDossier = { id: string; address: string | null; postcode: string | null };

type Progress = { completed: number; total: number; succeeded: number; failed: number };

function dossierLabel(d: BatchDossier) {
  return d.address ?? d.postcode ?? d.id.slice(0, 8);
}

export function BatchProcessButton({ dossiers }: { dossiers: BatchDossier[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  if (dossiers.length === 0) return null;

  async function handleBatch() {
    if (running) return;
    setRunning(true);
    setProgress({ completed: 0, total: dossiers.length, succeeded: 0, failed: 0 });

    await Promise.allSettled(
      dossiers.map(async (d) => {
        let ok = false;
        try {
          ok = (await processOneDossier(d.id)) === "success";
        } catch {
          ok = false;
        }

        setProgress((prev) =>
          prev
            ? {
                ...prev,
                completed: prev.completed + 1,
                succeeded: prev.succeeded + (ok ? 1 : 0),
                failed: prev.failed + (ok ? 0 : 1),
              }
            : null
        );
        toast({
          title: ok ? `✓ ${dossierLabel(d)} analyzed` : `✗ ${dossierLabel(d)} failed`,
          variant: ok ? "default" : "destructive",
          duration: 5000,
        });
      })
    );

    setProgress(null);
    setRunning(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="outline" size="sm" onClick={handleBatch} disabled={running}>
        {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {running ? "Processing…" : `Process All Pending (${dossiers.length})`}
      </Button>
      {progress && (
        <div className="w-full space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%` }}
            />
          </div>
          <p className="text-right text-xs text-muted-foreground">
            {progress.completed}/{progress.total} done · {progress.succeeded} ✓
            {progress.failed > 0 && ` · ${progress.failed} ✗`}
          </p>
        </div>
      )}
    </div>
  );
}
