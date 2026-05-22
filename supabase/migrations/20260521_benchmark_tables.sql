-- Benchmark system tables for SQM/QQP pipeline evaluation
-- Spec: docs/superpowers/specs/2026-05-21-benchmark-system-design.md

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
