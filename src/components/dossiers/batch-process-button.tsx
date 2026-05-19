"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function BatchProcessButton({ dossierIds }: { dossierIds: string[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  if (dossierIds.length === 0) return null;

  async function handleBatch() {
    if (running) return;
    setRunning(true);
    setProgress({ done: 0, total: dossierIds.length });

    for (let i = 0; i < dossierIds.length; i++) {
      setProgress({ done: i, total: dossierIds.length });
      try {
        await fetch("/api/process-dossier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dossierId: dossierIds[i] }),
        });
      } catch (e) {
        console.error(`Failed to process dossier ${dossierIds[i]}:`, e);
      }
      // Refresh after each dossier so status updates in the table immediately
      router.refresh();
    }

    setProgress({ done: dossierIds.length, total: dossierIds.length });
    setRunning(false);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button variant="outline" size="sm" onClick={handleBatch} disabled={running}>
        {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {running ? "Processing…" : `Process All Pending (${dossierIds.length})`}
      </Button>
      {running && progress && (
        <div className="w-full space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{
                width: `${Math.round((progress.done / progress.total) * 100)}%`,
              }}
            />
          </div>
          <p className="text-right text-xs text-muted-foreground">
            Processing {progress.done + 1}/{progress.total}…
          </p>
        </div>
      )}
    </div>
  );
}
