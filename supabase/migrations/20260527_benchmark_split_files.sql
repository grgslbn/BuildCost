-- Benchmark split files: separate plan and calculation storage paths
-- + annotation table for collaborative prompt iteration

-- ── Split file paths ───────────────────────────────────────────────
ALTER TABLE public.reference_dossiers
  ADD COLUMN IF NOT EXISTS calculation_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS calculation_file_name TEXT;

-- ── Benchmark annotations ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.benchmark_annotations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id  UUID NOT NULL REFERENCES public.reference_dossiers(id) ON DELETE CASCADE,
  run_id      UUID REFERENCES public.evaluation_runs(id) ON DELETE SET NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  body        TEXT NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.benchmark_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full" ON public.benchmark_annotations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated read" ON public.benchmark_annotations
  FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_bench_annotations_dossier ON public.benchmark_annotations(dossier_id);
CREATE INDEX idx_bench_annotations_run ON public.benchmark_annotations(run_id);
