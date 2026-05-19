"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

export function ReExtractButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runBatch(offset: number, total: number | null): Promise<void> {
    const res = await fetch("/api/retroactive-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "all", batchSize: 10, offset }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Extraction failed");

    const processed = offset + (data.processed ?? 0);
    const t = total ?? data.total ?? 0;
    setStatus(`Re-extracting… ${processed}/${t} dossiers`);

    if ((data.remaining ?? 0) > 0) {
      await runBatch(processed, t);
    } else {
      setStatus(`Done — ${processed} dossiers re-extracted.`);
      router.refresh();
    }
  }

  async function handleReExtract() {
    if (
      !window.confirm(
        "Re-extract all QQP values for all analyzed dossiers? This will use Claude API credits and may take a few minutes."
      )
    )
      return;

    setLoading(true);
    setStatus("Starting re-extraction…");
    setError(null);
    try {
      await runBatch(0, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        onClick={handleReExtract}
        disabled={loading}
        variant="outline"
        size="sm"
      >
        {loading ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        )}
        Re-extract All
      </Button>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
