# CLAUDE.md — PlanBase (planbased.xyz)

> **Last updated: 2026-05-28** (Railway worker verified locally, env var bridge fix, deployment instructions)

---

## ⚠️ STANDING INSTRUCTION — READ BEFORE EVERY COMMIT

**Before running `git commit` or `git push`, always check whether CLAUDE.md needs updating.**

Ask yourself:
- Did I add or change a page, route, API endpoint, or Supabase table?
- Did I change a core convention, pattern, or architectural decision?
- Did the project name, domain, or tech stack change?
- Did the "Current Status / Working / Next Steps" section change?

If yes to any of the above → update CLAUDE.md first, then commit both together.
Update the `Last updated` date at the top whenever you touch this file.

---

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
| `/admin/prompt-lab` | Prompt Lab: runs, dossiers, ground truth |
| `/admin/prompt-lab/[runId]` | Per-dossier run results |
| `/admin/prompt-lab/dossier/[dossierId]` | Dossier detail: cross-run comparison + annotations |
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
| `/api/prompt-lab/run` | Create prompt lab run, returns dossier list |
| `/api/prompt-lab/run/[runId]/init` | Create estimation row for dossier |
| `/api/prompt-lab/run/[runId]/record` | Compare estimation with ground truth |
| `/api/prompt-lab/run/[runId]/finalize` | Compute aggregate metrics |
| `/api/prompt-lab/poll-estimation/[id]` | Poll estimation status + stuck detection |
| `/api/prompt-lab/extract-gt` | AI-extract ground truth from expert calculations |
| `/api/admin/prompt-lab/upload` | Upload plan/calculation PDF per dossier |
| `/api/admin/prompt-lab/annotations` | CRUD for dossier annotations |
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

## Prompt Lab (formerly Benchmark)

Evaluates pipeline accuracy against expert ground truth. 637 reference dossiers with separate plan + calculation PDFs.

**UI route**: `/admin/prompt-lab` — **single Dossiers hub** (geen tabs meer). Toolbar bovenaan: "Batch test" (`StartRunButton`) + "Ground truth extractie" (`ExtractGroundTruthButton`, bulk alle zonder GT). Dossiers-tabel toont per rij: Plan/Calc-status, **Ground truth (CED)** kolom (expert-prijs + ✓, of per-rij "Extract GT"-knop wanneer calc aanwezig & geen GT), en **Kost Δ vs CED** (eindbegroting-afwijking %, kleur-gecodeerd: groen ≤10%, amber ≤20%, rood erboven). Filters: All/Ready/Tested/Untested/Errors. Runs-historiek + GT-lijst verwijderd uit UI (data blijft in DB; run-detail pagina `/[runId]` bestaat nog).
**Tables**: `benchmark_ground_truth`, `evaluation_runs`, `evaluation_results`, `benchmark_annotations`
**Dossier storage**: Each dossier has separate `plan_storage_path` (sent to LLM) and `calculation_storage_path` (used for GT extraction only)

**Flow**: Upload split dossiers (plan + berekening) → Extract ground truth from calculation PDFs → Create run → For each dossier: init estimation → fire pipeline (plan only) → poll until done → record (compare with expert) → finalize (aggregate metrics)

**Metrics tracked per dossier**: Cat1/Cat2/Cat3 SQM error %, cost error %, F delta, predicted vs expert cost
**Aggregate metrics**: Cost MAE, cost median, worst case, within 10%/15%, F MAE
**Annotations**: Per-dossier notes with categories (vision_limit, prompt_issue, classifier_error, scale_error, room_missing, etc.)

