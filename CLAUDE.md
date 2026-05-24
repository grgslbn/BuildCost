# CLAUDE.md — PlanBase (planbased.xyz)

> **Shared context for all Claude Code sessions. Update after every milestone.**
> **Last updated: 2026-05-24**

---

## What This Is

**PlanBase** (deployed as **planbased.xyz**, repo name `BuildCost`) is a web tool for Belgian building insurance companies to estimate reconstruction costs after sinister (fire, flood, etc.) based ONLY on an uploaded building plan. The system extracts surface areas via Claude Vision, discovers finishing-level parameters (QQPs), and calculates a precise rebuild cost per m².

**This is NOT real estate valuation.** It's construction rebuild cost. Regional variation is handled via a postcode coefficient.

## Core Formula (V2)

```
CAT_price(F) = CAT_min + (F − 0.70) / 0.80 × (CAT_max − CAT_min)

Total Cost = (CAT1_sqm × CAT1_price + CAT2_sqm × CAT2_price + CAT3_sqm × CAT3_price)
           × Regional Factor × ABEX Factor
```

| Category | Rooms | Default Min | Default Max |
|----------|-------|-------------|-------------|
| **CAT1** — Livable | living, bedroom, kitchen, bathroom, office | €1 100/m² | €1 900/m² |
| **CAT2** — Enclosed non-livable | garage, storage, utility | €550/m² | €950/m² |
| **CAT3** — Outdoor built | terrace, balcony | €330/m² | €570/m² |
| EXCLUDED | garden | — | — |

- **F (Finishing Coefficient)**: 0.70–1.50, derived from QQPs via ridge regression on reference dossiers
- **Regional Factor**: `postcode_base_price / cat1_price_at_F1.0`
- **ABEX Factor**: construction price index ÷ 1000 (semi-annual update)
- **Cat prices** are configurable in Settings

## Tech Stack

- **Framework**: Next.js 14 (App Router) + Tailwind + shadcn/ui
- **Database**: Supabase (Postgres + Auth + Storage + RLS)
- **AI**: Anthropic Claude API (Sonnet with extended thinking for vision extraction)
- **Deployment**: Vercel Pro (agent6-projects team, `build-cost` project)
- **Domain**: planbased.xyz
- **Source control**: GitHub monorepo (`grgslbn/BuildCost`)

## Key Pages

| Route | Purpose |
|-------|---------|
| `/` | Landing page (public) |
| `/estimate` | End-user estimation: upload → processing → results |
| `/estimations` | User's estimation history |
| `/report/[id]` | **Public** shareable report (UUID-as-secret, no auth needed) |
| `/admin/dossiers` | Upload & manage reference dossiers |
| `/admin/benchmark` | Benchmark runs overview + ground truth |
| `/admin/benchmark/[runId]` | Per-dossier benchmark results |
| `/admin/qqp` | QQP management, model versions, weight bars |
| `/admin/prompts` | Versioned SQM/QQP prompt management |
| `/admin/settings` | Category prices, ABEX, regional factor config |
| `/admin/leads` | Email capture + report sending |
| `/admin/tenants` | Tenant management: list, create, invite users |
| `/admin/billing` | Cross-tenant usage overview with monthly stats |
| `/admin/roadmap` | Internal Kanban task board (Georges & Tiemen) |
| `/analytics` | API call logs, model performance, system health |
| `/customer/overview` | Customer portal: stats + recent estimations |
| `/customer/estimations` | Customer estimation list |
| `/customer/estimations/[id]` | Customer detail: hero cost, confidence bars, share |
| `/customer/usage` | Monthly usage history |
| `/customer/account` | Profile + sign out |

## Key API Routes

