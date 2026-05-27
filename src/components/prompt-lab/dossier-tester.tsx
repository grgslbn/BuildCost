"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play, RotateCcw, AlertTriangle } from "lucide-react";
import { ComparisonTable, computeOverallAccuracy, type ComparisonRow } from "./comparison-table";
import { AccuracyBadge } from "./accuracy-badge";

type GroundTruth = {
  expert_total_price: number | null;
  expert_cat1_sqm: number | null;
  expert_cat2_sqm: number | null;
  expert_cat3_sqm: number | null;
  expert_finishing_level: string | null;
  extraction_confidence: number | null;
};

type EstimationResult = {
  cat1_sqm: number;
  cat2_sqm: number;
  cat3_sqm: number;
  total_cost: number;
  finishing_coefficient: number | null;
  confidence: number | null;
  processing_time_ms: number | null;
  warnings: string[];
};

type PipelineOutcome = {
  result: EstimationResult;
  estimationId: string;
};

type TestPhase =
  | "idle"
  | "extracting_gt"
  | "running_pipeline"
  | "both"
  | "done"
  | "error";

function computeError(llm: number | null, expert: number | null): number | null {
  if (llm == null || expert == null || expert === 0) return null;
  return ((llm - expert) / expert) * 100;
}

type InitialResult = {
  cat1_sqm: number | null;
  cat2_sqm: number | null;
  cat3_sqm: number | null;
  total_cost: number | null;
  processing_time_ms: number | null;
};

