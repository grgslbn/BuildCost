-- Benchmark Pipeline — Migration
-- Adds expert ground truth column + benchmark tracking tables

-- ============================================================
-- EXPERT GROUND TRUTH on reference_dossiers
-- ============================================================

ALTER TABLE reference_dossiers
  ADD COLUMN IF NOT EXISTS expert_breakdown JSONB;

COMMENT ON COLUMN reference_dossiers.expert_breakdown IS
  'Expert m² breakdown parsed from PDF Berekening tables. Shape: {floors: [{label, level, total_sqm, terraces_sqm, lines: [{description, sqm}]}], total_enclosed_sqm, total_terraces_sqm}';

-- ============================================================
-- BENCHMARK RUNS
-- ============================================================

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  config JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  summary JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- BENCHMARK RESULTS (per dossier × model)
-- ============================================================

CREATE TABLE IF NOT EXISTS benchmark_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  dossier_id UUID REFERENCES reference_dossiers(id),
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,

  extraction JSONB,

  expert_total_sqm DECIMAL,
  extracted_total_sqm DECIMAL,
  deviation_pct DECIMAL,
  floor_deviations JSONB,

  input_tokens INTEGER,
  output_tokens INTEGER,
  processing_time_ms INTEGER,
  cost_usd DECIMAL,

  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_benchmark_results_run ON benchmark_results(run_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_dossier ON benchmark_results(dossier_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_status ON benchmark_runs(status);