| Route | Purpose |
|-------|---------|
| `/api/estimate-process` | **Main pipeline**: PDF → classify → render → SQM → QQP → cost. `maxDuration=300` |
| `/api/estimate-status/[id]` | Poll estimation status (timeout detection built in) |
| `/api/process-dossier` | Process reference dossiers (training data) |
| `/api/report/[id]/pdf` | Generate PDF report via pdf-lib (no auth, UUID-as-secret) |
| `/api/my/share-report` | Email report to recipient with "shared by" context |
| `/api/my/usage` | Customer's own monthly usage |
| `/api/admin/roadmap` | CRUD for roadmap items (GET/POST/PATCH/DELETE) |
| `/api/admin/tenants/...` | Tenant management + user invite |
| `/api/admin/usage/...` | Cross-tenant usage for billing page |
| `/api/benchmark/run` | Create benchmark run, returns dossier list |
| `/api/benchmark/run/[runId]/init` | Create estimation row for benchmark dossier |
| `/api/benchmark/run/[runId]/record` | Compare estimation with ground truth |
| `/api/benchmark/run/[runId]/finalize` | Compute aggregate metrics |
| `/api/benchmark/poll-estimation/[id]` | Poll estimation status + stuck detection |
| `/api/benchmark/extract-gt` | AI-extract ground truth from expert calculations |
| `/api/calibrate-weights` | Ridge regression on QQP weights |
| `/api/retroactive-extract` | Re-extract QQPs from stored SQM data |

## Pipeline Architecture

```
Upload PDF → classify pages → render PNG → SQM extraction (Claude + 10K thinking)
→ QQP extraction (Claude) → F calculation (ridge regression weights)
→ cost calculation → store result
```

- **SQM Extraction**: Claude Sonnet with extended thinking (10K budget). Processes rendered plan pages to identify rooms and calculate areas. Currently at v9 prompt: 18/24 perfect on test set.
- **QQP Extraction**: Claude extracts finishing parameters from plan annotations (windows, doors, kitchen, bathroom, heating type, etc.)
- **F Calculation**: Ridge regression model trained on reference dossiers. Maps QQP values → finishing coefficient.
- **Prompt Versioning**: `prompt_versions` table stores versioned SQM/QQP prompts. Active version used by pipeline. Managed via `/admin/prompts`.

## Benchmark System

Evaluates pipeline accuracy against expert ground truth (43 reference dossiers with known expert calculations).

**Tables**: `benchmark_ground_truth`, `evaluation_runs`, `evaluation_results`
**Spec**: `docs/superpowers/specs/2026-05-21-benchmark-system-design.md`
**Plan**: `docs/superpowers/plans/2026-05-21-benchmark-system.md`

**Flow**: Extract ground truth from expert PDFs → Create run → For each dossier: init estimation → fire pipeline → poll until done → record (compare with expert) → finalize (aggregate metrics)

**Metrics tracked per dossier**: Cat1/Cat2/Cat3 SQM error %, cost error %, F delta, predicted vs expert cost
**Aggregate metrics**: Cost MAE, cost median, worst case, within 10%/15%, F MAE

**Current client-side runner** (`start-run-button.tsx`) processes dossiers sequentially. Stuck detection marks estimations >6 min as Vercel-killed.

## Known Issues & Constraints

