# BuildCost MVP — Execution Plan

## Team Assignments

| Workstream | Owner | Scope |
|-----------|-------|-------|
| **WS1: SQM Engine** | **Tiemen** | Surface area extraction from building plans |
| **WS2: AI Pipeline** | **Georges** | QQP discovery, finishing levels, cost calculation |
| **WS3: Frontend & Infra** | **Split** | Each person builds UI for their own features |

## WS1: SQM ENGINE (Tiemen)

Mission: Given any plan (PDF, image, CAD), output precise room-by-room m² and total building m².

| Hours | Task | Type |
|-------|------|------|
| 0-2 | Setup (together) | Infra |
| 2-4 | Benchmark LLM vision APIs on 5 real plans | Core |
| 4-8 | Build extraction prompt v1 (rooms, dims, labels) | Core |
| 4-6 | Landing page | FE |
| 8-12 | Scale detection (bar, door-width, dimension text) | Core |
| 12-14 | Upload flow UI (drag & drop + postcode) | FE |
| 12-16 | Area calculation engine (irregular rooms, L-shapes) | Core |
| 16-20 | Multi-floor + multi-format (PDF pages, images) | Core |
| 20-22 | SQM results display (room table, floor summary) | FE |
| 20-24 | Validation: extracted m² vs known m² from refs | Core |
| 24-28 | /api/extract-sqm endpoint ready | Core |
| 28-30 | Mobile responsive pass | FE |
| 28-32 | Accuracy hardening (fix worst cases) | Core |
| 32-36 | Integration with main app | Integration |

## WS2: AI PIPELINE (Georges)

Mission: From extracted plan data, discover QQPs, determine finishing level, calculate rebuild cost.

| Hours | Task | Type |
|-------|------|------|
| 0-2 | Setup (together) | Infra |
| 2-6 | Seed QQPs + import postcode prices + ABEX index | Core |
| 6-8 | Supabase Auth + multi-tenant setup | FE |
| 6-10 | Reference dossier pipeline (upload + store) | Core |
| 10-14 | QQP extraction prompt (from plan data) | Core |
| 14-16 | Admin: reference dossier upload UI | FE |
| 14-18 | Correlation engine (QQP ↔ price analysis) | Core |
| 18-22 | Finishing coefficient model (0.7–1.5) | Core |
| 22-26 | Cost calculation endpoint (full formula) | Core |
| 26-28 | Results page + cost breakdown | FE |
| 26-30 | Self-learning loop (weight updates) | Core |
| 30-34 | Bulk dossier processing (50+ dossiers) | Core |
| 34-36 | Dashboard (history, accuracy, QQPs) | FE |
| 34-38 | Accuracy tuning vs known prices | Core |

## TOGETHER

| Hours | Task |
|-------|------|
| 0-2 | Foundation: repo, Supabase, Vercel, schema migration |
| 36-40 | End-to-end wiring |
| 40-44 | Bug fixes + polish |
| 44-48 | Demo prep |

## Critical Dependencies

1. Georges can start QQP work with MOCK SQM data while Tiemen automates extraction
2. The SQM output JSON contract (docs/SQM_CONTRACT.md) is the integration point
3. Georges needs ≥10 extracted reference dossiers by H20 for meaningful QQP weights
4. Frontend work is interleaved — each person builds UI for their own features
5. Finishing coefficient model (Georges H18-22) is the riskiest AI piece

## Success Criteria

- [ ] Upload plan → room-by-room m² (>80% accuracy)
- [ ] Building type auto-detected
- [ ] Finishing level from QQPs → coefficient
- [ ] Rebuild cost calculated and displayed
- [ ] 50+ reference dossiers processed
- [ ] Auth + multi-tenant + mobile-friendly
- [ ] Results exportable
