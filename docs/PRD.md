# BuildCost MVP — Product Requirements Document

> **Last updated: 2026-05-19**

---

## Problem

Belgian building insurance companies need to estimate reconstruction costs after sinister (fire, flood, etc.). Today this requires expensive on-site expert assessments. BuildCost automates this: upload a building plan → get a rebuild cost estimate.

## Target User

Belgian building insurance companies (adjusters, underwriters, claims processors).

## Core User Flow

1. User logs in (magic link)
2. Uploads a building plan (PDF or image)
3. Enters postcode (if not detected on plan)
4. System processes (15–30 seconds):
   - Extracts rooms, dimensions, total m²
   - Identifies building type
   - Discovers finishing level from QQPs
   - Looks up base price/m² by postcode
   - Applies ABEX index
   - Calculates rebuild cost
5. User sees:
   - Building summary (type, floors, room count)
   - Room-by-room breakdown with areas
   - Finishing level assessment with QQP indicators
   - **Estimated rebuild cost per m²**
   - **Estimated total rebuild cost**
   - Confidence score
6. User can override/adjust QQP values
7. Export as PDF report

## Key Distinction

**This is NOT real estate valuation.** It's construction rebuild cost. A luxury apartment costs roughly the same to rebuild whether it's in an expensive or cheap neighborhood. Regional construction cost variation is handled separately via a postcode coefficient.

## Formula

```
Rebuild Cost = m² × Base Price (postcode) × ABEX × Finishing Coefficient
```

## QQP System (Core Innovation)

QQPs (Quantitative-Qualitative Parameters) are features extracted from building plans that predict the finishing level and thus the rebuild cost multiplier.

The system:
1. Starts with ~32 expert-seeded QQPs
2. Extracts values from reference dossiers (plans with known prices)
3. Discovers correlations between QQPs and price/m²
4. Assigns and refines weights
5. Proposes NEW QQPs from data analysis (recorded in `qqp_discovery_log`)
6. Improves with every dossier processed

## Finishing Levels

| Level | Coefficient | Description |
|-------|-------------|-------------|
| Basic | 0.70–0.85 | Simple materials, minimal equipment |
| Standard | 0.85–1.00 | Average Belgian new build |
| Comfort | 1.00–1.15 | Quality finishes, good equipment |
| Luxury | 1.15–1.35 | High-end materials, full equipment |
| Premium | 1.35–1.50 | Exceptional quality, custom everything |

---

## Implementation Status

### ✅ Shipped

**Auth & Multi-tenancy**
- Magic link auth via Supabase
- Tenant auto-provisioning on first login
- RLS on all tables; all queries scoped to `tenant_id`

**Reference Dossier Pipeline (Admin)**
- Batch upload: multi-file drag-and-drop, default postcode/type, queued to `pending`
- Detailed upload: single file with PDF page classification and metadata pre-fill
- Duplicate detection: filename-based check before storage upload; returns existing dossier ID
- Storage reuse: if file already in storage, skips upload and links to existing dossier
- Per-row delete with inline confirmation; bulk "Delete All" button

**PDF Processing (`/api/process-dossier`)**
- Splits multi-page PDFs (up to 40 pages via `pdf-lib`)
- Classifies pages: `floor_plan`, `expert_report`, `pricing_table`, `photo`, `cover`, `other`
- Auto-extracts metadata from expert report / pricing table pages (address, postcode, price, finishing level)
- Apartment building detection: skips QQP analysis, stores `apartment_count`
- SQM extraction: room-by-room via Claude Vision (Sonnet 4)
- QQP extraction: 32 seeded parameters, finishing coefficient 0.70–1.50
- `prediction_error`: compares predicted coefficient vs known price/m² (using `national_base_price_sqm` = 1450 as divisor)
- QQP discovery: logs new suggestions when `|prediction_error| > 0.15`
- Records `processing_time_ms` on completion
- Outer error catch: always writes `status='error'` + `error_message` to DB

**Admin UI**
- `/admin/dossiers`: tabbed upload card, dossier table with status badges, building type badges, error expansion, sortable date column
- `/admin/dossiers/[id]`: metadata editing form (inline edit/save), processing button, apartment building note, debug log (JSON collapsible for `sqm_extraction` and `qqp_extraction`)
- `/admin/settings`: system settings page

**Reference Data**
- ABEX index seeded (10 entries)
- Regional postcode coefficients imported
- 32 QQP definitions seeded across 4 categories

---

### 🔲 Still To Build

**Core Estimation Flow (WS1 + WS2 integration)**
- End-user upload → SQM extraction → cost estimate (the non-admin flow)
- Cost estimate results page: building summary, room breakdown, finishing assessment, total rebuild cost
- QQP value override UI
- Confidence score display

**QQP Model Improvement**
- Weight calculation from reference dossier corpus
- Correlation charts per QQP
- QQP management UI: activate/deactivate, review AI-discovered candidates

**Accuracy Dashboard**
- `prediction_error` distribution over time
- Per-QQP accuracy contribution

**Other**
- Landing page
- PDF export of estimate report
- Mobile-responsive polish

---

## Admin Flows

### Reference Dossier Training
1. Admin uploads reference plan (PDF/image) + optional known price data
2. System processes: classifies pages → extracts metadata → extracts SQM → extracts QQP values
3. Compares predicted finishing coefficient vs known price/m²
4. Logs `prediction_error`; logs new QQP suggestions when error exceeds threshold
5. Dashboard will show accuracy improvement over time *(not yet built)*

### QQP Management *(not yet built)*
- View all active QQPs with weights and confidence
- Review AI-discovered QQP candidates from `qqp_discovery_log`
- Activate/deactivate QQPs
- See correlation charts

---

## Non-Functional Requirements

- **Performance**: Plan processing < 60 seconds (large VerzamelPDFs up to 60 MB)
- **Accuracy**: m² extraction > 80% accuracy vs known values
- **Mobile**: Fully responsive (insurance adjusters use tablets on-site)
- **Multi-tenant**: Each insurance company sees only their data
- **Security**: Supabase RLS, no cross-tenant data access
- **Onboarding**: Product-led growth — try one free estimation before signup
