/**
 * POST /api/estimate-process
 *
 * Internal route — called fire-and-forget from the client.
 *
 * Execution path logic:
 *   - jobType "benchmark" or "dossier" → ALWAYS queued (Railway worker, no timeout)
 *   - jobType "estimate" (default):
 *       USE_QUEUE=false → runs pipeline inline on Vercel (300s limit)
 *       USE_QUEUE=true  → inserts job into processing_queue, Railway worker picks it up
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/ai/client";
import { runEstimationPipeline, type PipelineOptions } from "@/lib/pipeline/run-estimation";

export const maxDuration = 300;

const TIMEOUT_MS = 250_000; // bail before Vercel's 300s hard limit

export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  try {
    const body = await req.json() as {
      estimationId?: string;
      maxWidth?: number;
      dpi?: number;
      maxPages?: number;
      thinkingBudget?: number;
      jobType?: string;   // 'estimate' (default) or 'benchmark'
      priority?: number;  // 1 (default, highest) to 10 (benchmark)
    };

    const { estimationId } = body;
    if (!estimationId) {
      return NextResponse.json({ error: "Missing estimationId" }, { status: 400 });
    }

    const useQueue = process.env.USE_QUEUE === "true";
    const jobType = body.jobType ?? "estimate";
    const priority = body.priority ?? 1;

    // Benchmark and dossier jobs ALWAYS go to queue (no Vercel timeout risk)
    // Customer estimates are gated by USE_QUEUE env var
    const shouldQueue = useQueue || jobType !== "estimate";

    // ── Queue path: insert job and return immediately ────────────────────────
    if (shouldQueue) {
      const payload: Record<string, unknown> = {};
      if (body.maxWidth) payload.maxWidth = body.maxWidth;
      if (body.dpi) payload.dpi = body.dpi;
      if (body.maxPages) payload.maxPages = body.maxPages;
      if (body.thinkingBudget) payload.thinkingBudget = body.thinkingBudget;

      const { error: queueErr } = await admin.from("processing_queue").insert({
        estimation_id: estimationId,
        job_type: jobType,
        priority,
        payload,
      });

      if (queueErr) {
        console.error("[estimate-process] Queue insert failed:", queueErr.message);
        if (jobType !== "estimate") {
          // Non-estimate jobs MUST be queued — no inline fallback
          return NextResponse.json(
            { error: `Queue insert failed: ${queueErr.message}` },
            { status: 500 },
          );
        }
        // Estimate jobs can fall back to inline
        console.log("[estimate-process] Falling back to inline execution");
      } else {
        console.log(`[estimate-process] Queued ${estimationId} (${jobType}, priority ${priority})`);
        return NextResponse.json({ ok: true, queued: true, estimationId });
      }
    }

    // ── Direct path: run pipeline inline on Vercel ───────────────────────────
    const options: PipelineOptions = {
      maxWidth: body.maxWidth,
      dpi: body.dpi,
      maxPages: body.maxPages,
      thinkingBudget: body.thinkingBudget,
      timeoutMs: TIMEOUT_MS,
    };

    const result = await runEstimationPipeline(
      estimationId,
      admin,
      anthropic,
      options,
    );

    if (result.success) {
      return NextResponse.json({ success: true, estimationId });
    } else {
      return NextResponse.json(
        { error: result.error ?? "Pipeline failed" },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error("[estimate-process]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
