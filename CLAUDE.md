# CLAUDE.md — BuildCost MVP

> **This file is the shared context for all Claude Code sessions on this project.**
> **Update the "Current Status" section every time you finish a milestone.**

---

## What This Is

BuildCost is a web tool for Belgian building insurance companies to estimate reconstruction costs after sinister (fire, flood, etc.) based ONLY on an uploaded building plan. The system extracts surface areas, discovers "finishing level" parameters (QQPs), and calculates a precise rebuild cost per m².

**This is NOT real estate valuation.** It's construction rebuild cost. A luxury apartment costs the same to rebuild whether it's in an expensive or cheap neighborhood. Regional variation is handled separately via a postcode coefficient.

## Core Formula (V2)

Three area categories, each with a price that interpolates linearly between Min and Max as F varies:

```
CAT_price(F) = CAT_min + (F − 0.70) / (1.50 − 0.70) × (CAT_max − CAT_min)

Subtotal   = CAT1_sqm × CAT1_price(F)
           + CAT2_sqm × CAT2_price(F)
           + CAT3_sqm × CAT3_price(F)

Total Cost = Subtotal × Regional Factor × ABEX Factor
```

| Category | Rooms | Default Min | Default Max |
|----------|-------|-------------|-------------|
| **CAT1** — Livable | living, bedroom, kitchen, bathroom, office… | €1 100/m² | €1 900/m² |
| **CAT2** — Enclosed non-livable | garage, storage, utility | €550/m² | €950/m² |
| **CAT3** — Outdoor built | terrace, balcony | €330/m² | €570/m² |
| EXCLUDED | garden | — | — |

- **F (Finishing Coefficient)**: 0.70–1.50, derived from QQPs. Labels: Basic / Standard / Comfort / Comfort+ / Luxury
- **Regional Factor**: `postcode_base_price / cat1_price_at_F1.0`
- **ABEX Factor**: construction price index ÷ 1000 (provided file)
- **Cat prices** are configurable in Settings and auto-calibrated from reference dossiers via OLS

## Team & Workstreams

| Person | Workstream | Scope |
|--------|-----------|-------|
| **Tiemen** | **WS1: SQM Engine** | Plan upload → precise room-by-room m² extraction. Scale detection, multi-floor, multi-format. Also: landing page, upload flow UI, SQM results display, mobile responsive. |
| **Georges** | **WS2: AI Pipeline** | QQP discovery, finishing level calculation, cost estimation, self-learning from 1000+ reference dossiers. Also: auth, admin UI, results page, dashboard. |

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind + shadcn/ui → **Vercel**
- **Backend**: Next.js API routes (same repo)
- **Database**: **Supabase** (Postgres + Auth + Storage + RLS)
- **AI**: Claude API (Sonnet 4 for vision extraction)
- **Source control**: **GitHub** (monorepo)
- **Deployment**: **Vercel** (frontend + API) / **Railway** (if needed for heavy processing)

## Project Structure

```
/buildcost
├── CLAUDE.md                  ← YOU ARE HERE
├── docs/
│   ├── PRD.md                 ← Full product requirements
│   ├── EXECUTION_PLAN.md      ← 48h timeline with assignments
│   ├── SQM_CONTRACT.md        ← JSON interface between WS1 & WS2
│   ├── QQP_SEED_LIST.md       ← Initial QQP definitions
│   ├── DATABASE_SCHEMA.sql    ← Supabase migration
│   └── ARCHITECTURE.md        ← System design decisions
├── prompts/
│   ├── sqm_extraction.md      ← Prompt for plan → room extraction
│   └── qqp_extraction.md      ← Prompt for plan data → QQP values
├── src/                       ← Next.js application
│   ├── app/                   ← App Router pages
│   ├── components/            ← Shared UI components
│   ├── lib/                   ← Utilities, DB client, AI client
│   └── api/                   ← API routes
├── supabase/
│   └── migrations/            ← Database migrations
└── public/                    ← Static assets
```

## Key Architecture Decisions

1. **Monorepo**: Single Next.js app handles frontend + API. Faster for hackathon.
2. **Claude Vision (Sonnet 4)**: Primary AI for plan extraction. Fast and accurate enough.
3. **Scale detection chain**: Scale bar → dimension text → door-width calibration (80cm) → user input fallback.
4. **QQP self-learning**: Seed 25+ expert QQPs, extract from reference dossiers, correlate with known prices, adjust weights, discover new QQPs.
5. **Finishing levels**: Continuous coefficient (0.70–1.50) mapped to categories: Basic / Standard / Comfort / Luxury / Premium.
6. **Auth**: Supabase Auth with magic link (low friction for PLG).
7. **Multi-tenant**: Each insurance company is a tenant. RLS on all tables.

## Integration Contract

