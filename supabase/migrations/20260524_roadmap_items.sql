-- supabase/migrations/20260524_roadmap_items.sql
-- Simple roadmap / task board for internal project management

create table if not exists public.roadmap_items (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text default '',
  status        text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority      integer not null default 0,        -- lower = higher priority, used for drag-drop ordering
  assigned_to   text default null,                 -- 'georges' | 'tiemen' | null
  category      text default 'general',            -- e.g. 'core', 'frontend', 'infra', 'polish'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Index for fast ordering queries
create index if not exists idx_roadmap_status_priority on public.roadmap_items (status, priority);

-- Auto-update updated_at
create or replace function public.roadmap_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_roadmap_updated_at
  before update on public.roadmap_items
  for each row execute function public.roadmap_updated_at();

-- RLS: allow all for authenticated users (admin-only page anyway)
alter table public.roadmap_items enable row level security;

create policy "Authenticated users can do everything on roadmap_items"
  on public.roadmap_items
  for all
  using (true)
  with check (true);
