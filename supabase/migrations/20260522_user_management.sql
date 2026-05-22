-- ── 1. Extend users table ──────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS invited_by      uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS invited_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_active_at  timestamptz;

-- ── 2. Tenant usage monthly materialized view ─────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.tenant_usage_monthly AS
SELECT
  e.tenant_id,
  date_trunc('month', e.created_at)::date                    AS month,
  COUNT(*)                                                    AS estimation_count,
  COUNT(*) FILTER (WHERE e.status = 'complete')              AS completed_count,
  COUNT(*) FILTER (WHERE e.status = 'error')                 AS errored_count,
  COALESCE(SUM(a.tokens_input), 0)                           AS total_tokens_input,
  COALESCE(SUM(a.tokens_output), 0)                          AS total_tokens_output,
  ROUND(
    (COALESCE(SUM(a.tokens_input), 0)  * 3.0  / 1000000) +
    (COALESCE(SUM(a.tokens_output), 0) * 15.0 / 1000000),
    2
  )                                                           AS estimated_cost_usd,
  COALESCE(SUM(e.processing_time_ms), 0)                     AS total_processing_ms
FROM public.estimations e
LEFT JOIN public.api_call_log a ON a.estimation_id = e.id
GROUP BY e.tenant_id, date_trunc('month', e.created_at)::date;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_usage_monthly_pk
  ON public.tenant_usage_monthly (tenant_id, month);

-- ── 3. Update RLS on estimations ──────────────────────────────────────────────
-- Drop any existing tenant-scoped estimation policies so we can replace them.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE tablename = 'estimations' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.estimations', pol.policyname);
  END LOOP;
END $$;

-- Re-enable RLS (idempotent)
ALTER TABLE public.estimations ENABLE ROW LEVEL SECURITY;

-- Admin: full access to all estimations
CREATE POLICY "admin_all_estimations" ON public.estimations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
  );

-- Customer: own-tenant estimations only
CREATE POLICY "customer_own_tenant_estimations" ON public.estimations
  FOR ALL
  USING (
    tenant_id IN (
      SELECT users.tenant_id FROM public.users
      WHERE users.id = auth.uid()
    )
  );

-- Service role bypass (for API routes using admin client)
CREATE POLICY "service_role_all_estimations" ON public.estimations
  FOR ALL
  USING (auth.role() = 'service_role');

-- ── 4. Grant refresh privilege to authenticated role ──────────────────────────
-- (Admins can trigger a refresh from the billing page via a server action)
GRANT SELECT ON public.tenant_usage_monthly TO authenticated;
