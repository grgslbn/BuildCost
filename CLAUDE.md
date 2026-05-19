# CLAUDE.md — BuildCost MVP

> **This file is the shared context for all Claude Code sessions on this project.**
> **Update the "Current Status" section every time you finish a milestone.**

---

## What This Is

BuildCost is a web tool for Belgian building insurance companies to estimate reconstruction costs after sinister (fire, flood, etc.) based ONLY on an uploaded building plan. The system extracts surface areas, discovers "finishing level" parameters (QQPs), and calculates a precise rebuild cost per m².

**This is NOT real estate valuation.** It's construction rebuild cost. A luxury apartment costs the same to rebuild whether it's in an expensive or cheap neighborhood. Regional variation is handled separately via a postcode coefficient.

## Core Formula

```
Rebuild Cost = Surface Area (m²) × Base Price/m² (postcode) × ABEX Index × Finishing Coefficient
```

- **Surface Area**: extracted from plan via AI vision (WS1)
- **Base Price/m²**: lookup by postcode (provided data)
- **ABEX Index**: construction price indexation (provided file)
- **Finishing Coefficient**: 0.70–1.50, derived from QQPs discovered by the system (WS2)

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

- [ ] Repository created
- [ ] Supabase project created
- [ ] Vercel project connected
- [ ] Database schema migrated
- [ ] WS1: First plan extraction working
- [ ] WS2: QQP definitions seeded
- [ ] WS2: First reference dossier processed
- [ ] Integration: end-to-end flow working
- [ ] Landing page live
- [ ] Demo ready

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
