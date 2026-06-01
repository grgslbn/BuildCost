# CLAUDE.md — PlanBase (planbased.xyz)

> **Last updated: 2026-06-01** (SQM ROUTER v2 + consolidated learnings — see "SQM — operational learnings". Core: vision READS printed numbers reliably, CANNOT MEASURE dimensions reliably. Tier1 area_table (niveau-aware, n=14 median 0%); Tier2 labeled_plan TILED per-page + BO/NO (Die Prince −0%) + net→gross ×1.12 for room areas (HOOST 547563 −11%→~0%); Tier3 dims/scanned → unreliable (6 variants, −49%..+291%) → manual m² confirmation. JPEG routed+tiled. Tests: HOOST −11%, Prestige 550471 dims-only→manual. Prior: Connect Value F model, intercept 1.2824, cat2/3 decoupled)

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
CAT1_price(F) = CAT1_min + (F − 0.70) / 0.80 × (CAT1_max − CAT1_min)   ← only CAT1 scales with F
CAT2_price = CAT2_min  (fixed)   CAT3_price = CAT3_min  (fixed)         ← decoupled, see below

Total Cost = (CAT1_sqm × CAT1_price + CAT2_sqm × CAT2_price + CAT3_sqm × CAT3_price)
           × Regional Factor × ABEX Factor
```

| Category | Rooms | Live Min | Live Max |
|----------|-------|----------|----------|
| **CAT1** — Livable | living, bedroom, kitchen, bathroom, office | €1 600/m² | €2 900/m² |
| **CAT2** — Enclosed non-livable | garage, storage, utility | €900/m² | €1 500/m² |
| **CAT3** — Outdoor built | terrace, balcony | €500/m² | €900/m² |
| EXCLUDED | garden | — | — |

- **CAT2/CAT3 decoupled from F**: `DECOUPLE_CAT2_CAT3=true` in `calculate-cost.ts` — garage/storage/terrace use a fixed rate (`CAT2_DECOUPLED_BASIS=1200`, `CAT3_DECOUPLED_BASIS=700`, clamped to settings [min,max]); only CAT1 (living) scales with F. A luxury apartment does not make its garage more expensive. **MAE-optimized on the apartment benchmark** (bench-selectie.json, 2026-05-31): cat2 median €1227 → optimal €1200; cat3 median €750 → optimal €700. Result: m²-subtotal median error **4.8% → 2.6%** (was min €900/€500 = under-priced; overview P50 €1100/€900 → 2.9%). `backcalculateF` mirrors this.
- **F (Finishing Coefficient)**: 0.70–1.50. Live model `connect-v1` (qqp_model_versions **v102**): **intercept 1.0274 + Connect-Value-derived weights** (NOT ridge regression — see "F Model" section). **De-biased 2026-06-01**: intercept lowered 1.2824→1.0274 (−0.255) to center the F-median on the CED-median 1.04 (€2150), removing the systematic +0.255 / +19% overshoot (live F-median was 1.295). Weights unchanged from v101; rollback = reactivate v101.
- **Regional Factor**: `postcode_base_price / cat1_price_at_F1.0` (regional-coefficients.ts, 0.92–1.0). Connect Value confirms postcode should NOT be double-counted.
- **ABEX Factor**: `index / 1056` (ref 2026S1=1056). For new estimates factor = 1.0; older dossiers scale down. CAT prices are at the current-ABEX level.
- **Cat prices** are configurable in Settings (system_settings).

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
| `/api/estimate/[id]/correct-sqm` | **Manual SQM confirmation** — recompute cost from user-entered cat1/2/3 m² (shown when `sqm_confidence<0.65`, i.e. bare/dimension-only plans vision can't measure) |
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
Upload PDF → classify pages → render PNG → SQM ROUTER (per-dossier best signal)
→ QQP extraction (Claude) → F calculation (ridge regression weights)
→ cost calculation → store result
```