**The SQM output JSON is the critical interface between WS1 and WS2.**
See `docs/SQM_CONTRACT.md` for the full spec. Key fields:
- `floors[].rooms[].area_sqm` — room areas
- `floors[].rooms[].category` — room type classification
- `floors[].rooms[].features` — detected features (for QQP extraction)
- `summary.total_livable_sqm` — primary area for cost calculation

## Conventions

- **Branch strategy**: `main` (protected), `ws1/feature-name` (Tiemen), `ws2/feature-name` (Georges)
- **API routes**: `/api/extract-sqm`, `/api/analyze-qqp`, `/api/estimate-cost`, `/api/train-qqp`, `/api/upload-plan`
- **Environment variables**: All in `.env.local`, prefixed: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`
- **File uploads**: Supabase Storage bucket `plans` (public read for authenticated users)
- **Language**: English for code and docs, UI supports NL/FR labels from plans
- **Components**: Use shadcn/ui. Install as needed via `npx shadcn-ui@latest add [component]`

## Current Status

> **Update this section after every significant milestone!**

- [x] Repository created
- [x] Supabase project created (`sqmpgzzjxsmywmpsplmu`, eu-west-1)
- [ ] Vercel project connected
- [x] Database schema migrated
- [ ] WS1: First plan extraction working
- [x] WS2: QQP definitions seeded (32 definitions across 4 categories)
- [ ] WS2: First reference dossier processed
- [x] Integration: end-to-end estimation flow working (`/estimate`)
- [ ] Landing page live
- [ ] Demo ready

**Additional progress (WS2):**
- Analytics dashboard built (`/analytics`):
  - 5-section server-rendered page: Overview · Training Progress · QQP Discovery · System Health · Recent Activity
  - `api_call_log` table migrated; every Claude API call in process-dossier and estimate routes is now logged (call type, model, tokens, duration)
  - Learning curve chart (recharts) shows MAE/R² over model versions
  - Auto-refresh every 30s when jobs are in flight; manual Refresh button
  - Activity feed merges dossiers, estimations, discovery log, model versions, API errors → sorted by time
- ABEX index seeded (10 entries) and regional postcode coefficients imported
- Auth (magic link) + tenant auto-provisioning built and deployed
- Admin dossier upload page built (`/admin/dossiers`): drag-drop plan upload to Storage, full metadata form, reference dossier list with status tracking
- Storage bucket `plans` created (private, 50 MB limit, PDF/PNG/JPG)
- Full PDF processing pipeline: classify pages → extract metadata → SQM → QQP → prediction_error
- Apartment building detection, duplicate prevention, per-row delete, Delete All
- QQP self-learning loop built (`ws2/qqp-learning-loop`):
  - `src/lib/qqp/discovery-engine.ts` — auto-activates proposed QQPs at threshold
  - `src/lib/qqp/retroactive-extraction.ts` — extracts new QQP values from stored sqm_extraction
  - `src/lib/qqp/weight-calibration.ts` — Pearson correlation weights, model version snapshots, re-evaluation
  - `/admin/qqp` — QQP management page (active QQPs + weight bars, proposed review, model versions)
  - Wired into process-dossier pipeline (auto-evaluate + auto-calibrate at interval)
- End-user estimation flow built (`ws2/new-estimation`):
  - `/estimate` — 3-phase page: Upload (drag-drop + postcode live-lookup) → Processing (animated steps polling) → Results
  - `src/app/actions/upload-plan.ts` — uploads plan file to Storage (tenant-scoped, no dossier duplicate check)
  - `src/app/actions/create-estimation.ts` — creates estimation row in DB
  - `src/app/actions/lookup-postcode.ts` — postcode → region + base price lookup
  - `src/lib/qqp/model-prediction.ts` — applies trained model weights for finishing coefficient
  - `/api/estimate` — full pipeline (SQM extraction → QQP → model weights → cost calc)
  - `/api/estimate-status/[id]` — status polling endpoint
  - `src/components/estimate/results-view.tsx` — hero cost, cost breakdown, finishing meter, expandable room/QQP tables

## Supabase Details

- **Project ID**: `[FILL IN AFTER CREATION]`
- **URL**: `[FILL IN]`
- **Anon Key**: in `.env.local`
- **Service Role Key**: in `.env.local` (server-side only!)
- **Storage bucket**: `plans`

## Important Context

- We have 1000+ unstructured reference dossiers (plan + address + expert notes + price/m²)
- QQPs are NOT predefined — the system must discover and weight them from data
- Belgian plan conventions: room labels in NL or FR, dimensions in meters, scale varies
- ABEX index updates semi-annually
- Postcode price table is a provided CSV/file
- "Ingebouwde toestellen" = built-in appliances (dishwasher, oven, etc.) — a key QQP
