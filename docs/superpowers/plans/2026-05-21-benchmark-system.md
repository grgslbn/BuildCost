# Benchmark System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a benchmark system that measures SQM/QQP pipeline accuracy against expert ground truth, with CLI scripts for running evaluations and an admin UI for viewing results.

**Architecture:** Three new DB tables (ground truth, runs, results) store benchmark data. CLI scripts create estimation rows and call the real `/api/estimate-process` endpoint, then compare results with expert values. An admin page at `/admin/benchmark` shows run overview, per-dossier detail, ground truth management, and A/B comparison.

**Tech Stack:** Next.js 14 (App Router), Supabase (Postgres), Vitest, shadcn/ui, Anthropic SDK, Node.js `parseArgs`

**Spec:** `docs/superpowers/specs/2026-05-21-benchmark-system-design.md`

---

## File Structure

```
supabase/migrations/
└── 20260521_benchmark_tables.sql         -- 3 new tables + RLS

src/lib/benchmark/
├── types.ts                              -- shared types for ground truth, runs, results, metrics
└── metrics.ts                            -- per-dossier + aggregate metric calculations

src/lib/benchmark/__tests__/
└── metrics.test.ts                       -- unit tests for metric calculations

scripts/
├── benchmark-extract-ground-truth.mjs    -- extract expert values from dossier PDFs
├── benchmark-run.mjs                     -- run pipeline on dossiers, record results
└── benchmark-compare.mjs                 -- compare two runs side-by-side

src/app/(dashboard)/admin/benchmark/
├── page.tsx                              -- tabs: Runs (default) + Ground Truth
└── [runId]/
    └── page.tsx                          -- run detail with per-dossier results

src/components/dashboard/sidebar.tsx      -- add Benchmark nav item
```

---

### Task 0: Database Migration

**Files:**
- Create: `supabase/migrations/20260521_benchmark_tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260521_benchmark_tables.sql

-- ── benchmark_ground_truth ──────────────────────────────────────────
create table if not exists public.benchmark_ground_truth (
  id                   uuid primary key default gen_random_uuid(),
  dossier_id           uuid not null references public.reference_dossiers(id) on delete cascade,
  expert_total_price   numeric,
  expert_cat1_sqm      numeric,
  expert_cat2_sqm      numeric,
  expert_cat3_sqm      numeric,
  expert_total_sqm     numeric generated always as (
    coalesce(expert_cat1_sqm, 0) + coalesce(expert_cat2_sqm, 0) + coalesce(expert_cat3_sqm, 0)
  ) stored,
  expert_finishing_level text,
  extraction_confidence numeric,
  verified             boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint benchmark_ground_truth_dossier_unique unique (dossier_id)
);

alter table public.benchmark_ground_truth enable row level security;
create policy "service_role full access" on public.benchmark_ground_truth
  for all to service_role using (true) with check (true);
create policy "authenticated read" on public.benchmark_ground_truth
  for select to authenticated using (true);

-- ── evaluation_runs ─────────────────────────────────────────────────
create table if not exists public.evaluation_runs (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  sqm_prompt_version_id  uuid references public.prompt_versions(id),
  qqp_prompt_version_id  uuid references public.prompt_versions(id),
  model_version_id       uuid references public.qqp_model_versions(id),
  dossier_count          integer not null default 0,
  subset_mode            text not null default 'all',
  metrics                jsonb,
  status                 text not null default 'running',
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  notes                  text
);

alter table public.evaluation_runs enable row level security;
create policy "service_role full access" on public.evaluation_runs
  for all to service_role using (true) with check (true);
create policy "authenticated read" on public.evaluation_runs
  for select to authenticated using (true);

-- ── evaluation_results ──────────────────────────────────────────────
create table if not exists public.evaluation_results (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references public.evaluation_runs(id) on delete cascade,
  dossier_id           uuid not null references public.reference_dossiers(id) on delete cascade,

  -- SQM
  extracted_cat1_sqm   numeric,
  extracted_cat2_sqm   numeric,
  extracted_cat3_sqm   numeric,
  sqm_extraction       jsonb,
  cat1_error_pct       numeric,
  cat2_error_pct       numeric,
  cat3_error_pct       numeric,

  -- QQP / F
  extracted_qqps       jsonb,
  predicted_f          numeric,
  expert_f             numeric,
  f_error              numeric,

  -- Cost
  predicted_total_cost numeric,
  cost_error_pct       numeric,

  -- Meta
  processing_time_ms   integer,
  error_message        text,
  created_at           timestamptz not null default now(),

  constraint evaluation_results_run_dossier_unique unique (run_id, dossier_id)
);

alter table public.evaluation_results enable row level security;
create policy "service_role full access" on public.evaluation_results
  for all to service_role using (true) with check (true);
create policy "authenticated read" on public.evaluation_results
  for select to authenticated using (true);

-- Indexes for common queries
create index if not exists idx_eval_results_run_id on public.evaluation_results(run_id);
create index if not exists idx_eval_results_dossier_id on public.evaluation_results(dossier_id);
create index if not exists idx_eval_runs_status on public.evaluation_runs(status);
create index if not exists idx_benchmark_gt_dossier on public.benchmark_ground_truth(dossier_id);
```

- [ ] **Step 2: Apply migration to Supabase**

Run: Use Supabase MCP `apply_migration` tool or apply via Supabase dashboard SQL editor.

Expected: Three new tables created with RLS policies and indexes.

- [ ] **Step 3: Verify tables exist**

Run query in Supabase:
```sql
select table_name from information_schema.tables
where table_schema = 'public'
and table_name in ('benchmark_ground_truth', 'evaluation_runs', 'evaluation_results');
```
Expected: 3 rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260521_benchmark_tables.sql
git commit -m "feat: add benchmark tables (ground truth, runs, results)"
```

---

### Task 1: Shared Types

**Files:**
- Create: `src/lib/benchmark/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/lib/benchmark/types.ts

// ── Ground Truth ────────────────────────────────────────────────────

