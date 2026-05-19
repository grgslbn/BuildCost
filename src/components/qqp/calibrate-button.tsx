"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, BarChart3 } from "lucide-react";

export function CalibrateButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCalibrate() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/calibrate-weights", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Calibration failed");
      setResult(
        `Model v${data.version} created — ${data.dossiersUsed} dossiers, ${data.qqpsCalibrated} QQPs calibrated. MAE: ${data.metrics.mae.toFixed(3)}, R²: ${data.metrics.r_squared.toFixed(3)}.`
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button onClick={handleCalibrate} disabled={loading} size="sm">
        {loading ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
        )}
        Calibrate Weights Now
      </Button>
      {result && <p className="text-xs text-muted-foreground">{result}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