- **SQM ROUTER** (2026-06-01, wired in `run-estimation.ts` → also live in the Railway worker via shared pipeline): input is heterogeneous (PDF or **JPEG**, with/without an area table, with/without printed m² labels), so the pipeline picks the **best available signal per dossier** and is honest about confidence. Tiers, highest-reliability first:
  - **Tier 1 — `area_table` (route A, ~exact).** `extractAreaTableViaVision()` is ALWAYS attempted on a PDF: it finds the berekening/oppervlaktestaat/meetstaat page via header markers (`Berekening`, `Opp/inhoud`, `meetstaat` — extractable even when the table VALUES are a non-extractable font), renders up to 6 marker pages, and reads them with VISION. The model returns a **per-row category using the niveau column** (so "Onder het gebouw" on a *Parkeerkelder* niveau → cat2, not cat1); `classifyAreaRow(omschrijving+niveau)` is the fallback. **Backtest (n=14 CED): median 0%, 13/14 within 10%, 14/14 within 15%** vs niveau-aware GT. `sqm_confidence` ≥0.9. (Vision detection lifts coverage far beyond the old text-only detector — 7/37; and the per-row categorisation fixed a bug where parking/kelder/atelier were counted as heated cat1, which also affects `scripts/sqm-groundtruth.json`.)
  - **Tier 2 — `labeled_plan` (printed m² labels, tiled, per-page).** When no table: the floor-plan pages are rendered and **split into a 3×3 grid of overlapping tiles** (`renderPlanTilesToBase64`) — the Anthropic API downsamples every image to ~1568px, so tiling is what keeps small printed labels legible. Each floor page is extracted separately and **summed** (`aggregateVisionSqm`); a **BO/NO anti-double-count rule** prevents adding a unit's gross total AND its interior rooms. **Automatic net→gross factor**: the model reports `cat1_basis` (`unit_gross` BO = already gross → ×1.0; `room_net` NO = net room sum → ×1.12; `mixed` → ×1.06) applied per page. Validated: Die Prince (unit_gross) **−0%**; HOOST 547563 (room_net, 33-sheet A0, 14 floors) **−11% → −0.6% after ×1.12**. Medium confidence (≤0.6) — accurate for clean residential, weaker for mixed-use (commercial/parking on other sheets). `extractSqmViaVision()` + `vision-extract.ts` (`NET_TO_GROSS`).
  - **Tier 3 — `bare_plan` (measured).** Only dimension lines / no printed areas → the v9 measurement + **confidence-gating** (`sqm-confidence.ts`) flags physically-implausible extractions. ~38% (vision limit), LOW confidence, honestly flagged for manual review.
  - **JPEG/PNG uploads** now route through the same universal extractor (`planImagesB64` is captured for image uploads too) — previously they bypassed the router entirely.
  - Files: `src/lib/sqm/vision-extract.ts` (universal classify+extract + `aggregateVisionSqm`), `extract-area-table.ts`, `sqm-router.ts`, `sqm-confidence.ts`, `render-plans.ts` (`renderPlanTilesToBase64`, `getPdfText`, `renderSpecificPagesToBase64`). Tests 27/27, tsc clean. See `docs/sqm-golive-strategy.md` + `docs/benchmark-2026-05-31.md`.
  - **Honest limit**: a structured table → exact; clean residential labeled plans → ~±10% (tiled, per-page); mixed-use labeled → ±15–30%; bare/dimension-only plans → unreliable, flagged. Aggregating labels is noisier than reading a table, so **the table is the only exact source** — and **manual m² confirmation** (`/api/estimate/[id]/correct-sqm` + `SqmCorrectionPanel`, shown when `sqm_confidence<0.65`) covers the rest.

### SQM — operational learnings (backtested, what works & what doesn't)

**Core truth: vision can READ printed numbers reliably, but CANNOT MEASURE pixels/dimensions reliably.** Everything follows from this.

**Decision tree (per dossier):**
1. Area table present (berekening/oppervlaktestaat/meetstaat, in PDF text OR vision-detected) → **read the table** (Tier 1). Niveau-aware per-row cat. ~exact.
2. Else plan has printed m² → **tile floor pages 3×3, read per floor, sum** (Tier 2). Prefer unit **BO** totals (already gross). If only **room (NO)** areas → net → apply ~**1.12 net→gross** factor. BO/NO anti-double-count is critical.
3. Else only dimensions / scanned with no printed numbers → **measurement is unreliable → flag low confidence → manual m² confirmation.**

**Per input type (MEASURED on real dossiers):**
| input | accuracy | examples |
|---|---|---|
| area table | ~exact | 519406 +1%, 537092 −8%; n=14 median 0%, 14/14 ≤15% |
| unit BO labels (tiled) | −0 to −8% | Die Prince 542077 −0%, 546287 −8% |
| room NET areas (tiled) | −11% → **−0.6%** (auto ×1.12 net→gross) | HOOST 547563 (33-sheet A0, no table, 14 floors) |
| dimensions only | UNRELIABLE −49%..+291% | 542042 retail, 550471 Prestige (scanned) |

**Dimension measurement is a proven dead end** — 6 variants tested (outer-chain w×d; +code-does-math; +tiling; +floor-enumeration; per-room sum; ensemble+sanity+consistency). The model cannot consistently pick which numbers are the building envelope: *same floor read 48 vs 2054 m²; same building 482 vs 198 m²*. The error is **number-association + spatial reconstruction, NOT arithmetic** — so decomposing it (model reads, code computes) does NOT fix it. Vector extraction (mupdf paths → real wall geometry) = a mini-CAD-interpreter, days of work, not pursued. **DO NOT wire dimension measurement as a primary SQM source — it degrades accuracy.**

