-- Processing queue for Railway worker
-- Jobs are inserted by Vercel API routes, picked up by the Railway worker

CREATE TABLE IF NOT EXISTS public.processing_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimation_id   UUID NOT NULL REFERENCES public.estimations(id) ON DELETE CASCADE,
  job_type        TEXT NOT NULL DEFAULT 'estimate',  -- 'estimate', 'dossier', 'benchmark'
  priority        INT NOT NULL DEFAULT 1,            -- lower = higher priority (1=estimate, 5=dossier, 10=benchmark)
  status          TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'claimed', 'processing', 'done', 'error'
  worker_id       TEXT,                              -- identifies which worker slot claimed this
  error_message   TEXT,
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 2,
  payload         JSONB DEFAULT '{}',                -- extra params like maxWidth, dpi, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

-- Index for efficient worker polling: pending jobs ordered by priority then age
CREATE INDEX idx_queue_pending ON public.processing_queue (priority ASC, created_at ASC)
  WHERE status = 'pending';

-- Index for looking up queue status by estimation
CREATE INDEX idx_queue_estimation ON public.processing_queue (estimation_id);

-- RLS
ALTER TABLE public.processing_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full" ON public.processing_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Atomic claim function: worker calls this to claim the next available job
-- Uses FOR UPDATE SKIP LOCKED to prevent double-claiming
CREATE OR REPLACE FUNCTION public.claim_queue_job(
  p_worker_id TEXT,
  p_job_types TEXT[] DEFAULT ARRAY['estimate', 'dossier', 'benchmark']
)
RETURNS SETOF public.processing_queue
LANGUAGE sql
AS $$
  UPDATE public.processing_queue
  SET status = 'claimed',
      worker_id = p_worker_id,
      started_at = now(),
      attempts = attempts + 1
  WHERE id = (
    SELECT id FROM public.processing_queue
    WHERE status = 'pending'
      AND job_type = ANY(p_job_types)
    ORDER BY priority ASC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
