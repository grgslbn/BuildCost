# Benchmark & Optimization System for SQM/QQP Pipelines

## Goal

Build a systematic benchmark system that measures the accuracy of BuildCost's two AI pipelines (SQM extraction and QQP scoring) against expert ground truth, enabling prompt optimization through repeatable, comparable evaluation runs.

## Context

BuildCost estimates reconstruction costs from building plans. The pipeline is:

```
Upload PDF → SQM extraction (m² per room) → QQP scoring (finishing level) → F coefficient → Cost calculation
```

We have ~40 expert dossiers. Each is a single PDF containing both floor plans and the expert's calculation with:
- Total reconstruction cost (EUR)
- m² per category (cat1: livable, cat2: enclosed non-livable, cat3: outdoor)

These serve as ground truth. The benchmark system runs the real pipeline on these dossiers and compares results against the expert values.

## Architecture

Three new components, all integrated into the existing app:

1. **Database tables** — Ground truth storage + evaluation run/result tracking
2. **CLI scripts** — Batch operations: upload, extract ground truth, run benchmarks, compare runs
3. **Admin UI page** — `/admin/benchmark` in the existing dashboard sidebar

The benchmark calls the **real** `/api/estimate-process` endpoint — the identical code path end users hit. This guarantees that benchmark improvements translate directly to production accuracy.

## Data Model

### Table: `benchmark_ground_truth`

Stores the expert's values per dossier. Extracted once by AI, optionally hand-verified.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | |
| `dossier_id` | UUID, FK → reference_dossiers, UNIQUE | One ground truth per dossier |
| `expert_total_price` | numeric | Expert's total reconstruction cost (EUR) |
| `expert_cat1_sqm` | numeric | Expert's livable area (m²) |
| `expert_cat2_sqm` | numeric | Expert's enclosed non-livable area (m²) |
| `expert_cat3_sqm` | numeric | Expert's outdoor area (m²) |
| `expert_total_sqm` | numeric | Computed: cat1 + cat2 + cat3 |
| `expert_finishing_level` | text, nullable | If the expert mentions a finishing level |
| `extraction_confidence` | numeric | AI confidence in the extraction |
| `verified` | boolean, default false | Manually verified? |
| `notes` | text, nullable | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

RLS: service_role full access, authenticated read-only.

### Table: `evaluation_runs`

One row per benchmark run. Links to the prompt versions used.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | |
| `name` | text | Human-readable label, e.g. "SQM v12 + QQP v3" |
| `sqm_prompt_version_id` | UUID, FK → prompt_versions, nullable | SQM prompt that was active during this run (recorded after run starts) |
| `qqp_prompt_version_id` | UUID, FK → prompt_versions, nullable | QQP prompt that was active during this run (recorded after run starts) |
| `model_version_id` | UUID, FK → qqp_model_versions, nullable | Ridge model that was active during this run |
| `dossier_count` | int | Number of dossiers in this run |
| `subset_mode` | text | 'all', 'difficult', 'manual' |
| `metrics` | JSONB | Aggregate metrics (see Metrics section) |
| `status` | text | 'running', 'complete', 'failed' |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz, nullable | |
| `notes` | text, nullable | |

### Table: `evaluation_results`

One row per (run, dossier) combination. Stores extracted values and error metrics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID, PK | |
| `run_id` | UUID, FK → evaluation_runs | |
| `dossier_id` | UUID, FK → reference_dossiers | |
| `UNIQUE(run_id, dossier_id)` | | One result per dossier per run |
| **SQM results** | | |
| `extracted_cat1_sqm` | numeric | Pipeline's livable area |
| `extracted_cat2_sqm` | numeric | Pipeline's enclosed non-livable area |
| `extracted_cat3_sqm` | numeric | Pipeline's outdoor area |
| `sqm_extraction` | JSONB | Full SQM output for drill-down |
| `cat1_error_pct` | numeric | (extracted - expert) / expert * 100 |
| `cat2_error_pct` | numeric | |
| `cat3_error_pct` | numeric | |
| **QQP results** | | |
| `extracted_qqps` | JSONB | Full QQP output |
| `predicted_f` | numeric | Pipeline's finishing coefficient |
| `expert_f` | numeric | Back-calculated using `backcalculateF()` from `src/lib/qqp/f-backcalculate.ts` with expert price + expert m² + regional/ABEX factors at the dossier's valuation date |
| `f_error` | numeric | predicted_f - expert_f |
| **Cost results** | | |
| `predicted_total_cost` | numeric | Pipeline's total cost |
| `cost_error_pct` | numeric | (predicted - expert) / expert * 100 |
| **Meta** | | |
| `processing_time_ms` | int | |
| `error_message` | text, nullable | If this dossier failed |
| `created_at` | timestamptz | |

