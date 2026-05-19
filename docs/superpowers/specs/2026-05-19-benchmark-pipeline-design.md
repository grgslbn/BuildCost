# Benchmark Pipeline — Design Spec

## Goal

Process 5 reference dossiers (VerzamelPDFs) through 3 Claude models (Haiku, Sonnet, Opus), compare AI extraction against expert ground truth, store results in Supabase, and display a live accuracy dashboard. Georges (WS2) connects to the shared `reference_dossiers` table.

## Architecture: API + DB + Live Dashboard

### Database Schema

Two new tables + one new column on `reference_dossiers`:

```sql
-- Expert ground truth extracted from PDF text layer
ALTER TABLE reference_dossiers
  ADD COLUMN expert_breakdown JSONB;

-- One row per pipeline execution (e.g., "run all 5 dossiers on Sonnet")
CREATE TABLE benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  model_id TEXT NOT NULL,            -- 'claude-haiku-4-5-20251001', etc.
  prompt_version TEXT NOT NULL,      -- 'v3'
  config JSONB DEFAULT '{}',        -- rendering params, crop settings
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  summary JSONB,                    -- aggregate accuracy metrics
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One row per dossier × model combination
CREATE TABLE benchmark_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  dossier_id UUID REFERENCES reference_dossiers(id),
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,

  -- AI output (raw prompt output shape, not normalized contract)
  extraction JSONB,

  -- Comparison metrics
  expert_total_sqm DECIMAL,
  extracted_total_sqm DECIMAL,
  deviation_pct DECIMAL,            -- (extracted - expert) / expert * 100
  floor_deviations JSONB,           -- per-floor breakdown

  -- Performance
  input_tokens INTEGER,
  output_tokens INTEGER,
  processing_time_ms INTEGER,
  cost_usd DECIMAL,

  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- No RLS on benchmark tables — admin-only access via service_role_key
CREATE INDEX idx_benchmark_results_run ON benchmark_results(run_id);
CREATE INDEX idx_benchmark_results_dossier ON benchmark_results(dossier_id);
```

### Pipeline Flow (3 stages)

**Stage 1 — Expert Extraction** (text layer, one-time per dossier)
- Scan PDF for "Berekening" / "Opp/inhoud" pages using pdfjs-dist
- Parse expert m² table into structured JSON:
  ```json
  { "floors": [{ "label": "kelder", "level": -1, "total_sqm": 747,
      "lines": [{ "description": "kelders, garage, inrit", "sqm": 747 }] }],
    "total_enclosed_sqm": 1856, "total_terraces_sqm": 131 }
  ```
- Store in `reference_dossiers.expert_breakdown`

**Stage 2 — AI Vision Extraction** (per model)
- Detect plan pages in PDF (architectural drawings vs. admin/photos)
- Render plan pages at high resolution via mupdf
- Crop multi-plan landscape pages into individual floor plans
- Send to Claude Vision with extraction prompt
- Store result in `benchmark_results.extraction`

**Stage 3 — Comparison**
- Compare AI output against expert ground truth
- Calculate per-floor and total deviation
- Store metrics in `benchmark_results`

### Data Architecture

```
reference_dossiers (shared with WS2)
  ├── expert_breakdown    ← expert ground truth (Stage 1)
  ├── sqm_extraction      ← best AI result (promoted from benchmark)
  └── qqp_extraction      ← Georges (WS2) fills this

benchmark_runs            ← pipeline execution metadata
  └── benchmark_results   ← per-dossier × per-model results
```

### SQM Output Format

SQM_CONTRACT v2.0 — hybrid format:
- Per-building, per-floor totals (`floor_total_sqm`, `terraces_sqm`)
- Zone-level breakdown (`residential`, `parking`, `storage`, etc.)
- Optional room-level detail within zones (`rooms[]` with category + features)
- Features at room level for WS2 QQP discovery

### Model Comparison

| Model | ID | Expected Use |
|-------|-----|-------------|
| Haiku | claude-haiku-4-5-20251001 | Fast/cheap baseline |
| Sonnet | claude-sonnet-4-20250514 | Quality/speed balance |
| Opus | claude-opus-4-20250514 | Maximum quality |

Run all 5 dossiers on all 3 models. User decides if Opus testing continues based on quality delta vs cost.

### Dashboard

Admin page at `/admin/benchmark` showing:
- Run history with status badges
- Per-dossier accuracy grid (model × dossier, color-coded by deviation)
- Aggregate metrics: MAE, median deviation, processing time, cost per dossier
- Click-through to per-floor comparison (expert vs AI side-by-side)

### API Routes

- `POST /api/benchmark/run` — start a benchmark run
- `GET /api/benchmark/runs` — list runs with summary
- `GET /api/benchmark/results/:runId` — detailed results for a run
- `POST /api/benchmark/extract-expert` — extract expert data from a dossier PDF

### File Structure

```
scripts/
  benchmark-pipeline.mjs    ← CLI runner for batch processing
src/app/admin/benchmark/
  page.tsx                   ← dashboard
  [runId]/page.tsx           ← run detail
src/lib/
  pdf-classifier.ts         ← detect plan pages vs admin pages
  expert-extractor.ts       ← parse expert tables from text layer
  plan-renderer.ts          ← mupdf rendering + cropping
  sqm-extractor.ts          ← Claude Vision API call
  benchmark-compare.ts      ← comparison logic
```

## Runtime

The pipeline CLI (`scripts/benchmark-pipeline.mjs`) runs **locally or on Railway** — NOT on Vercel serverless. `mupdf` is a native WASM binary that needs a Node.js environment with sufficient memory. The dashboard pages and API routes run on Vercel as normal Next.js.

## Scope

- 5 dossiers from `C:\Users\tieme\Mijn Drive\M²Value\field\SELECTION\selectie building`
- 3 models (Haiku, Sonnet, Opus)
- Prompt v3 (current)
- No auto-learning yet — manual prompt iteration based on dashboard insights
