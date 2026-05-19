# BuildCost MVP — Product Requirements Document

## Problem

Belgian building insurance companies need to estimate reconstruction costs after sinister (fire, flood, etc.). Today this requires expensive on-site expert assessments. BuildCost automates this: upload a building plan → get a rebuild cost estimate.

## Target User

Belgian building insurance companies (adjusters, underwriters, claims processors).

## Core User Flow

1. User logs in (magic link)
2. Uploads a building plan (PDF or image)
3. Enters postcode (if not detected on plan)
4. System processes (15-30 seconds):
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
1. Starts with ~30 expert-seeded QQPs
2. Extracts values from reference dossiers (plans with known prices)
3. Discovers correlations between QQPs and price/m²
4. Assigns and refines weights
5. Proposes NEW QQPs from data analysis
6. Improves with every dossier processed

## Finishing Levels

| Level | Coefficient | Description |
|-------|-----------|-------------|
| Basic | 0.70–0.85 | Simple materials, minimal equipment |
| Standard | 0.85–1.00 | Average Belgian new build |
| Comfort | 1.00–1.15 | Quality finishes, good equipment |
| Luxury | 1.15–1.35 | High-end materials, full equipment |
| Premium | 1.35–1.50 | Exceptional quality, custom everything |

## Admin Flows

### Reference Dossier Training
1. Admin uploads reference plan + known price data
2. System extracts SQM + QQPs
3. Compares predicted vs actual price
4. Updates QQP weights
5. Dashboard shows accuracy improvement over time

### QQP Management
- View all active QQPs with weights and confidence
- Review AI-discovered QQP candidates
- Activate/deactivate QQPs
- See correlation charts

## Non-Functional Requirements

- **Performance**: Plan processing < 30 seconds
- **Accuracy**: m² extraction > 80% accuracy vs known values
- **Mobile**: Fully responsive (insurance adjusters use tablets on-site)
- **Multi-tenant**: Each insurance company sees only their data
- **Security**: Supabase RLS, no cross-tenant data access
- **Onboarding**: Product-led growth — try one free estimation before signup