## Metrics

### Per-dossier metrics (stored in `evaluation_results`)

| Metric | Formula | Purpose |
|--------|---------|---------|
| `cost_error_pct` | `(predicted - expert) / expert * 100` | Primary accuracy metric |
| `cat1_error_pct` | `(extracted - expert) / expert * 100` | SQM accuracy (livable) |
| `cat2_error_pct` | same | SQM accuracy (non-livable) |
| `cat3_error_pct` | same | SQM accuracy (outdoor) |
| `f_error` | `predicted_f - expert_f` | QQP/model accuracy |

### Aggregate metrics per run (stored in `evaluation_runs.metrics` JSONB)

```json
{
  "cost_mae_pct": 7.2,
  "cost_median_pct": 5.1,
  "cost_worst_pct": 21.7,
  "cost_within_10_pct": 0.75,
  "cost_within_15_pct": 0.82,
  "cat1_mae_pct": 4.2,
  "cat2_mae_pct": 8.1,
  "cat3_mae_pct": 12.3,
  "f_mae": 0.09,
  "f_median": 0.06,
  "dossiers_succeeded": 38,
  "dossiers_failed": 2
}
```

### Target accuracy

| Metric | Target | Acceptable |
|--------|--------|------------|
| Cost median error | < 10% | < 15% |
| Cost % within 15% | > 80% | > 65% |
| Cat1 m² median error | < 8% | < 12% |
| F MAE | < 0.10 | < 0.15 |

## CLI Scripts

All scripts in `scripts/` directory, runnable via npm scripts in package.json.

### `npm run benchmark:extract-ground-truth`

Extracts expert values from dossier PDFs.

- Reads all `reference_dossiers` that lack a `benchmark_ground_truth` row
- Downloads each PDF from Supabase Storage
- Sends expert pages (pricing_table, expert_report) to Claude with a dedicated extraction prompt
- Stores extracted values in `benchmark_ground_truth`
- Output: summary of extracted/failed dossiers

### `npm run benchmark:run`

Runs the real pipeline on dossiers and records results.

**Flags:**
- `--all` — run all dossiers with ground truth
- `--subset=difficult` — only dossiers where previous run had `|cost_error_pct| > 15%` (requires at least one prior complete run; errors if none exists)
- `--subset=ids:abc,def` — specific dossier IDs
- `--concurrency=3` — parallel processing (default: 3)
- `--name="Run description"` — label for this run

The benchmark always uses the currently **active** prompt versions (the same ones end users get). To test a new prompt, activate it in `/admin/prompts` first, then run the benchmark. The run records which prompt versions and Ridge model were active at start time.

**Flow per dossier:**
1. Create an `estimations` row via Supabase admin client (service_role), copying `tenant_id`, `plan_storage_path`, `plan_file_name`, and `postcode` from the corresponding `reference_dossiers` row. No file re-upload needed.
2. Call `POST /api/estimate-process` with the estimation ID (this is the real pipeline, same as end users)
3. Poll the `estimations` table directly via admin client until `status = 'complete'` or `'error'` (bypasses auth-gated HTTP endpoint)
4. Read completed result from `estimations` row
5. Compare with `benchmark_ground_truth` values
6. Compute `expert_f` using `backcalculateF()` with the expert's m² and price
7. Write to `evaluation_results`

After all dossiers: compute aggregate metrics, update `evaluation_runs`.

**Terminal output:** live progress with per-dossier results and final summary.

### `npm run benchmark:compare`

Compare two runs side-by-side.

**Flags:**
- `--run1=<id>` — first run (or 'previous' for most recent before run2)
- `--run2=<id>` — second run (or 'latest')

**Output:** per-metric comparison, list of improved/worsened/unchanged dossiers.

## Admin UI

### Route: `/admin/benchmark`

