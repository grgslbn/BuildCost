# Finishing Coefficient (F) Pipeline Redesign

> **Status**: Approved design — ready for implementation planning
> **Date**: 2026-05-21
> **Scope**: Fix the QQP extraction + model training pipeline so F varies correctly between 0.70 and 1.50

---

## Problem

The finishing coefficient (F) always outputs 1.50 (maximum) due to 6 compounding bugs:

1. **Boolean normalization**: raw 0/1 values mixed with z-scored numerics
2. **No negative signal**: 29/32 QQPs are positively correlated — absence scores 0, not "actively basic"
3. **Pearson instead of regression**: correlation coefficients used as weights (not proper regression)
4. **Scaling formula**: `mean ± std` cancels out diversity, predicted F collapses to a narrow band
5. **Training data bias**: comfort+ buildings overrepresented
6. **No visual input**: QQP extraction received only SQM JSON text, no plan images

Current state: F is hard-coded to 1.00, model v21 disabled. QQP extraction runs with images but output is unused.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | Fix QQP→model system (not replace) | User preference; proper ML with 200+ dossiers |
| QQP definitions | Keep existing 32, change prompt | Avoid re-seeding; prompt redesign handles scoring |
| QQP value format | Scale -1.0 to +1.0 | Captures both positive and negative signals continuously |
| Model type | Ridge regression (OLS + L2) | Simple, interpretable, no external libraries, sufficient for 200+ samples × 32 features |
| Prompt storage | `prompt_versions` table in Supabase | Both SQM and QQP prompts versioned with history |
| Migration strategy | Programmatic conversion of existing data | Convert old boolean/numeric QQP values to -1/+1 using reference ranges; re-extract later |

## Architecture

### Estimation Pipeline

```
Plan Upload
  → Render images (+ landscape crop, floor labels)
  → SQM Extraction (active SQM prompt from prompt_versions)
  → QQP Extraction (active QQP prompt from prompt_versions + plan images)
      → 32 scores [-1.0 … +1.0]
  → Ridge Model: F = clamp(intercept + Σ(wᵢ × QQPᵢ), 0.70, 1.50)
  → Cost Calculation: 3-CAT formula × F × regional × ABEX
  → Result
```

Fallback when no trained model exists: F = 1.00 (Standard).

### Training Pipeline

```
For each reference dossier with known cost:
  1. Back-calculate F_true from known cost + areas + regional + ABEX
  2. Collect QQP values [QQP₁..QQP₃₂]
  3. Build dataset: 200+ rows × 33 columns (32 features + F_true target)
  4. Train Ridge: minimize ||F_true - (intercept + Σ wᵢ×QQPᵢ)||² + λΣwᵢ²
  5. Find λ via 5-fold cross-validation
  6. Evaluate: MAE, R² on held-out test set
  7. Store model version (intercept, weights, λ, metrics, prompt_version_id)
```

### Back-calculation of F_true

Given a reference dossier's known total cost, surface areas, and location:

```
total_cost = (CAT1_sqm × CAT1_price(F) + CAT2_sqm × CAT2_price(F) + CAT3_sqm × CAT3_price(F))
             × regional_factor × abex_factor

where CAT_price(F) = CAT_min + (F - 0.70) / 0.80 × (CAT_max - CAT_min)
```

Solve for F. If F_true falls outside [0.70, 1.50], flag as outlier (useful for CAT price calibration).

## QQP Prompt Redesign

### Scoring Principle

Each QQP gets a score from -1.0 to +1.0 with clear reference points:

| Score | Meaning | Example (kitchen) |
|-------|---------|-------------------|
| -1.0 | Actively basic/cheap | Kitchenette, no built-ins, <6m² |
| -0.5 | Below average | Small kitchen, basic appliances |
| 0.0 | Average Belgian new build | Standard fitted kitchen, ~10m² |
| +0.5 | Above average | Spacious kitchen, island, good appliances |
| +1.0 | Luxury/premium | Large open kitchen, top appliances, double sink |

### Prompt Requirements

The QQP prompt must:

1. **Provide reference values per QQP** so Claude knows what "average" means
2. **Instruct to look for absence** of expected features as negative signal
3. **Use plan images** for visual quality assessment (not just SQM JSON)
4. **Anchor on 0.0 = Belgian average new build**

### QQP Definition Format in Prompt

```
- kitchen_sqm: Kitchen surface area
  Reference: <6m² = -1.0, 8m² = -0.5, 10m² = 0.0, 15m² = +0.5, 20m²+ = +1.0
  Negative signal: kitchenette without full kitchen = -1.0
  Visual: look for built-in appliances, island, countertop

- has_dressing: Walk-in closet / dressing room
  Reference: absent + small bedrooms = -0.5, absent + spacious bedrooms = 0.0,
             present = +0.7, large dressing = +1.0
  Note: in luxury homes, absence of dressing IS a signal
```

### Output Format

```json
{
  "qqp_values": {
    "kitchen_sqm": {
      "score": 0.3,
      "confidence": 0.85,
      "reasoning": "12m² fitted kitchen with built-in oven and dishwasher"
    }
  },
  "finishing_assessment": {
    "level": "comfort",
    "coefficient": 1.08,
    "confidence": 0.7,
    "reasoning": "..."
  }
}
```

