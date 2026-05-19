"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const TERMINAL_STATUSES = new Set(["analyzed", "validated", "error"]);
const IN_PROGRESS_STATUSES = new Set([
  "extracting_sqm",
  "sqm_done",
  "extracting_qqp",
]);

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  extracting_sqm: "Extracting rooms…",
  sqm_done: "Rooms extracted",
  extracting_qqp: "Analyzing QQPs…",
  analyzed: "Analyzed",
  validated: "Validated",
  error: "Error",
};

export function ProcessingControls({
  dossierId,
  initialStatus,
}: {
  dossierId: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [isProcessing, setIsProcessing] = useState(
    IN_PROGRESS_STATUSES.has(initialStatus)
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/dossier-status/${dossierId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string;
          error_message?: string | null;
        };
        setStatus(data.status);
        if (data.status === "error") {
          setErrorMsg(data.error_message ?? "Processing failed");
        }
        if (TERMINAL_STATUSES.has(data.status)) {
          stopPolling();
          setIsProcessing(false);
          router.refresh();
        }
      } catch {
        // network hiccup — keep polling
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  // Resume polling if the page loads mid-processing
  useEffect(() => {
    if (IN_PROGRESS_STATUSES.has(initialStatus)) {
      startPolling();
    }
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleProcess() {
    setIsProcessing(true);
    setErrorMsg(null);
    setStatus("extracting_sqm");
    startPolling();

    try {
      const res = await fetch("/api/process-dossier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossierId }),
      });

      stopPolling();

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setErrorMsg(body.error ?? "Processing failed");
        setStatus("error");
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
        };
        setStatus(body.status ?? "analyzed");
        router.refresh();
      }
    } catch {
      stopPolling();
      setErrorMsg("Network error");
      setStatus("error");
    } finally {
      setIsProcessing(false);
    }
  }

  const canProcess =
    !isProcessing &&
    !IN_PROGRESS_STATUSES.has(status) &&
    status !== "extracting_sqm";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button onClick={handleProcess} disabled={!canProcess} size="sm">
          {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isProcessing
            ? (STATUS_LABEL[status] ?? "Processing…")
            : "Process Dossier"}
        </Button>
        {!isProcessing && status !== "pending" && (
          <span className="text-sm text-muted-foreground">
            {STATUS_LABEL[status] ?? status}
          </span>
        )}
      </div>
      {errorMsg && (
        <p className="text-sm text-destructive">{errorMsg}</p>
      )}
    </div>
  );
}
