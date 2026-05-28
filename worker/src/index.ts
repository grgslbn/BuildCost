/**
 * PlanBase Railway Worker
 *
 * Polls the processing_queue table for pending jobs and runs them through
 * the estimation pipeline. No timeout — large PDFs can take as long as needed.
 *
 * Concurrency model:
 *   - WORKER_ESTIMATE_SLOTS (default 1): reserved for customer estimates (priority 1)
 *   - WORKER_BACKGROUND_SLOTS (default 2): for dossier/benchmark jobs (priority 5-10)
 *
 * Environment variables:
 *   SUPABASE_URL              - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (bypasses RLS)
 *   ANTHROPIC_API_KEY         - Anthropic API key
 *   WORKER_ESTIMATE_SLOTS     - Number of concurrent estimate slots (default: 1)
 *   WORKER_BACKGROUND_SLOTS   - Number of concurrent background slots (default: 2)
 *   POLL_INTERVAL_MS          - Poll interval in ms (default: 2000)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { runEstimationPipeline, type PipelineOptions } from "../../src/lib/pipeline/run-estimation.js";

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error("[worker] Missing required environment variables:");
  if (!SUPABASE_URL) console.error("  - SUPABASE_URL");
  if (!SUPABASE_KEY) console.error("  - SUPABASE_SERVICE_ROLE_KEY");
  if (!ANTHROPIC_KEY) console.error("  - ANTHROPIC_API_KEY");
  process.exit(1);
}

const ESTIMATE_SLOTS = parseInt(process.env.WORKER_ESTIMATE_SLOTS ?? "1", 10);
const BACKGROUND_SLOTS = parseInt(process.env.WORKER_BACKGROUND_SLOTS ?? "2", 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS ?? "2000", 10);

// ── Clients ──────────────────────────────────────────────────────────────────

const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const claude = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ── Types ────────────────────────────────────────────────────────────────────

type QueueJob = {
  id: string;
  estimation_id: string;
  job_type: string;
  priority: number;
  status: string;
  worker_id: string | null;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
};

// ── Job processing ───────────────────────────────────────────────────────────

async function processJob(job: QueueJob, workerId: string): Promise<void> {
  const { id: jobId, estimation_id: estimationId, payload } = job;
  console.log(
    `[${workerId}] Processing job ${jobId.slice(0, 8)} → estimation ${estimationId.slice(0, 8)} (attempt ${job.attempts}/${job.max_attempts})`,
  );

  // Mark as processing
  await admin
    .from("processing_queue")
    .update({ status: "processing" })
    .eq("id", jobId);

  try {
    // Build pipeline options from payload
    const options: PipelineOptions = {
      maxWidth: (payload.maxWidth as number) ?? undefined,
      dpi: (payload.dpi as number) ?? undefined,
      maxPages: (payload.maxPages as number) ?? undefined,
      thinkingBudget: (payload.thinkingBudget as number) ?? undefined,
      timeoutMs: 0, // No timeout on Railway!
      onProgress: (status) => {
        console.log(`[${workerId}] ${estimationId.slice(0, 8)}: ${status}`);
      },
    };

    const result = await runEstimationPipeline(estimationId, admin, claude, options);

    if (result.success) {
      await admin
        .from("processing_queue")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      console.log(`[${workerId}] ✓ Job ${jobId.slice(0, 8)} completed successfully`);
    } else {
      throw new Error(result.error ?? "Pipeline returned failure");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[${workerId}] ✗ Job ${jobId.slice(0, 8)} failed: ${msg}`);

    if (job.attempts < job.max_attempts) {
      // Reset to pending for retry
      await admin
        .from("processing_queue")
        .update({
          status: "pending",
          worker_id: null,
          error_message: msg,
        })
        .eq("id", jobId);
      console.log(
        `[${workerId}] Job ${jobId.slice(0, 8)} will retry (${job.attempts}/${job.max_attempts})`,
      );
    } else {
      // Max attempts reached — mark as error
      await admin
        .from("processing_queue")
        .update({
          status: "error",
          error_message: msg,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      // Also mark the estimation as error
      await admin
        .from("estimations")
        .update({
          status: "error",
          error_message: `Worker failed after ${job.max_attempts} attempts: ${msg}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.estimation_id);
    }
  }
}

// ── Claim job from queue ─────────────────────────────────────────────────────

async function claimJob(
  workerId: string,
  jobTypes: string[],
): Promise<QueueJob | null> {
  const { data, error } = await admin.rpc("claim_queue_job", {
    p_worker_id: workerId,
    p_job_types: jobTypes,
  });

  if (error) {
    console.error(`[${workerId}] Claim error:`, error.message);
    return null;
  }

  const rows = data as QueueJob[] | null;
  return rows && rows.length > 0 ? rows[0] : null;
}

// ── Slot runner ──────────────────────────────────────────────────────────────

class SlotRunner {
  private workerId: string;
  private jobTypes: string[];
  private busy = false;

  constructor(workerId: string, jobTypes: string[]) {
    this.workerId = workerId;
    this.jobTypes = jobTypes;
  }

  isBusy(): boolean {
    return this.busy;
  }

  async tryProcess(): Promise<void> {
    if (this.busy || shuttingDown) return;

    const job = await claimJob(this.workerId, this.jobTypes);
    if (!job) return;

    this.busy = true;
    try {
      await processJob(job, this.workerId);
    } finally {
      this.busy = false;
    }
  }
}

// ── Graceful shutdown ───────────────────────────────────────────────────────

let shuttingDown = false;

function setupShutdownHandlers() {
  const onSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] Received ${signal} — finishing active jobs then exiting...`);
    // The poll loop checks `shuttingDown` and won't claim new jobs.
    // Active jobs finish naturally; after they're done, the process exits.
  };

  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  setupShutdownHandlers();

  console.log(`[worker] Starting PlanBase worker`);
  console.log(`[worker] Estimate slots: ${ESTIMATE_SLOTS}, Background slots: ${BACKGROUND_SLOTS}`);
  console.log(`[worker] Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`[worker] Supabase: ${SUPABASE_URL}`);

  // Create slot runners
  const estimateSlots: SlotRunner[] = [];
  for (let i = 0; i < ESTIMATE_SLOTS; i++) {
    estimateSlots.push(new SlotRunner(`estimate-slot-${i}`, ["estimate"]));
  }

  const backgroundSlots: SlotRunner[] = [];
  for (let i = 0; i < BACKGROUND_SLOTS; i++) {
    backgroundSlots.push(
      new SlotRunner(`background-slot-${i}`, ["dossier", "benchmark"]),
    );
  }

  const allSlots = [...estimateSlots, ...backgroundSlots];

  // Poll loop
  while (!shuttingDown) {
    try {
      // Fire off all idle slots in parallel
      const promises = allSlots
        .filter((s) => !s.isBusy())
        .map((s) => s.tryProcess());

      if (promises.length > 0) {
        await Promise.allSettled(promises);
      }
    } catch (err) {
      console.error("[worker] Poll loop error:", err);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  // Wait for busy slots to finish
  const busySlots = allSlots.filter((s) => s.isBusy());
  if (busySlots.length > 0) {
    console.log(`[worker] Waiting for ${busySlots.length} active job(s) to finish...`);
    // Poll until all slots are idle (max 5 minutes)
    const deadline = Date.now() + 5 * 60 * 1000;
    while (allSlots.some((s) => s.isBusy()) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("[worker] Shutdown complete");
  process.exit(0);
}

// ── Start ────────────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error("[worker] Fatal error:", err);
  process.exit(1);
});