export type GroundTruth = {
  id: string;
  dossier_id: string;
  expert_total_price: number | null;
  expert_cat1_sqm: number | null;
  expert_cat2_sqm: number | null;
  expert_cat3_sqm: number | null;
  expert_total_sqm: number | null;
  expert_finishing_level: string | null;
  extraction_confidence: number | null;
  verified: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ── Evaluation Run ──────────────────────────────────────────────────

export type EvaluationRun = {
  id: string;
  name: string;
  sqm_prompt_version_id: string | null;
  qqp_prompt_version_id: string | null;
  model_version_id: string | null;
  dossier_count: number;
  subset_mode: string;
  metrics: RunMetrics | null;
  status: "running" | "complete" | "failed";
  started_at: string;
  completed_at: string | null;
  notes: string | null;
};

// ── Evaluation Result ───────────────────────────────────────────────

export type EvaluationResult = {
  id: string;
  run_id: string;
  dossier_id: string;
  // SQM
  extracted_cat1_sqm: number | null;
  extracted_cat2_sqm: number | null;
  extracted_cat3_sqm: number | null;
  sqm_extraction: unknown;
  cat1_error_pct: number | null;
  cat2_error_pct: number | null;
  cat3_error_pct: number | null;
  // QQP / F
  extracted_qqps: unknown;
  predicted_f: number | null;
  expert_f: number | null;
  f_error: number | null;
  // Cost
  predicted_total_cost: number | null;
  cost_error_pct: number | null;
  // Meta
  processing_time_ms: number | null;
  error_message: string | null;
  created_at: string;
};

// ── Aggregate Metrics ───────────────────────────────────────────────

export type RunMetrics = {
  cost_mae_pct: number;
  cost_median_pct: number;
  cost_worst_pct: number;
  cost_within_10_pct: number;
  cost_within_15_pct: number;
  cat1_mae_pct: number;
  cat2_mae_pct: number;
  cat3_mae_pct: number;
  f_mae: number;
  f_median: number;
  dossiers_succeeded: number;
  dossiers_failed: number;
};

// ── Extracted Ground Truth (from AI) ────────────────────────────────

export type ExtractedGroundTruth = {
  expert_total_price: number | null;
  expert_cat1_sqm: number | null;
  expert_cat2_sqm: number | null;
  expert_cat3_sqm: number | null;
  expert_finishing_level: string | null;
  confidence: number;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/benchmark/types.ts
git commit -m "feat: add benchmark shared types"
```

---

### Task 2: Metrics Library (TDD)

**Files:**
- Create: `src/lib/benchmark/metrics.ts`
- Create: `src/lib/benchmark/__tests__/metrics.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/benchmark/__tests__/metrics.test.ts
import { describe, it, expect } from "vitest";
import {
  computeErrorPct,
  computeRunMetrics,
} from "../metrics";

describe("computeErrorPct", () => {
  it("returns percentage error", () => {
    expect(computeErrorPct(110, 100)).toBeCloseTo(10.0);
  });

  it("returns negative for under-prediction", () => {
    expect(computeErrorPct(90, 100)).toBeCloseTo(-10.0);
  });

  it("returns null when expert is null", () => {
    expect(computeErrorPct(100, null)).toBeNull();
  });

  it("returns null when expert is zero", () => {
    expect(computeErrorPct(100, 0)).toBeNull();
  });

  it("returns null when predicted is null", () => {
    expect(computeErrorPct(null, 100)).toBeNull();
  });
});

describe("computeRunMetrics", () => {
  const results = [
    { cost_error_pct: 5, cat1_error_pct: 3, cat2_error_pct: 8, cat3_error_pct: 10, f_error: 0.05, error_message: null },
    { cost_error_pct: -12, cat1_error_pct: -6, cat2_error_pct: 4, cat3_error_pct: -15, f_error: -0.10, error_message: null },
    { cost_error_pct: 8, cat1_error_pct: 2, cat2_error_pct: -3, cat3_error_pct: 5, f_error: 0.03, error_message: null },
    { cost_error_pct: null, cat1_error_pct: null, cat2_error_pct: null, cat3_error_pct: null, f_error: null, error_message: "Pipeline failed" },
  ];

  const metrics = computeRunMetrics(results);

  it("counts succeeded and failed", () => {
    expect(metrics.dossiers_succeeded).toBe(3);
    expect(metrics.dossiers_failed).toBe(1);
  });

  it("computes cost MAE from absolute values", () => {
    // |5| + |12| + |8| = 25, /3 = 8.33
    expect(metrics.cost_mae_pct).toBeCloseTo(8.33, 1);
  });

  it("computes cost median from absolute values", () => {
    // sorted absolute: [5, 8, 12] → median = 8
    expect(metrics.cost_median_pct).toBeCloseTo(8.0);
  });

  it("computes worst case", () => {
    expect(metrics.cost_worst_pct).toBeCloseTo(12.0);
  });

  it("computes within thresholds", () => {
    // 3 succeeded: 5%, 12%, 8% → all within 15%, 2/3 within 10%
    expect(metrics.cost_within_15_pct).toBeCloseTo(1.0);
    expect(metrics.cost_within_10_pct).toBeCloseTo(2 / 3, 2);
  });

  it("computes f MAE", () => {
    // |0.05| + |0.10| + |0.03| = 0.18, /3 = 0.06
    expect(metrics.f_mae).toBeCloseTo(0.06);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/benchmark/__tests__/metrics.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement metrics**

```typescript
// src/lib/benchmark/metrics.ts
import type { RunMetrics } from "./types";

/**
 * (predicted - expert) / expert * 100. Returns null if either value is null or expert is 0.
 */
export function computeErrorPct(
  predicted: number | null,
  expert: number | null
): number | null {
  if (predicted == null || expert == null || expert === 0) return null;
  return ((predicted - expert) / expert) * 100;
}

type ResultForMetrics = {
  cost_error_pct: number | null;
  cat1_error_pct: number | null;
  cat2_error_pct: number | null;
  cat3_error_pct: number | null;
  f_error: number | null;
  error_message: string | null;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mae(values: (number | null)[]): number {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, v) => sum + Math.abs(v), 0) / valid.length;
}

export function computeRunMetrics(results: ResultForMetrics[]): RunMetrics {
  const succeeded = results.filter((r) => r.error_message == null);
  const failed = results.filter((r) => r.error_message != null);

  const costErrors = succeeded
    .map((r) => r.cost_error_pct)
    .filter((v): v is number => v != null);
  const absCostErrors = costErrors.map(Math.abs);

  const cat1Errors = succeeded.map((r) => r.cat1_error_pct);
  const cat2Errors = succeeded.map((r) => r.cat2_error_pct);
  const cat3Errors = succeeded.map((r) => r.cat3_error_pct);
  const fErrors = succeeded.map((r) => r.f_error);
  const absFErrors = fErrors.filter((v): v is number => v != null).map(Math.abs);

  const total = costErrors.length || 1; // avoid division by 0

  return {
    cost_mae_pct: mae(costErrors),
    cost_median_pct: median(absCostErrors),
    cost_worst_pct: absCostErrors.length > 0 ? Math.max(...absCostErrors) : 0,
    cost_within_10_pct: absCostErrors.filter((e) => e <= 10).length / total,
    cost_within_15_pct: absCostErrors.filter((e) => e <= 15).length / total,
    cat1_mae_pct: mae(cat1Errors),
    cat2_mae_pct: mae(cat2Errors),
    cat3_mae_pct: mae(cat3Errors),
    f_mae: absFErrors.length > 0 ? absFErrors.reduce((s, v) => s + v, 0) / absFErrors.length : 0,
    f_median: median(absFErrors),
    dossiers_succeeded: succeeded.length,
    dossiers_failed: failed.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/benchmark/__tests__/metrics.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/benchmark/metrics.ts src/lib/benchmark/__tests__/metrics.test.ts
git commit -m "feat: add benchmark metrics calculation with tests"
```

---

### Task 3: CLI Script — Extract Ground Truth

**Files:**
- Create: `scripts/benchmark-extract-ground-truth.mjs`
- Modify: `package.json` (add npm script)

**Context:** This script reads reference_dossiers, downloads their PDFs, uses page classification to find expert pages, then calls Claude to extract ground truth values. It stores results in `benchmark_ground_truth`. Uses the same env-loading pattern as existing scripts in `scripts/`.

- [ ] **Step 1: Create the script**

```javascript
// scripts/benchmark-extract-ground-truth.mjs
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// ── Load .env.local ─────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = await readFile(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env.local */ }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.BUILDCOST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BUILDCOST_ANTHROPIC_KEY");
  process.exit(1);
}

const admin = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anthropic = new Anthropic({ apiKey: anthropicKey });

// ── Load ground truth prompt ────────────────────────────────────────
// We inline the prompts here since .mjs can't import .ts files directly.
// These match src/lib/benchmark/ground-truth-prompt.ts.
const SYSTEM_PROMPT = `You are extracting ground truth data from a Belgian building insurance expert's valuation report.

The expert report contains a reconstruction cost calculation. You must extract:
1. The total reconstruction cost (herbouwwaarde / valeur de reconstruction)
2. The area breakdown by category

Area categories:
- CAT1 (bewoonbaar/habitable): living rooms, bedrooms, kitchen, bathrooms, office, hallway, stairs, dressing — all enclosed livable space
- CAT2 (bijgebouw/annexe): garage, storage (berging), utility room (technische ruimte) — enclosed but not livable
- CAT3 (buitenruimte/extérieur): terrace (terras), balcony (balkon) — outdoor built areas
- EXCLUDED: garden (tuin/jardin), parking spaces, driveways

Look for:
- A summary table with total price (often labeled "totaal herbouwwaarde", "total valeur de reconstruction", "totale reconstructiewaarde")
- Area measurements per room or per category (often in m²)
- The expert may use NL (Dutch) or FR (French) terminology

Important:
- Extract the FINAL total price, not intermediate subtotals
- If the expert provides m² per individual room, sum them into the three categories
- If the expert only provides a total m², put it all in cat1 and set cat2/cat3 to 0
- Prices should be in EUR without VAT adjustments
- If you cannot find a value, set it to null`;

const USER_PROMPT = `Extract the ground truth values from this expert valuation report.

Return ONLY valid JSON (no markdown, no explanation):

{
  "expert_total_price": <number or null>,
  "expert_cat1_sqm": <number or null>,
  "expert_cat2_sqm": <number or null>,
  "expert_cat3_sqm": <number or null>,
  "expert_finishing_level": <string or null>,
  "confidence": <number 0.0-1.0>
}`;

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  // Find dossiers without ground truth
  const { data: dossiers, error: dErr } = await admin
    .from("reference_dossiers")
    .select("id, plan_storage_path, plan_file_name, page_classifications")
    .not("plan_storage_path", "is", null);

  if (dErr || !dossiers) {
    console.error("Failed to fetch dossiers:", dErr?.message);
    process.exit(1);
  }

  // Get existing ground truth dossier IDs
  const { data: existing } = await admin
    .from("benchmark_ground_truth")
    .select("dossier_id");
  const existingIds = new Set((existing ?? []).map((r) => r.dossier_id));

  const toProcess = dossiers.filter((d) => !existingIds.has(d.id));
  console.log(`Found ${dossiers.length} dossiers, ${toProcess.length} need ground truth extraction.\n`);

  if (toProcess.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const dossier = toProcess[i];
    const label = dossier.plan_file_name || dossier.id.slice(0, 8);
    process.stdout.write(`[${i + 1}/${toProcess.length}] ${label}  `);

    try {
      // Download PDF
      const { data: fileBlob, error: dlErr } = await admin.storage
        .from("plans")
        .download(dossier.plan_storage_path);
      if (dlErr || !fileBlob) throw new Error(`Download failed: ${dlErr?.message}`);

      const buffer = Buffer.from(await fileBlob.arrayBuffer());
      const base64 = buffer.toString("base64");

      // Determine which pages to send (expert_report + pricing_table)
      const classifications = dossier.page_classifications;
      let pageNote = "";
      if (Array.isArray(classifications)) {
        const expertPages = classifications
          .filter((c) => c.type === "expert_report" || c.type === "pricing_table")
          .map((c) => c.pageNumber);
        if (expertPages.length > 0) {
          pageNote = ` (expert pages: ${expertPages.join(", ")})`;
        }
      }

      // Send entire PDF to Claude — it can read all pages
      const content = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        },
        {
          type: "text",
          text: USER_PROMPT + (pageNote ? `\n\nNote: pages likely containing expert data: ${pageNote}` : ""),
        },
      ];

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      });

      const text = response.content.find((b) => b.type === "text")?.text ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");

      const parsed = JSON.parse(jsonMatch[0]);

      // Insert ground truth
      const { error: insertErr } = await admin
        .from("benchmark_ground_truth")
        .insert({
          dossier_id: dossier.id,
          expert_total_price: parsed.expert_total_price,
          expert_cat1_sqm: parsed.expert_cat1_sqm,
          expert_cat2_sqm: parsed.expert_cat2_sqm,
          expert_cat3_sqm: parsed.expert_cat3_sqm,
          expert_finishing_level: parsed.expert_finishing_level,
          extraction_confidence: parsed.confidence,
        });

      if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

      const price = parsed.expert_total_price ? `€${parsed.expert_total_price.toLocaleString()}` : "?";
      const sqm = parsed.expert_cat1_sqm ? `${parsed.expert_cat1_sqm}m²` : "?";
      console.log(`✓  ${price}  ${sqm}  conf=${parsed.confidence}`);
      succeeded++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
      failed++;
    }
  }

  console.log(`\n── Done ──────────────────────────────`);
  console.log(`Extracted: ${succeeded}  Failed: ${failed}  Total: ${toProcess.length}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script to package.json**

Add to the `"scripts"` section of `package.json`:
```json
"benchmark:extract-gt": "node scripts/benchmark-extract-ground-truth.mjs"
```

- [ ] **Step 3: Test the script runs** (requires dossiers in DB)

Run: `npm run benchmark:extract-gt`
Expected: Either processes dossiers or prints "Nothing to do."

- [ ] **Step 4: Commit**

```bash
git add scripts/benchmark-extract-ground-truth.mjs package.json
git commit -m "feat: add ground truth extraction CLI script"
```

---

### Task 4: CLI Script — Benchmark Run

**Files:**
- Create: `scripts/benchmark-run.mjs`
- Modify: `package.json` (add npm script)

**Context:** This is the main benchmark script. It creates estimation rows from dossier data, calls the real `/api/estimate-process` endpoint, polls for completion, and records results. Uses `parseArgs` from `node:util` for CLI flags.

- [ ] **Step 1: Create the script**

```javascript
// scripts/benchmark-run.mjs
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ─────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = await readFile(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env.local */ }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.BENCHMARK_BASE_URL || "http://localhost:3000";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

// ── Parse CLI args ──────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    all:         { type: "boolean", default: false },
    subset:      { type: "string" },
    concurrency: { type: "string", default: "3" },
    name:        { type: "string" },
  },
  allowPositionals: false,
});

const concurrency = parseInt(args.concurrency, 10) || 3;

// ── Helpers ─────────────────────────────────────────────────────────

function computeErrorPct(predicted, expert) {
  if (predicted == null || expert == null || expert === 0) return null;
  return ((predicted - expert) / expert) * 100;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeRunMetrics(results) {
  const succeeded = results.filter((r) => !r.error_message);
  const costErrors = succeeded.map((r) => r.cost_error_pct).filter((v) => v != null);
  const absCost = costErrors.map(Math.abs);
  const fErrors = succeeded.map((r) => r.f_error).filter((v) => v != null).map(Math.abs);
  const total = costErrors.length || 1;
  const mae = (arr) => { const v = arr.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + Math.abs(x), 0) / v.length : 0; };

  return {
    cost_mae_pct: mae(costErrors),
    cost_median_pct: median(absCost),
    cost_worst_pct: absCost.length ? Math.max(...absCost) : 0,
    cost_within_10_pct: absCost.filter((e) => e <= 10).length / total,
    cost_within_15_pct: absCost.filter((e) => e <= 15).length / total,
    cat1_mae_pct: mae(succeeded.map((r) => r.cat1_error_pct)),
    cat2_mae_pct: mae(succeeded.map((r) => r.cat2_error_pct)),
    cat3_mae_pct: mae(succeeded.map((r) => r.cat3_error_pct)),
    f_mae: fErrors.length ? fErrors.reduce((s, v) => s + v, 0) / fErrors.length : 0,
    f_median: median(fErrors),
    dossiers_succeeded: succeeded.length,
    dossiers_failed: results.length - succeeded.length,
  };
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pollEstimation(estimationId, timeoutMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin
      .from("estimations")
      .select("status, estimated_total_cost, sqm_extraction, extracted_qqps, finishing_coefficient, sub_areas, processing_time_ms, error_message")
      .eq("id", estimationId)
      .single();
    if (!data) throw new Error("Estimation row not found");
    if (data.status === "complete" || data.status === "error") return data;
    await sleep(3000);
  }
  throw new Error("Polling timeout (5 min)");
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  // 1. Load ground truth + dossiers
  const { data: gtRows, error: gtErr } = await admin
    .from("benchmark_ground_truth")
    .select("*, reference_dossiers!inner(id, tenant_id, plan_storage_path, plan_file_name, postcode, price_abex_year, price_abex_semester)")
    .not("expert_total_price", "is", null);

  if (gtErr || !gtRows) {
    console.error("Failed to load ground truth:", gtErr?.message);
    process.exit(1);
  }

  // 2. Filter dossiers based on subset mode
  let dossiers = gtRows;
  let subsetMode = "all";

  if (args.subset) {
    if (args.subset === "difficult") {
      subsetMode = "difficult";
      // Get latest complete run
      const { data: lastRun } = await admin
        .from("evaluation_runs")
        .select("id")
        .eq("status", "complete")
        .order("completed_at", { ascending: false })
        .limit(1)
        .single();
      if (!lastRun) {
        console.error("No previous complete run found. Use --all for the first run.");
        process.exit(1);
      }
      const { data: prevResults } = await admin
        .from("evaluation_results")
        .select("dossier_id, cost_error_pct")
        .eq("run_id", lastRun.id);
      const difficultIds = new Set(
        (prevResults ?? [])
          .filter((r) => r.cost_error_pct != null && Math.abs(r.cost_error_pct) > 15)
          .map((r) => r.dossier_id)
      );
      dossiers = dossiers.filter((d) => difficultIds.has(d.dossier_id));
    } else if (args.subset.startsWith("ids:")) {
      subsetMode = "manual";
      const ids = args.subset.slice(4).split(",").map((s) => s.trim());
      dossiers = dossiers.filter((d) => ids.includes(d.dossier_id) || ids.includes(d.dossier_id.slice(0, 8)));
    }
  } else if (!args.all) {
    console.error("Specify --all or --subset=difficult or --subset=ids:a,b,c");
    process.exit(1);
  }

  if (dossiers.length === 0) {
    console.log("No dossiers match the filter.");
    return;
  }

  // 3. Get active prompt versions and model
  const { data: activePrompts } = await admin
    .from("prompt_versions")
    .select("id, prompt_type, version_number")
    .eq("is_active", true);
  const sqmPrompt = activePrompts?.find((p) => p.prompt_type === "sqm_extraction");
  const qqpPrompt = activePrompts?.find((p) => p.prompt_type === "qqp_extraction");

  const { data: activeModel } = await admin
    .from("qqp_model_versions")
    .select("id, version")
    .eq("is_active", true)
    .maybeSingle();

  const runName = args.name || `SQM v${sqmPrompt?.version_number ?? "?"} + QQP v${qqpPrompt?.version_number ?? "?"}`;

  // 4. Create evaluation run
  const { data: run, error: runErr } = await admin
    .from("evaluation_runs")
    .insert({
      name: runName,
      sqm_prompt_version_id: sqmPrompt?.id ?? null,
      qqp_prompt_version_id: qqpPrompt?.id ?? null,
      model_version_id: activeModel?.id ?? null,
      dossier_count: dossiers.length,
      subset_mode: subsetMode,
      status: "running",
    })
    .select("id")
    .single();
  if (runErr || !run) {
    console.error("Failed to create run:", runErr?.message);
    process.exit(1);
  }

  console.log(`Benchmark run: "${runName}"`);
  console.log(`Prompts: SQM v${sqmPrompt?.version_number ?? "?"} / QQP v${qqpPrompt?.version_number ?? "?"}`);
  console.log(`Model: v${activeModel?.version ?? "none"}`);
  console.log(`Dossiers: ${dossiers.length} (${subsetMode})\n`);

  // 5. Process dossiers with concurrency
  const allResults = [];
  let idx = 0;

  async function processDossier(gt) {
    const myIdx = ++idx;
    const dossier = gt.reference_dossiers;
    const label = (dossier.plan_file_name || gt.dossier_id.slice(0, 8)).slice(0, 30).padEnd(30);
    const startTime = Date.now();

    try {
      // Create estimation row
      const { data: est, error: estErr } = await admin
        .from("estimations")
        .insert({
          tenant_id: dossier.tenant_id,
          plan_storage_path: dossier.plan_storage_path,
          plan_file_name: dossier.plan_file_name,
          postcode: dossier.postcode,
          status: "uploading",
        })
        .select("id")
        .single();
      if (estErr || !est) throw new Error(`Create estimation: ${estErr?.message}`);

      // Fire estimate-process (same as end user)
      const processRes = await fetch(`${baseUrl}/api/estimate-process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimationId: est.id }),
      });
      if (!processRes.ok) {
        const body = await processRes.text();
        throw new Error(`estimate-process ${processRes.status}: ${body.slice(0, 200)}`);
      }

      // Poll for completion
      const result = await pollEstimation(est.id);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.status === "error") throw new Error(result.error_message || "Pipeline error");

      // Extract areas from result
      const subAreas = result.sub_areas;
      const extractedCat1 = subAreas?.cat1_sqm ?? null;
      const extractedCat2 = subAreas?.cat2_sqm ?? null;
      const extractedCat3 = subAreas?.cat3_sqm ?? null;
      const predictedCost = result.estimated_total_cost;
      const predictedF = result.finishing_coefficient;

      // Compute errors
      const cat1Err = computeErrorPct(extractedCat1, gt.expert_cat1_sqm);
      const cat2Err = computeErrorPct(extractedCat2, gt.expert_cat2_sqm);
      const cat3Err = computeErrorPct(extractedCat3, gt.expert_cat3_sqm);
      const costErr = computeErrorPct(predictedCost, gt.expert_total_price);

      // Back-calculate expert F using expert m² + expert price + regional/ABEX factors
      let expertF = null;
      let fErr = null;
      if (gt.expert_total_price && gt.expert_cat1_sqm) {
        // Load pricing config (same defaults as pipeline)
        const pricing = { cat1_min: 1100, cat1_max: 1900, cat2_min: 550, cat2_max: 950, cat3_min: 330, cat3_max: 570 };

        // Regional factor from postcode
        let regionalFactor = 1.0;
        if (dossier.postcode) {
          const { data: pp } = await admin.from("postcode_prices").select("base_price_per_sqm").eq("postcode", dossier.postcode).maybeSingle();
          if (pp?.base_price_per_sqm) {
            const cat1AtF1 = pricing.cat1_min + ((1.0 - 0.70) / 0.80) * (pricing.cat1_max - pricing.cat1_min);
            regionalFactor = pp.base_price_per_sqm / cat1AtF1;
          }
        }

        // ABEX factor from dossier's valuation date
        let abexFactor = 1.0;
        const abexYear = dossier.price_abex_year;
        const abexSemester = dossier.price_abex_semester;
        if (abexYear && abexSemester) {
          const { data: abex } = await admin.from("abex_index").select("index_value").eq("year", abexYear).eq("semester", abexSemester).maybeSingle();
          if (abex?.index_value) abexFactor = abex.index_value / 1000;
        }

        // backcalculateF: solve for F given total cost, areas, pricing, factors
        const areas = { cat1_sqm: gt.expert_cat1_sqm, cat2_sqm: gt.expert_cat2_sqm || 0, cat3_sqm: gt.expert_cat3_sqm || 0 };
        const costBeforeFactors = gt.expert_total_price / (regionalFactor * abexFactor);
        // minCost = cat1*cat1_min + cat2*cat2_min + cat3*cat3_min
        const minCost = areas.cat1_sqm * pricing.cat1_min + areas.cat2_sqm * pricing.cat2_min + areas.cat3_sqm * pricing.cat3_min;
        const maxCost = areas.cat1_sqm * pricing.cat1_max + areas.cat2_sqm * pricing.cat2_max + areas.cat3_sqm * pricing.cat3_max;
        const rangeSlope = maxCost - minCost;
        if (rangeSlope > 0) {
          const r = (costBeforeFactors - minCost) / rangeSlope;
          const rawF = 0.70 + r * 0.80;
          expertF = Math.max(0.70, Math.min(1.50, rawF));
        }
      }
      fErr = (predictedF != null && expertF != null) ? predictedF - expertF : null;

      const evalResult = {
        run_id: run.id,
        dossier_id: gt.dossier_id,
        extracted_cat1_sqm: extractedCat1,
        extracted_cat2_sqm: extractedCat2,
        extracted_cat3_sqm: extractedCat3,
        sqm_extraction: result.sqm_extraction,
        cat1_error_pct: cat1Err,
        cat2_error_pct: cat2Err,
        cat3_error_pct: cat3Err,
        extracted_qqps: result.extracted_qqps,
        predicted_f: predictedF,
        expert_f: expertF,
        f_error: fErr,
        predicted_total_cost: predictedCost,
        cost_error_pct: costErr,
        processing_time_ms: result.processing_time_ms,
        error_message: null,
      };

      await admin.from("evaluation_results").insert(evalResult);
      allResults.push(evalResult);

      const costStr = costErr != null ? `${costErr > 0 ? "+" : ""}${costErr.toFixed(1)}%` : "N/A";
      const cat1Str = cat1Err != null ? `${cat1Err > 0 ? "+" : ""}${cat1Err.toFixed(1)}%` : "N/A";
      console.log(`[${myIdx}/${dossiers.length}] ${label} ✓  cost: ${costStr}  cat1: ${cat1Str}  (${elapsed}s)`);
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const evalResult = {
        run_id: run.id,
        dossier_id: gt.dossier_id,
        error_message: err.message?.slice(0, 500),
      };
      await admin.from("evaluation_results").insert(evalResult);
      allResults.push(evalResult);
      console.log(`[${myIdx}/${dossiers.length}] ${label} ✗  ${err.message?.slice(0, 80)}  (${elapsed}s)`);
    }
  }

  // Run with concurrency limit
  const queue = [...dossiers];
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) await processDossier(item);
      }
    })());
  }
  await Promise.all(workers);

  // 6. Compute aggregate metrics and finalize run
  const metrics = computeRunMetrics(allResults);
  await admin
    .from("evaluation_runs")
    .update({ status: "complete", completed_at: new Date().toISOString(), metrics })
    .eq("id", run.id);

  console.log(`\n── Summary ──────────────────────────────`);
  console.log(`SQM  MAE cat1: ${metrics.cat1_mae_pct.toFixed(1)}%  cat2: ${metrics.cat2_mae_pct.toFixed(1)}%  cat3: ${metrics.cat3_mae_pct.toFixed(1)}%`);
  console.log(`Cost MAE: ${metrics.cost_mae_pct.toFixed(1)}%  Median: ${metrics.cost_median_pct.toFixed(1)}%  Worst: ${metrics.cost_worst_pct.toFixed(1)}%`);
  console.log(`     Within 10%: ${(metrics.cost_within_10_pct * 100).toFixed(0)}%  Within 15%: ${(metrics.cost_within_15_pct * 100).toFixed(0)}%`);
  console.log(`F    MAE: ${metrics.f_mae.toFixed(2)}`);
  console.log(`Succeeded: ${metrics.dossiers_succeeded}  Failed: ${metrics.dossiers_failed}`);
  console.log(`\nRun ID: ${run.id}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

Add to `package.json` scripts:
```json
"benchmark:run": "node scripts/benchmark-run.mjs"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/benchmark-run.mjs package.json
git commit -m "feat: add benchmark run CLI script"
```

---

### Task 5: CLI Script — Benchmark Compare

**Files:**
- Create: `scripts/benchmark-compare.mjs`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: Create the script**

```javascript
// scripts/benchmark-compare.mjs
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local (same pattern) ─────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = await readFile(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env.local */ }

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { values: args } = parseArgs({
  options: {
    run1: { type: "string" },
    run2: { type: "string" },
  },
});

async function resolveRunId(label) {
  if (!label || label === "latest") {
    const { data } = await admin.from("evaluation_runs").select("id").eq("status", "complete").order("completed_at", { ascending: false }).limit(1).single();
    return data?.id;
  }
  if (label === "previous") {
    const { data } = await admin.from("evaluation_runs").select("id").eq("status", "complete").order("completed_at", { ascending: false }).limit(2);
    return data?.[1]?.id;
  }
  return label; // UUID
}

async function main() {
  const runId1 = await resolveRunId(args.run1 || "previous");
  const runId2 = await resolveRunId(args.run2 || "latest");

  if (!runId1 || !runId2) {
    console.error("Need at least 2 complete runs. Use --run1=<id> --run2=<id>");
    process.exit(1);
  }

  const [{ data: run1 }, { data: run2 }] = await Promise.all([
    admin.from("evaluation_runs").select("*").eq("id", runId1).single(),
    admin.from("evaluation_runs").select("*").eq("id", runId2).single(),
  ]);

  const [{ data: results1 }, { data: results2 }] = await Promise.all([
    admin.from("evaluation_results").select("dossier_id, cost_error_pct, cat1_error_pct, f_error, error_message").eq("run_id", runId1),
    admin.from("evaluation_results").select("dossier_id, cost_error_pct, cat1_error_pct, f_error, error_message").eq("run_id", runId2),
  ]);

  const m1 = run1.metrics || {};
  const m2 = run2.metrics || {};

  console.log(`\n── Comparing Runs ───────────────────────`);
  console.log(`Run 1: "${run1.name}" (${run1.dossier_count} dossiers)`);
  console.log(`Run 2: "${run2.name}" (${run2.dossier_count} dossiers)\n`);

  const metrics = [
    ["Cost MAE",      m1.cost_mae_pct,      m2.cost_mae_pct],
    ["Cost Median",   m1.cost_median_pct,    m2.cost_median_pct],
    ["Cost Worst",    m1.cost_worst_pct,     m2.cost_worst_pct],
    ["% within 10%",  m1.cost_within_10_pct, m2.cost_within_10_pct],
    ["% within 15%",  m1.cost_within_15_pct, m2.cost_within_15_pct],
    ["Cat1 MAE",      m1.cat1_mae_pct,       m2.cat1_mae_pct],
    ["F MAE",         m1.f_mae,              m2.f_mae],
  ];

  console.log("Metric".padEnd(16) + "Run 1".padStart(10) + "Run 2".padStart(10) + "Delta".padStart(10) + "  ");
  console.log("─".repeat(52));
  for (const [label, v1, v2] of metrics) {
    const s1 = v1 != null ? v1.toFixed(1) : "N/A";
    const s2 = v2 != null ? v2.toFixed(1) : "N/A";
    const delta = v1 != null && v2 != null ? v2 - v1 : null;
    const dStr = delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}` : "";
    // For error metrics: lower is better. For "within" metrics: higher is better.
    const isWithin = label.startsWith("%");
    const improved = delta != null && (isWithin ? delta > 0 : delta < 0);
    const icon = delta == null ? "" : improved ? "✅" : delta === 0 ? "➖" : "⚠️";
    console.log(`${label.padEnd(16)}${s1.padStart(10)}${s2.padStart(10)}${dStr.padStart(10)}  ${icon}`);
  }

  // Per-dossier comparison
  const map1 = new Map((results1 ?? []).map((r) => [r.dossier_id, r]));
  const map2 = new Map((results2 ?? []).map((r) => [r.dossier_id, r]));
  const allIds = new Set([...map1.keys(), ...map2.keys()]);

  let improved = 0, worsened = 0, unchanged = 0;
  for (const id of allIds) {
    const r1 = map1.get(id);
    const r2 = map2.get(id);
    if (!r1 || !r2 || r1.cost_error_pct == null || r2.cost_error_pct == null) continue;
    const diff = Math.abs(r2.cost_error_pct) - Math.abs(r1.cost_error_pct);
    if (diff < -2) improved++;
    else if (diff > 2) worsened++;
    else unchanged++;
  }

  console.log(`\n── Per-Dossier ──────────────────────────`);
  console.log(`Improved (>2%): ${improved}  Worsened (>2%): ${worsened}  Unchanged: ${unchanged}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

Add to `package.json` scripts:
```json
"benchmark:compare": "node scripts/benchmark-compare.mjs"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/benchmark-compare.mjs package.json
git commit -m "feat: add benchmark compare CLI script"
```

---

### Task 6: Admin UI — Sidebar + Benchmark Overview Page

**Files:**
- Modify: `src/components/dashboard/sidebar.tsx` (add nav item)
- Create: `src/app/(dashboard)/admin/benchmark/page.tsx`

- [ ] **Step 1: Add Benchmark to sidebar**

In `src/components/dashboard/sidebar.tsx`:

1. Add `FlaskConical` to the lucide-react import
2. Add a new nav item in the NAV array, after the Prompts entry and before Settings:

```typescript
{ label: "Benchmark", href: "/admin/benchmark", icon: FlaskConical, group: "Admin" },
```

The NAV array should have this order in the Admin group: Dossiers, QQP Model, Prompts, **Benchmark**, Settings, Leads.

- [ ] **Step 2: Create the benchmark overview page**

```typescript
// src/app/(dashboard)/admin/benchmark/page.tsx
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FlaskConical, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { EvaluationRun, GroundTruth } from "@/lib/benchmark/types";

export const dynamic = "force-dynamic";

// ── Data fetching ───────────────────────────────────────────────────

async function getRuns(): Promise<EvaluationRun[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("evaluation_runs")
    .select("*")
    .order("started_at", { ascending: false });
  if (error) { console.error("Failed to fetch runs:", error); return []; }
  return (data ?? []) as EvaluationRun[];
}

async function getGroundTruth(): Promise<(GroundTruth & { plan_file_name: string | null })[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("benchmark_ground_truth")
    .select("*, reference_dossiers!inner(plan_file_name)")
    .order("created_at", { ascending: false });
  if (error) { console.error("Failed to fetch ground truth:", error); return []; }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    plan_file_name: (row.reference_dossiers as { plan_file_name: string | null })?.plan_file_name ?? null,
  })) as (GroundTruth & { plan_file_name: string | null })[];
}

// ── Components ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "complete") return <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" /> Complete</span>;
  if (status === "failed") return <span className="inline-flex items-center gap-1 text-xs text-destructive"><XCircle className="h-3 w-3" /> Failed</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-amber-600"><Loader2 className="h-3 w-3 animate-spin" /> Running</span>;
}

function fmt(n: number | null | undefined, suffix = "%"): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}${suffix}`;
}

function fmtEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("nl-BE")}`;
}

// ── Page ────────────────────────────────────────────────────────────

export default async function BenchmarkPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams.tab ?? "runs";
  const [runs, groundTruth] = await Promise.all([getRuns(), getGroundTruth()]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FlaskConical className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Benchmark</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <Link
          href="/admin/benchmark?tab=runs"
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "runs" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Runs ({runs.length})
        </Link>
        <Link
          href="/admin/benchmark?tab=ground-truth"
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            tab === "ground-truth" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Ground Truth ({groundTruth.length})
        </Link>
      </div>

      {tab === "runs" && (
        <div className="rounded-lg border bg-card">
          {runs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No benchmark runs yet. Run <code className="bg-muted px-1 rounded">npm run benchmark:run --all</code> to start.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-right font-medium">Dossiers</th>
                  <th className="px-4 py-3 text-right font-medium">Cost MAE</th>
                  <th className="px-4 py-3 text-right font-medium">Cost Median</th>
                  <th className="px-4 py-3 text-right font-medium">&lt; 15%</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin/benchmark/${run.id}`} className="font-medium text-primary hover:underline">
                        {run.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">{run.dossier_count}</td>
                    <td className="px-4 py-3 text-right">{fmt(run.metrics?.cost_mae_pct)}</td>
                    <td className="px-4 py-3 text-right">{fmt(run.metrics?.cost_median_pct)}</td>
                    <td className="px-4 py-3 text-right">{fmt(run.metrics?.cost_within_15_pct ? run.metrics.cost_within_15_pct * 100 : null)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={run.status} /></td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {new Date(run.started_at).toLocaleDateString("nl-BE")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "ground-truth" && (
        <div className="rounded-lg border bg-card">
          {groundTruth.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No ground truth extracted yet. Run <code className="bg-muted px-1 rounded">npm run benchmark:extract-gt</code> to start.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Dossier</th>
                  <th className="px-4 py-3 text-right font-medium">Expert price</th>
                  <th className="px-4 py-3 text-right font-medium">Cat1 m²</th>
                  <th className="px-4 py-3 text-right font-medium">Cat2 m²</th>
                  <th className="px-4 py-3 text-right font-medium">Cat3 m²</th>
                  <th className="px-4 py-3 text-right font-medium">Confidence</th>
                  <th className="px-4 py-3 text-center font-medium">Verified</th>
                </tr>
              </thead>
              <tbody>
                {groundTruth.map((gt) => (
                  <tr key={gt.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{gt.plan_file_name || gt.dossier_id.slice(0, 8)}</td>
                    <td className="px-4 py-3 text-right">{fmtEur(gt.expert_total_price)}</td>
                    <td className="px-4 py-3 text-right">{gt.expert_cat1_sqm?.toFixed(1) ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{gt.expert_cat2_sqm?.toFixed(1) ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{gt.expert_cat3_sqm?.toFixed(1) ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{gt.extraction_confidence?.toFixed(2) ?? "—"}</td>
                    <td className="px-4 py-3 text-center">
                      {gt.verified ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" /> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npx next build` (or `npm run build`)
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/sidebar.tsx src/app/\(dashboard\)/admin/benchmark/page.tsx
git commit -m "feat: add benchmark overview page with runs and ground truth tabs"
```

---

### Task 7: Admin UI — Run Detail Page

**Files:**
- Create: `src/app/(dashboard)/admin/benchmark/[runId]/page.tsx`

- [ ] **Step 1: Create the run detail page**

```typescript
// src/app/(dashboard)/admin/benchmark/[runId]/page.tsx
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import type { EvaluationRun, EvaluationResult } from "@/lib/benchmark/types";

export const dynamic = "force-dynamic";

function fmt(n: number | null | undefined, suffix = "%"): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}${suffix}`;
}

function fmtEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("nl-BE")}`;
}

function errorColor(pct: number | null): string {
  if (pct == null) return "";
  const abs = Math.abs(pct);
  if (abs <= 5) return "text-green-600";
  if (abs <= 10) return "text-amber-600";
  if (abs <= 15) return "text-orange-600";
  return "text-destructive font-medium";
}

export default async function BenchmarkRunDetailPage({
  params,
}: {
  params: { runId: string };
}) {
  const admin = createSupabaseAdminClient();

  const { data: run } = await admin
    .from("evaluation_runs")
    .select("*")
    .eq("id", params.runId)
    .single();

  if (!run) {
    return <div className="p-8 text-center text-muted-foreground">Run not found.</div>;
  }

  const { data: results } = await admin
    .from("evaluation_results")
    .select("*, reference_dossiers!inner(plan_file_name)")
    .eq("run_id", params.runId)
    .order("created_at", { ascending: true });

  // Sort by absolute cost error descending (worst first), errors at top
  const sorted = [...(results ?? [])].sort((a, b) => {
    if (a.error_message && !b.error_message) return -1;
    if (!a.error_message && b.error_message) return 1;
    const absA = a.cost_error_pct != null ? Math.abs(a.cost_error_pct) : -1;
    const absB = b.cost_error_pct != null ? Math.abs(b.cost_error_pct) : -1;
    return absB - absA;
  });

  const metrics = run.metrics as EvaluationRun["metrics"];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/benchmark" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{run.name}</h1>
          <p className="text-sm text-muted-foreground">
            {run.dossier_count} dossiers · {run.subset_mode} · {new Date(run.started_at).toLocaleString("nl-BE")}
          </p>
        </div>
      </div>

      {/* Aggregate metrics cards */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Cost MAE</p>
            <p className="text-2xl font-semibold">{fmt(metrics.cost_mae_pct)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Cost Median</p>
            <p className="text-2xl font-semibold">{fmt(metrics.cost_median_pct)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Within 15%</p>
            <p className="text-2xl font-semibold">{fmt(metrics.cost_within_15_pct ? metrics.cost_within_15_pct * 100 : null)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">F MAE</p>
            <p className="text-2xl font-semibold">{metrics.f_mae?.toFixed(2) ?? "—"}</p>
          </div>
        </div>
      )}

      {/* Per-dossier results table */}
      <div className="rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Dossier</th>
              <th className="px-4 py-3 text-right font-medium">Predicted cost</th>
              <th className="px-4 py-3 text-right font-medium">Cost error</th>
              <th className="px-4 py-3 text-right font-medium">Cat1 Δ</th>
              <th className="px-4 py-3 text-right font-medium">Cat2 Δ</th>
              <th className="px-4 py-3 text-right font-medium">Cat3 Δ</th>
              <th className="px-4 py-3 text-right font-medium">F Δ</th>
              <th className="px-4 py-3 text-center font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r: Record<string, unknown>) => {
              const result = r as EvaluationResult & { reference_dossiers: { plan_file_name: string | null } };
              const fileName = result.reference_dossiers?.plan_file_name || result.dossier_id.slice(0, 8);
              return (
                <tr key={result.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{fileName}</td>
                  <td className="px-4 py-3 text-right">{fmtEur(result.predicted_total_cost)}</td>
                  <td className={cn("px-4 py-3 text-right", errorColor(result.cost_error_pct))}>
                    {result.cost_error_pct != null ? `${result.cost_error_pct > 0 ? "+" : ""}${result.cost_error_pct.toFixed(1)}%` : "—"}
                  </td>
                  <td className={cn("px-4 py-3 text-right", errorColor(result.cat1_error_pct))}>{fmt(result.cat1_error_pct)}</td>
                  <td className={cn("px-4 py-3 text-right", errorColor(result.cat2_error_pct))}>{fmt(result.cat2_error_pct)}</td>
                  <td className={cn("px-4 py-3 text-right", errorColor(result.cat3_error_pct))}>{fmt(result.cat3_error_pct)}</td>
                  <td className="px-4 py-3 text-right">{result.f_error != null ? result.f_error.toFixed(2) : "—"}</td>
                  <td className="px-4 py-3 text-center">
                    {result.error_message ? (
                      <span className="inline-flex items-center gap-1 text-xs text-destructive" title={result.error_message}>
                        <XCircle className="h-3 w-3" /> Error
                      </span>
                    ) : (
                      <CheckCircle2 className="h-3 w-3 text-green-500 mx-auto" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/admin/benchmark/\[runId\]/page.tsx
git commit -m "feat: add benchmark run detail page"
```

---

### Task 8: Verify End-to-End

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify sidebar**

Navigate to `http://localhost:3000/admin/benchmark`.
Expected: Benchmark page loads with Runs and Ground Truth tabs. Both show empty states.

- [ ] **Step 3: Verify benchmark page loads without errors**

Check browser console for any errors.
Expected: No errors.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Run tests**

Run: `npm run test`
Expected: All tests pass, including the new metrics tests.

- [ ] **Step 6: Final commit (if any fixes needed)**

If any fixes were needed, commit them:
```bash
git add -A
git commit -m "fix: resolve benchmark build/test issues"
```