Added to the dashboard sidebar in the Admin group, between Prompts and Settings. Icon: `FlaskConical` (or `Target`).

### View 0: Ground Truth (tab on benchmark page)

Table of all dossiers with their extracted ground truth values:

| Column | Content |
|--------|---------|
| Dossier | File name |
| Expert price | Total reconstruction cost |
| Cat1 m² | Livable area |
| Cat2 m² | Enclosed non-livable |
| Cat3 m² | Outdoor |
| Confidence | AI extraction confidence |
| Verified | Checkbox — mark as manually verified |
| Actions | Edit values inline if AI extraction was wrong |

This view is essential for the initial setup: after running `benchmark:extract-ground-truth`, review and verify the extracted values here before running benchmarks.

### View 1: Run Overview (default)

Table of all evaluation runs, most recent first:

| Column | Content |
|--------|---------|
| Name | Run label + prompt versions used |
| Dossiers | Count |
| Cost MAE | Aggregate cost error |
| Cost Median | Median cost error |
| % < 15% | Dossiers within acceptable range |
| Status | Running / Complete / Failed |
| Date | When the run was executed |

Action: click a row to see run detail.

### View 2: Run Detail (`/admin/benchmark/[runId]`)

Per-dossier results table, sorted by absolute cost error (worst first):

| Column | Content |
|--------|---------|
| Dossier | File name |
| Expert cost | Ground truth total price |
| Predicted cost | Pipeline result |
| Cost error | Percentage deviation |
| Cat1 delta | m² error |
| Cat2 delta | m² error |
| F delta | Finishing coefficient error |
| Status | Success / Error |

Click a row to expand: full SQM extraction JSON, QQP scores, and link to the plan PDF.

### View 3: Compare Runs

Select two runs (checkboxes on run overview) → compare button.

Shows:
- Side-by-side aggregate metrics with delta and directional indicator
- Per-dossier comparison: improved / worsened / unchanged (within +-2% tolerance)
- Count summary: "12 improved, 3 worsened, 25 unchanged"

## Optimization Workflow

### Initial setup (once)

1. Upload 40 expert PDFs via `/admin/dossiers` or batch script
2. Run `npm run benchmark:extract-ground-truth` to extract expert values
3. Verify ground truth in `/admin/benchmark` (mark as verified)

### Optimization loop (repeating)

```
1. npm run benchmark:run --all                → baseline run
2. Review /admin/benchmark → identify worst dossiers
3. Drill into failures → understand WHY (wrong m², wrong QQP, wrong F?)
4. Edit prompt in /admin/prompts → save as new version
5. npm run benchmark:run --subset=difficult   → spot-check on problem cases
6. Improved? → npm run benchmark:run --all    → full validation
7. Compare runs in /admin/benchmark
8. Better? → activate new prompt version. Worse? → revert.
```

### What optimizes automatically

The Ridge regression model (F prediction weights) retrains automatically as more dossiers are processed with better SQM/QQP data. Each benchmark run that produces better extractions also feeds better training data to the model.

### What requires manual work

Prompt text changes. The benchmark system makes this systematic by:
- Measuring the impact of each change
- Tracking which prompt version produced which results
- Highlighting which dossiers improved or regressed

## Scope Boundaries

**In scope:**
- Ground truth extraction from expert PDFs
- Benchmark run infrastructure (CLI + DB + UI)
- Metrics calculation and comparison
- Integration with existing prompt_versions system

**Out of scope (future work):**
- Automatic prompt optimization / prompt search
- Per-room m² comparison (experts only provide per-category totals)
- CI/CD integration (automated benchmark on PR)
- Ground truth for individual QQP scores (experts don't score QQPs)

## File Structure

```
scripts/
├── benchmark-extract-ground-truth.mjs   -- ground truth extraction
├── benchmark-run.mjs                    -- run evaluations
├── benchmark-compare.mjs                -- compare two runs

src/app/(dashboard)/admin/benchmark/
├── page.tsx                             -- run overview
├── [runId]/
│   └── page.tsx                         -- run detail

src/lib/benchmark/
├── ground-truth-extractor.ts            -- AI extraction of expert values
├── metrics.ts                           -- metric calculations
├── types.ts                             -- shared types

supabase/migrations/
└── YYYYMMDD_benchmark_tables.sql        -- 3 new tables
```