**Gotchas:**
- **Anthropic downsamples every image to ~1568px** → small labels/dims on an A0/A1 sheet vanish. **Tiling (3×3 per page) is mandatory** to read labels on large sheets. Corollary: sending images >1568px is wasted bytes — `apiSafeBase64`/`apiSafeImage` cap every SQM-call image to ≤1568px (lossless) + a 26MB total-payload budget, which fixes **413 `request_too_large`** on big multi-page A0/A1 plans (12 sheets @ 5000px exceeded ~32MB; found via live pipeline on 23-499974).
- **Page selection is a top bottleneck**: bundles mix notarial deeds / CED reports / sections / elevations / floor plans. Feeding the wrong pages = 0 or garbage. Floor plans with labels usually sit deeper (e.g. pages 3–7), not page 0–2.
- **Multi-floor buildings = one sheet per floor** → must enumerate every floor + sum (per-page aggregation).
- **Duplicate floor sheets** (same plan bound twice, or NL+FR versions — e.g. 23-499974: 10 sheets = 5 unique floors) → `aggregateVisionSqm` dedups by `floor_label` (block letters survive normalisation, so "Gelijkvloers A" ≠ "Gelijkvloers B"; only true duplicates collapse). Without this the labeled route DOUBLES the area.
- **net→gross factor is CONDITIONAL on whether circulation was captured** (determined deterministically from the cat1 rows, NOT the model's self-label which proved unreliable): `gross`/BO → ×1.0; net-family AND cat1 rows include circulation (gang/hal/traphal/gaanderij/sas) → ×1.12 (walls only); net-family with ONLY dwelling-unit totals (no circulation rows) → **×1.35** (walls + circulation + common). Validated against expert GT: 23-499974 unit-only 1106 ×1.35 = **1493 = expert exactly**; HOOST (rooms incl. gaanderij/traphal) → ×1.12. `NET_TO_GROSS_UNIT=1.35` in `vision-extract.ts`.
- **GT caveat**: `scripts/sqm-groundtruth.json` `heated_m2` over-counts on some dossiers (parking/kelder/atelier counted as cat1: 516605, 540184, 546287). The niveau-aware vision categorisation is more cost-correct; back-tests should compare against a niveau-aware corrected GT.
- **Scanned/image PDFs** (e.g. 550471): `pdftotext` finds nothing → classify pages + extract via VISION only.
- **Stated-total cross-check** (`computeSqmConfidence` `statedTotalSqm`): when the plan/table prints a TOTAL floor area, the summed extraction is checked against it — a big shortfall (<70%) = incomplete capture → downgrade + flag (catches the mixed-use Tier-2 weakness, e.g. 546287 −8%); an agreeing total (90–115%) lets a labeled extraction skip the manual panel (verified-complete). Conservative: only penalises shortfall/over-count, never inflates blindly.
- Backtest harness: `scripts/backtest-router.mjs`; per-method experiments: `scripts/sqm-*.mjs`, `scripts/measure-*.mjs`.

- **SQM measurement (bare_plan tier)**: Claude Sonnet with extended thinking (10K budget). Processes rendered plan pages to identify rooms and calculate areas. v9 prompt: 18/24 perfect on test set.
- **QQP Extraction**: Claude extracts finishing parameters from plan annotations (windows, doors, kitchen, bathroom, heating type, etc.)
- **F Calculation**: `connect-v1` linear model (qqp_model_versions **v102**). `F = intercept(1.0274) + Σ(weight_i × qqp_score_i)`, clamped [0.70,1.50]. Weights **Connect-Value-derived** (not ridge); intercept de-biased from 1.2824 (see "F Model" section). The model version is read from the DB at runtime — changing the active version takes effect immediately, no deploy.
- **Prompt Versioning**: `prompt_versions` table stores versioned SQM/QQP prompts. Active version used by pipeline. Managed via `/admin/prompts`.

## F Model & Connect Value Calibration (2026-05-30)

**Connect Value source decoded.** The Excel files behind the Connect Value tool (`M²Value/connect value/Excel achter connect Value/`) reveal the exact model: `€/m² = Σ(component coefficients)` per category at **ABEX 1000, excl btw, no postcode factor**. Apartment woon = **€1402 base** (gesloten ruwbouw 795 + afwerking 362 + elektrisch 91 + inrichting 86 + sanitair 68) + a yes/no finishing checklist up to **+€571** (cv +98, vloer/natuursteen +72, keuken inbouw +72, keuken>5 +72, inbouwkasten +72, vloerverw +48, airco +36, >1 toilet +36, bad+douche +36, domotica +29) → €1402–1973 excl = €1697–2387 incl. Garage €850–1200, terras €280–560, handelsgelijkvloers €973 — all finish-independent. **Authors' own note: Connect runs 15–20% too high for standard buildings** (per-m² finishing should be forfaitair). Helper scripts: `scripts/cv-*.py`, `scripts/connect-*.mjs`.

**F model = Connect weights + apartment-centered intercept.** `scripts/build-connect-f-model.mjs` maps each Connect €/m² premium → ΔF and writes the model. The QQP→F weights are expert-sourced (not regressed). Intercept **1.2824** is an apartment-centering constant: the QQP extraction scores apartments systematically negative (~−0.32 mean), so centering = `0.96 − Σw·mean`. F=0.96 ≈ €2000 (lean standard). Validated on 207 CED dossiers (`scripts/test-price-level.mjs`): model band [€1600–2900] covers 83%, required-F median 1.04 (€2150). On 15 GT dossiers (`scripts/test-connect-f.mjs`): all median +19.2%, cat1-dominant +6.8%.

**DE-BIASED 2026-06-01 → v102 (intercept 1.0274).** The +19% overshoot was confirmed live: the model's F-median across 183 estimations was **1.295** (apartments 1.339) vs the CED-correct 1.04. So the intercept was lowered uniformly by **0.255** (1.2824→1.0274), centering the F-median on CED's 1.04 (€2150). Effect: every F drops 0.255 (e.g. 23-499974 1.127→0.872, €/m² €2294→€1880 vs expert €1975 = −5%, was +16%). Calibrated/applied via `scripts/calibrate-intercept.mjs` + `f-current.mjs` (service-role; the MCP is read-denied). v101 weights unchanged; rollback = reactivate v101. (`evaluation_results` predicted/expert_f is STALE — old runs — don't calibrate on it.)

**KNOWN ISSUE — QQP extraction bias (root cause of the centering hack).** The live QQP prompt (prompt_versions v1) explicitly tells Claude "absence of features → negative" + uses a "villa" anchor, so apartments score systematically negative. A **fixed apartment-anchored, absence-neutral prompt is STAGED as inactive v2** (`adaba4f4`, via `scripts/stage-qqp-prompt-v2.mjs`). Validated (`scripts/validate-prompt-fix.mjs` + `scripts/reextract-images.mjs`): de-biases (score-mean −0.23→+0.06) and preserves discrimination WITH plan images (sd 0.156; text-only collapses to ~0 — **QQP discrimination needs the images, not the SQM text**). NOT activated: crude offline re-extraction (3-page render) can't prove it beats the current live model. **To activate v2:** (1) set v2 active, (2) re-anchor `reference-ranges.ts` numeric guides to apartment norms, (3) re-extract dossiers via the real pipeline, (4) reset intercept to lean ~0.93 (€2000) or CED-match ~1.007 (€2150).

**Note:** ABEX divisor 1056 is hardcoded in `run-estimation.ts:597` while the reference comes from `system_settings` — keep in sync if the reference semester changes.

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

### F-model / pricing work (2026-05-30) — see "F Model & Connect Value Calibration"
- [x] Decoded Connect Value source model (Excel) — exact woon/niet/terras rates + finishing checklist
- [x] Built `connect-v1` F model (Connect-derived weights), replaced broken ridge model
- [x] Apartment-centered intercept 1.2824 (fixes systematic negative QQP-score bias)
- [x] Decoupled cat2/cat3 from F (`DECOUPLE_CAT2_CAT3`) — fixes garage-heavy over-prediction
- [x] Validated on 207 CED dossiers (band covers 83%, required-F median 1.04) + 15 GT (all +19.2%, cat1-dom +6.8%)
- [x] Diagnosed QQP-prompt bias ("absence→negative" + villa anchor) + staged fixed apartment prompt as inactive v2
- [ ] **Activate prompt v2** (needs: re-anchor reference-ranges guides + pipeline re-extraction + intercept reset to ~0.93 lean or ~1.007 CED-match)
- [ ] Re-extract the 5 suspect-GT dossiers (expert €/m² >€3000 = under-counted SQM): 525671, 528000, 538282, 553088, 544390
- [ ] Decide lean (€2000) vs CED-match (€2150) standard pricing
- **cat1_max stays €2900** (user decision 2026-05-30) — the 13% of CED dossiers above €2900 are the high-end tail; the cap is intentional, do NOT raise it.

### Earlier next steps (still open)
- [ ] Deploy worker to Railway (see deployment instructions below)
- [ ] Extract GT for remaining ~120 dossiers with large plan files
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