Note: `finishing_assessment.coefficient` is Claude's own estimate — used for comparison/validation against the Ridge model output, not as the actual F value.

## Database Changes

### New Table: `prompt_versions`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK | |
| prompt_type | text | `'sqm_extraction'` or `'qqp_extraction'` |
| version_number | int | Auto-increment per prompt_type |
| system_prompt | text | System prompt content |
| user_template | text | User prompt template |
| is_active | boolean | Max 1 active per prompt_type |
| notes | text | Changelog / description of changes |
| created_at | timestamptz | |

Replaces the current `system_settings` mechanism for prompts. Existing SQM v11b prompt becomes version 1. Existing QQP prompt becomes version 1 (legacy).

### Modified: `qqp_values`

Add columns:

| Column | Type | Description |
|--------|------|-------------|
| prompt_version_id | uuid FK → prompt_versions.id | Which prompt version produced this extraction |
| extraction_method | text | `'ai_extracted'` or `'programmatic_conversion'` |

The `value` jsonb column now contains `{"score": float, "confidence": float, "reasoning": string}` instead of `{"value": bool/number, "confidence": float, "notes": string}`.

### Modified: `model_versions`

Add columns:

| Column | Type | Description |
|--------|------|-------------|
| intercept | float | Ridge intercept term |
| lambda | float | Regularization parameter |
| prompt_version_id | uuid FK → prompt_versions.id | QQP prompt version used for training data |
| training_config | jsonb | `{cv_folds, n_samples, feature_names, conversion_ratio}` |

## Data Migration Strategy

### Phase 1: Programmatic Conversion (immediate)

Convert existing QQP values to approximate -1/+1 scores:

- **Numeric QQPs** (kitchen_sqm, living_room_sqm, etc.): map via reference ranges
  - Example: `kitchen_sqm: 12` → reference range [6, 20] → score = `(12 - 13) / 7 = -0.14` (slightly below average)
- **Boolean QQPs** (has_dressing, has_wellness, etc.): `true → +0.5`, `false → 0.0`
  - Not -0.5 for false — we don't know if absence is notable without visual assessment
- **Ratio QQPs**: linear map to [-1, +1] using reference ranges
- **Mark as** `extraction_method = 'programmatic_conversion'`

### Phase 2: Train Initial Model

Train Ridge on converted data. This model will be approximate but functional — F will actually vary based on building characteristics.

### Phase 3: Gradual Re-extraction (later)

As budget/time allows, re-extract dossiers with new QQP prompt + images. Prioritize dossiers where the model prediction error is largest. Retrain after each batch.

## Ridge Regression Implementation

Pure TypeScript, no external ML libraries.

### Training (`weight-calibration.ts` rewrite)

```typescript
function trainRidge(
  X: number[][],     // n_samples × 32 QQP scores
  y: number[],       // n_samples F_true values
  lambda: number     // regularization strength
): { intercept: number; weights: number[] }
```

Algorithm:
1. Center X and y (subtract means)
2. Compute: w = (XᵀX + λI)⁻¹ Xᵀy
3. Compute intercept = mean(y) - w·mean(X)
4. Return {intercept, weights}

### Lambda Selection

```typescript
function crossValidateRidge(
  X: number[][],
  y: number[],
  lambdas: number[],  // e.g. [0.01, 0.1, 1, 10, 100]
  folds: number       // default 5
): { bestLambda: number; scores: Record<number, number> }
```

### Prediction (`model-prediction.ts` rewrite)

```typescript
function predictF(
  qqpScores: Record<string, number>,  // 32 QQP name → score pairs
  model: { intercept: number; weights: Record<string, number> }
): number {
  let f = model.intercept;
  for (const [name, weight] of Object.entries(model.weights)) {
    f += weight * (qqpScores[name] ?? 0);
  }
  return Math.max(0.70, Math.min(1.50, f));
}
```

Missing QQPs default to 0 (neutral), which is safe because the intercept captures the baseline.

## Retrain Triggers

The model should be retrained when:
- A batch of new dossiers is processed (e.g., every 10 new)
- A new QQP prompt version is activated AND dossiers are re-extracted with it
- Manually triggered from admin UI

Each retrain produces a new model version. Old versions are kept for comparison.

## Files to Change

| File | Change |
|------|--------|
| `src/lib/ai/prompts.ts` | New QQP prompt with -1/+1 scoring and reference values |
| `src/lib/ai/prompt-settings.ts` | Load from `prompt_versions` table instead of `system_settings` |
| `src/lib/qqp/weight-calibration.ts` | Replace Pearson with Ridge regression |
| `src/lib/qqp/model-prediction.ts` | Replace broken scaling with `intercept + Σ(w×x)` |
| `src/app/api/estimate-process/route.ts` | Use active model instead of hardcoded F=1.0 |
| `src/app/api/process-dossier/route.ts` | Store prompt_version_id with extractions |
| `supabase/migrations/` | New migration for `prompt_versions` table + column additions |
| New: `src/lib/qqp/data-migration.ts` | Programmatic conversion of old QQP values |
| New: `src/lib/qqp/ridge-regression.ts` | Ridge math (train, predict, cross-validate) |
| New: `src/lib/qqp/f-backcalculate.ts` | Solve for F_true from known costs |