**Client-side runner** (`start-run-button.tsx`) processes dossiers sequentially. Stuck detection marks estimations >6 min as Vercel-killed.
**Dossier detail** (`/admin/prompt-lab/dossier/[id]`): **Pipeline walkthrough** (`pipeline-walkthrough.tsx`) — 5 numbered steps (Plan→2 lenzen → SQM per-verdiep → QQP scores+F → eenheidsprijs per categorie → totale kost), elke stap met inline CED-vergelijking. Plus AI-analyse chat (`dossier-chat.tsx`) met "Analyseer dit dossier"-knop die de volledige data (SQM per-verdiep, QQP-scores, eenheidsprijzen, CED-delta's) ziet en een gestructureerd rapport geeft (wat goed/fout, prompt-aanbevelingen, vragen). Cross-run comparison + annotation system.
**Shared helpers**: `src/lib/prompt-lab/compare.ts` (status/kleur/eenheidsprijs), `src/components/prompt-lab/status-icon.tsx`, `src/components/prompt-lab/extraction-details.tsx` (per-verdiep tabel). Eenheidsprijzen per categorie afgeleid uit F via `interpolatePrice`; expert-F via `backcalculateF` (al opgeslagen als `expert_f`).

## Known Issues & Constraints

1. **Vercel Pro 300s function limit** — Solved by Railway worker queue. Worker processes dossiers in ~50s without timeout.
2. **Browser tab sleep kills benchmark runner** — The client-side for-loop stops when Chrome throttles background tabs. The runner must stay in the foreground.
3. **SQM v9 prompt plateau** — 18/24 perfect on test set, remaining errors are Claude vision model limitations (can't read small text, misidentifies room boundaries).
4. **Next.js 14 fetch caching** — `dynamic = "force-dynamic"` does NOT prevent Supabase client fetch caching. All polling API routes MUST also export `fetchCache = "force-no-store"`. Without this, poll endpoints return stale data from the first request.
5. **Split dossier plan quality** — Many SPLIT_V2 "Plannen.pdf" files contain only cadastral/location maps, not architectural floor plans. SQM extraction correctly returns 0 for these. Need to verify split quality before running full benchmark.

## Conventions

- **Language**: English for code and docs. UI supports NL/FR labels from Belgian plans.
- **Components**: shadcn/ui. Install via `npx shadcn-ui@latest add [component]`
- **DB access**: `createSupabaseAdminClient()` (service_role, bypasses RLS) for API routes. `createSupabaseServerClient()` (anon key + cookies) for user-facing server components.
- **Environment**: Vercel env vars pulled via `vercel env pull`. Supabase keys are NOT in `.env.local` — they're in Vercel.
- **Migrations**: SQL files in `supabase/migrations/`. Applied via Supabase MCP tool (`apply_migration`) or manually via Supabase dashboard SQL editor (CLI not linked).
- **SKIP_AUTH**: `middleware.ts` checks `SKIP_AUTH` env var to bypass auth in development.

## Multi-Tenant & Customer Portal

- **Auth**: Supabase Auth with magic link. `getSessionWithRole()` helper routes admin vs customer users.
- **Admin sidebar**: Dossiers, QQP, Prompts, Settings, Prompt Lab, Leads, Tenants, Billing, Roadmap
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
- `sendBetaWelcomeEmail(email, company)` — welcome email sent on `beta_signup` intent; HTML template with "What happens next" section
- `sendAdminAlert(lead, extra?)` — fire-and-forget text-only alert to `ADMIN_ALERT_EMAIL`; skipped silently if env vars unset; subject varies by intent
- **Email provider: Postmark** (`postmark` npm package, `ServerClient`)
  - Env vars: `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM` (default `"PlanBase <noreply@planbased.xyz>"`), `POSTMARK_MESSAGE_STREAM` (default `"outbound"`), `ADMIN_ALERT_EMAIL`
  - Migrated from Resend 2026-05-25 — Postmark isolates per-project via Servers, no cross-project bleed
  - Auth emails (magic link, tenant invite) still use Supabase Auth built-in email — configure SMTP in Supabase dashboard if needed

## Landing Page Beta Signup (CTA)

- `src/components/landing/CTA.tsx` — controlled form: `company` (required), `email` (required), `volume` (optional select), `region` (optional select)
- POSTs to `/api/public/leads` with `intent: "beta_signup"`, `volume`, `region`
- `leads` table columns: `email`, `company`, `role`, `intent`, `volume`, `region`, `estimation_id`, `ip_address`, `user_agent`, `email_sent`, `email_error`, ...
- On success: `sendBetaWelcomeEmail` to lead + `sendAdminAlert` fire-and-forget
- Admin leads table (`/admin/leads`) shows `intent` badge (colour-coded), `volume`, `region` columns + CSV export includes them

## Supabase Details

- **Project ref**: `sqmpgzzjxsmywmpsplmu`
- **Region**: eu-west-1
- **URL**: `https://sqmpgzzjxsmywmpsplmu.supabase.co`
- **Storage bucket**: `plans` (private, 50 MB limit, PDF/PNG/JPG)
- **Key tables**: `estimations`, `reference_dossiers`, `benchmark_ground_truth`, `evaluation_runs`, `evaluation_results`, `prompt_versions`, `qqp_model_versions`, `postcode_prices`, `abex_index`, `users`, `tenants`, `leads`, `tenant_usage_monthly`, `roadmap_items`

## Current Status (2026-05-28)

### Working
- [x] Full end-to-end estimation pipeline (upload → SQM → QQP → cost)
- [x] Public estimation page at planbased.xyz
- [x] 633 reference dossiers uploaded, 15 with expert ground truth extracted
- [x] Prompt Lab (formerly Benchmark) with admin UI for run management + per-dossier results + annotations
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

### Benchmark Results

**First run (21 May):** 35 dossiers, 19 processed (16 skipped — browser sleep). 1 success: Cat1 SQM 0.0% error, cost +38.6%. Rest: Vercel 300s timeout on VerzamelPDFs.

**Second run (28 May — 15 dossiers with GT, large plan files):** Running. Early results: Cat1 extraction is accurate when real floor plans are present (e.g., -3.4% error for 870 m² building). ~56% of SPLIT_V2 plan files are cadastral maps (100-500KB), producing 0 m². Only plans >2MB consistently have architectural floor plans (132 out of 609).

### Plan file quality (SPLIT_V2)
| Size range | Count | Likely content |
|------------|-------|----------------|
| < 100KB | 7 | Cadastral only |
| 100KB - 500KB | 344 | Probably cadastral |
| 500KB - 2MB | 126 | May have plans |
| 2MB - 10MB | 86 | Likely has floor plans |
| > 10MB | 46 | Definitely has floor plans |

### Next Steps
- [x] Railway worker built and tested locally
- [x] Fix Next.js fetchCache bug (commit 8bec1e5)
- [x] Fix stuck detection (commit dea71b2)
- [x] LLM vs Expert comparison card (`llm-vs-expert-card.tsx`) with extraction detail view (commit f59fe27, f266195)
- [x] GT extraction for 10 new dossiers (total: 15 with ground truth)
- [x] Mini benchmark run to verify comparison card end-to-end
- [ ] **Push pending commits** — `git push origin main` (3 commits: comparison card + extraction detail + CLAUDE.md)
- [ ] Deploy worker to Railway (see deployment instructions below)
- [ ] Extract GT for remaining ~120 dossiers with large plan files
- [ ] Full benchmark run on all GT dossiers
- [ ] Investigate cost error source: regional factor, ABEX correction, QQP weight calibration
- [ ] Improve per-building comparison (needs per-building expert data from calculation PDFs)

---

## Railway Worker (added 2026-05-24)

- **Purpose:** Runs the estimation pipeline without Vercel's 300s timeout
- **Queue table:** `processing_queue` in Supabase (migration: `supabase/migrations/20260524_processing_queue.sql`)
- **Feature flag:** `USE_QUEUE` env var on Vercel (`true`/`false`, default `false`)
- **How it works:** `estimate-process` route inserts into queue when `USE_QUEUE=true`; worker polls every 2s and calls the shared pipeline
- **Concurrency:** 1 reserved estimate slot + 2 background slots (`WORKER_ESTIMATE_SLOTS`, `WORKER_BACKGROUND_SLOTS` env vars)
- **Shared code:** `src/lib/pipeline/run-estimation.ts` — single source of truth; worker imports via `../../src/lib/pipeline/run-estimation.js`
- **Env var bridge:** Worker sets `NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL` before imports, because shared code (logApiCall, getPromptSettings) creates its own Supabase client
- **Benchmark:** Always queued (`job_type: 'benchmark'`, priority 10) — no feature flag needed
- **Rollback:** Set `USE_QUEUE=false` on Vercel → redeploy (30s) → old direct flow restored
- **Monitoring:** Railway logs for worker activity; `processing_queue` table in Supabase for job status

### Railway Deployment

**IMPORTANT:** The Docker build context must be the **repo root**, not `worker/`.

In Railway project settings:
- **Root Directory:** `/` (blank / repo root)
- **Dockerfile Path:** `worker/Dockerfile`
- **Watch Paths:** `worker/**`, `src/lib/pipeline/**`, `src/lib/ai/**`, `src/lib/supabase/**`

**Environment variables to set in Railway:**
- `SUPABASE_URL` = `https://sqmpgzzjxsmywmpsplmu.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = (from Supabase dashboard)
- `ANTHROPIC_API_KEY` = (Anthropic console)
- `WORKER_ESTIMATE_SLOTS` = `1` (default)
- `WORKER_BACKGROUND_SLOTS` = `2` (default)
- `POLL_INTERVAL_MS` = `2000` (default)