export function DossierTester({
  dossierId,
  hasCalculation,
  initialGt,
  initialResult,
}: {
  dossierId: string;
  hasCalculation: boolean;
  initialGt: GroundTruth | null;
  initialResult?: InitialResult | null;
}) {
  const hasInitialResult = !!initialResult?.total_cost;
  const [phase, setPhase] = useState<TestPhase>(hasInitialResult ? "done" : "idle");
  const [statusText, setStatusText] = useState(hasInitialResult ? "Previous result" : "");
  const [errorText, setErrorText] = useState("");
  const [gt, setGt] = useState<GroundTruth | null>(initialGt);
  const [result, setResult] = useState<EstimationResult | null>(
    hasInitialResult
      ? {
          cat1_sqm: initialResult!.cat1_sqm ?? 0,
          cat2_sqm: initialResult!.cat2_sqm ?? 0,
          cat3_sqm: initialResult!.cat3_sqm ?? 0,
          total_cost: initialResult!.total_cost ?? 0,
          finishing_coefficient: null,
          confidence: null,
          processing_time_ms: initialResult!.processing_time_ms ?? null,
          warnings: [],
        }
      : null,
  );
  const [processingTime, setProcessingTime] = useState<number | null>(
    initialResult?.processing_time_ms ?? null,
  );

  const extractGt = useCallback(async (): Promise<GroundTruth | null> => {
    if (!hasCalculation) return null;
    try {
      const res = await fetch("/api/prompt-lab/extract-gt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossierId }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.error("GT extraction failed:", err.error);
        return null;
      }
      const data = await res.json();
      // Refetch GT from server to get full row
      const gtRes = await fetch(`/api/admin/prompt-lab/ground-truth?dossierId=${dossierId}`);
      if (gtRes.ok) {
        const gtData = await gtRes.json();
        return gtData as GroundTruth;
      }
      return {
        expert_total_price: data.result?.expert_total_price ?? null,
        expert_cat1_sqm: data.result?.expert_cat1_sqm ?? null,
        expert_cat2_sqm: null,
        expert_cat3_sqm: null,
        expert_finishing_level: null,
        extraction_confidence: data.result?.confidence ?? null,
      };
    } catch {
      return null;
    }
  }, [dossierId, hasCalculation]);

  const runPipeline = useCallback(async (): Promise<PipelineOutcome | null> => {
    // Step 1: Create estimation row
    const res = await fetch("/api/admin/prompt-lab/test-dossier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dossierId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to start pipeline");

    const { estimationId } = data;

    // Step 2: Fire estimate-process from the CLIENT (not server-side fire-and-forget)
    // This avoids Vercel killing the background fetch when the test-dossier response closes.
    fetch("/api/estimate-process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estimationId }),
    }).catch(() => {}); // fire-and-forget from browser — connection stays alive

    // Poll until done (max 10 min)
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const pollRes = await fetch(`/api/prompt-lab/poll-estimation/${estimationId}`);
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          setStatusText(`Pipeline: ${pollData.status?.replace(/_/g, " ")} (${Math.round((i + 1) * 2.5)}s)`);
          if (pollData.done) {
            if (pollData.result) {
              setProcessingTime(pollData.result.processing_time_ms);
              return { result: pollData.result as EstimationResult, estimationId };
            }
            if (pollData.status === "error") {
              throw new Error(pollData.error_message || "Pipeline failed");
            }
            return null;
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message !== "Pipeline failed" && !e.message.includes("413")) {
          continue; // network hiccup — retry
        }
        throw e;
      }
    }
    throw new Error("Pipeline timed out (>10 min)");
  }, [dossierId]);

  async function handleTest() {
    setPhase("both");
    setStatusText("Starting...");
    setErrorText("");
    setResult(null);
    setProcessingTime(null);

    try {
      // Run GT extraction and pipeline in parallel
      const needsGt = !gt && hasCalculation;

      if (needsGt) {
        setStatusText("Extracting ground truth + running pipeline...");
      } else {
        setStatusText("Running pipeline...");
      }

      const [pipelineOutcome, gtResult] = await Promise.all([
        runPipeline(),
        needsGt ? extractGt() : Promise.resolve(gt),
      ]);

      if (gtResult) setGt(gtResult);
      if (pipelineOutcome) setResult(pipelineOutcome.result);

      if (!pipelineOutcome) {
        setPhase("error");
        setErrorText("Pipeline returned no results");
        return;
      }

      setPhase("done");
      setStatusText("Complete!");

      // Record the result in the background (fire-and-forget)
      fetch("/api/admin/prompt-lab/record-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dossierId,
          estimationId: pipelineOutcome.estimationId,
        }),
      }).catch(() => {/* ignore recording errors */});
    } catch (err) {
      setPhase("error");
      setErrorText(err instanceof Error ? err.message : "Unknown error");
    }
  }

  function handleReset() {
    setPhase("idle");
    setStatusText("");
    setErrorText("");
    setResult(null);
    setProcessingTime(null);
  }

  // Build comparison rows when we have both result and GT
  const comparisonRows: ComparisonRow[] | null =
    result && gt
      ? [
          {
            label: "Cat1 (livable)",
            llm: result.cat1_sqm,
            expert: gt.expert_cat1_sqm,
            unit: "m²",
            errorPct: computeError(result.cat1_sqm, gt.expert_cat1_sqm),
          },
          {
            label: "Cat2 (enclosed)",
            llm: result.cat2_sqm,
            expert: gt.expert_cat2_sqm,
            unit: "m²",
            errorPct: computeError(result.cat2_sqm, gt.expert_cat2_sqm),
          },
          {
            label: "Cat3 (outdoor)",
            llm: result.cat3_sqm,
            expert: gt.expert_cat3_sqm,
            unit: "m²",
            errorPct: computeError(result.cat3_sqm, gt.expert_cat3_sqm),
          },
          {
            label: "Total cost",
            llm: result.total_cost,
            expert: gt.expert_total_price,
            unit: "€",
            errorPct: computeError(result.total_cost, gt.expert_total_price),
          },
        ]
      : null;

  const overallAccuracy = comparisonRows
    ? computeOverallAccuracy(comparisonRows)
    : null;

  const isRunning = phase === "both" || phase === "extracting_gt" || phase === "running_pipeline";

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={handleTest} disabled={isRunning} size="sm">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-1.5" />
          )}
          {isRunning ? "Testing..." : result ? "Re-test" : "Test dossier"}
        </Button>

        {statusText && (
          <span
            className={`text-xs ${
              phase === "done"
                ? "text-green-600"
                : phase === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
            }`}
          >
            {statusText}
            {processingTime && (
              <span className="ml-1 text-muted-foreground">
                ({(processingTime / 1000).toFixed(0)}s)
              </span>
            )}
          </span>
        )}

        {overallAccuracy != null && (
          <AccuracyBadge score={overallAccuracy} />
        )}

        {(phase === "done" || phase === "error") && (
          <Button variant="ghost" size="sm" onClick={handleReset} className="ml-auto">
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Error display */}
      {phase === "error" && errorText && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <p className="text-sm text-destructive">{errorText}</p>
        </div>
      )}

      {/* Result without GT — show raw numbers */}
      {result && !gt && phase === "done" && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">
            Pipeline results (no ground truth available for comparison)
          </p>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Cat1 (livable)</p>
              <p className="font-semibold">{result.cat1_sqm.toFixed(1)} m²</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cat2 (enclosed)</p>
              <p className="font-semibold">{result.cat2_sqm.toFixed(1)} m²</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cat3 (outdoor)</p>
              <p className="font-semibold">{result.cat3_sqm.toFixed(1)} m²</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total cost</p>
              <p className="font-semibold">€{Math.round(result.total_cost).toLocaleString("nl-BE")}</p>
            </div>
          </div>
          {result.warnings.length > 0 && (
            <div className="text-xs text-amber-600 space-y-0.5">
              {result.warnings.slice(0, 3).map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Comparison table */}
      {comparisonRows && (
        <div className="rounded-lg border overflow-hidden">
          <ComparisonTable rows={comparisonRows} />
        </div>
      )}

      {/* Warnings */}
      {result && result.warnings.length > 0 && comparisonRows && (
        <div className="text-xs text-amber-600 space-y-0.5 px-1">
          {result.warnings.slice(0, 5).map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
          {result.warnings.length > 5 && (
            <p className="text-muted-foreground">+ {result.warnings.length - 5} more</p>
          )}
        </div>
      )}
    </div>
  );
}