1. **Vercel Pro 300s function limit** — #1 blocker. Most VerzamelPDF dossiers exceed this timeout. The SQM extraction with extended thinking (10K) + QQP extraction can take 4-8 min for large PDFs. Only ~5% of dossiers complete within the limit.
2. **Browser tab sleep kills benchmark runner** — The client-side for-loop stops when Chrome throttles background tabs. The runner must stay in the foreground.
3. **SQM v9 prompt plateau** — 18/24 perfect on test set, remaining errors are Claude vision model limitations (can't read small text, misidentifies room boundaries).

## Conventions

- **Language**: English for code and docs. UI supports NL/FR labels from Belgian plans.
- **Components**: shadcn/ui. Install via `npx shadcn-ui@latest add [component]`
- **DB access**: `createSupabaseAdminClient()` (service_role, bypasses RLS) for API routes. `createSupabaseServerClient()` (anon key + cookies) for user-facing server components.
- **Environment**: Vercel env vars pulled via `vercel env pull`. Supabase keys are NOT in `.env.local` — they're in Vercel.
- **Migrations**: SQL files in `supabase/migrations/`. Applied via Supabase MCP tool (`apply_migration`) or manually via Supabase dashboard SQL editor (CLI not linked).
- **SKIP_AUTH**: `middleware.ts` checks `SKIP_AUTH` env var to bypass auth in development.

## Multi-Tenant & Customer Portal

- **Auth**: Supabase Auth with magic link. `getSessionWithRole()` helper routes admin vs customer users.
- **Admin sidebar**: Dossiers, QQP, Prompts, Settings, Benchmark, Leads, Tenants, Billing, Roadmap
- **Customer portal** (`/customer/*`) — branded terracotta/Bricolage layout
- `tenant_usage_monthly` materialized view for billing data
- API routes: `/api/admin/tenants/...`, `/api/admin/usage/...`, `/api/my/usage`, `/api/my/share-report`

## Shareable Reports & PDF (Task 12)

- `/report/[id]` — public report page, no auth, UUID is the secret (Google Docs model)
- Shows: hero cost card, CAT1/2/3 breakdown, room list per floor, PDF download button
- `/api/report/[id]/pdf` — generates A4 PDF via `pdf-lib` with full cost breakdown
- `sendReportDirect(estimationId, email, sharedBy?)` in `src/lib/email/send-report.ts`
  - Used by customer share flow; injects "shared by [name] from [company]" banner
  - `sendReportForLead(leadId)` is the legacy public funnel path

## Supabase Details

- **Project ref**: `sqmpgzzjxsmywmpsplmu`
- **Region**: eu-west-1
- **URL**: `https://sqmpgzzjxsmywmpsplmu.supabase.co`
- **Storage bucket**: `plans` (private, 50 MB limit, PDF/PNG/JPG)
- **Key tables**: `estimations`, `reference_dossiers`, `benchmark_ground_truth`, `evaluation_runs`, `evaluation_results`, `prompt_versions`, `qqp_model_versions`, `postcode_prices`, `abex_index`, `users`, `tenants`, `leads`, `tenant_usage_monthly`, `roadmap_items`

## Current Status (2026-05-24)

### Working
- [x] Full end-to-end estimation pipeline (upload → SQM → QQP → cost)
- [x] Public estimation page at planbased.xyz
- [x] 43 reference dossiers uploaded with expert ground truth extracted
- [x] Benchmark system with admin UI for run management + per-dossier results
- [x] Prompt versioning system (SQM + QQP)
- [x] QQP ridge regression model training from reference dossiers
- [x] Admin pages: dossiers, benchmark, QQP model, prompts, settings, leads, tenants, billing, roadmap
- [x] Email capture during processing + report sending
- [x] Postcode extracted from plan (no user input needed)
- [x] Multi-tenant system with customer portal (`/customer/*`)
- [x] Shareable public report page (`/report/[id]`) — UUID-as-secret model
- [x] PDF download (`/api/report/[id]/pdf`) via pdf-lib
- [x] "Share by email" from customer portal with sender context
- [x] Admin Kanban roadmap (`/admin/roadmap`) — Supabase-backed, drag-and-drop
- [x] Architecture docs: `docs/document-analysis-flows.html` (dark) + `docs/document-analysis-flows-light.html` (light/PlanBase)

### First Benchmark Results (21 May overnight)
- 35 dossiers attempted, 19 processed (16 skipped — browser went to sleep)
- **1 success**: Cat1 SQM 0.0% error (perfect!), cost +38.6% (QQP/pricing issue)
- **18 failures**: All Vercel 300s timeout on VerzamelPDF files
- **Conclusion**: SQM extraction is solid, cost error comes from F/pricing. Vercel timeout is the #1 blocker for benchmarking.

### Next Steps
- [ ] Solve Vercel 300s timeout (options: local CLI benchmark, Inngest background jobs, pipeline optimization)
- [ ] Investigate cost error source: regional factor, ABEX correction, or QQP weight calibration
- [ ] Complete benchmark run on all 35 dossiers (need working timeout solution first)
- [ ] Improve QQP extraction and F calculation based on benchmark insights
