# Finishing Coefficient (F) Pipeline Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken QQP→model pipeline so the finishing coefficient (F) varies correctly between 0.70 and 1.50, instead of always outputting the maximum.

**Architecture:** Replace the Pearson correlation model with Ridge regression. Change QQP prompt from boolean extraction to -1/+1 scoring with negative signals. Add prompt versioning in Supabase. Programmatically convert existing data as migration path.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres), Claude API, pure TS linear algebra (no ML libraries)

**Spec:** `docs/superpowers/specs/2026-05-21-finishing-coefficient-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/lib/qqp/ridge-regression.ts` | Ridge training (matrix math), cross-validation, prediction. Pure functions, no DB dependency. |
| `src/lib/qqp/f-backcalculate.ts` | Solve for F_true given known cost, areas, pricing config, regional/ABEX factors. Pure function. |
| `src/lib/qqp/data-migration.ts` | Convert old `value_boolean`/`value_numeric` QQP data to new `{score}` format using reference ranges. |
| `src/lib/qqp/reference-ranges.ts` | QQP reference ranges for programmatic conversion and prompt generation. Single source of truth. |
| `supabase/migrations/XXXX_prompt_versions_and_qqp_updates.sql` | DB migration: `prompt_versions` table, new columns on `dossier_qqp_values` and `qqp_model_versions`. |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/ai/prompts.ts` | New QQP system/user prompt with -1/+1 scoring. New output types. |
| `src/lib/ai/prompt-settings.ts` | Load prompts from `prompt_versions` table instead of `system_settings`. |
| `src/lib/ai/prompt-keys.ts` | Remove `PROMPT_SEPARATOR` and old keys (or deprecate). |
| `src/lib/qqp/weight-calibration.ts` | Rewrite: use Ridge from `ridge-regression.ts`, read new QQP format, store new model format. |
| `src/lib/qqp/model-prediction.ts` | Rewrite: `predictF()` replaces `applyModelWeights()`. `flattenQQPValues()` reads `.score`. |
| `src/lib/qqp/retroactive-extraction.ts` | Write new `{score, confidence, reasoning}` format to DB. |
| `src/app/api/estimate-process/route.ts` | Use new model prediction, parse new QQP output format. |
| `src/app/api/process-dossier/route.ts` | Store `prompt_version_id` with extractions, write new format. |
| `src/components/estimate/results-view.tsx` | Display `.score` (-1/+1) instead of old boolean/numeric values. |
| `src/components/estimate/estimation-audit-view.tsx` | Update `QQPEntry` type, remove `typeof v.value === "boolean"` checks. |
| `src/components/dossiers/qqp-results.tsx` | Update `QQPValue` type and `formatQQPValue()` for scores. |
| `src/app/(dashboard)/admin/qqp/page.tsx` | Display score format in QQP management page. |

---

## Task 0: Set Up Test Runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest @vitest/coverage-v8
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Add to `scripts`: `"test": "vitest run", "test:watch": "vitest"`

- [ ] **Step 4: Verify**

Run: `npm test` — should exit with "no test files found" (no error).

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.ts package-lock.json
git commit -m "chore: add vitest test runner"
```

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/XXXX_prompt_versions_and_qqp_updates.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- prompt_versions table
CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_type TEXT NOT NULL CHECK (prompt_type IN ('sqm_extraction', 'qqp_extraction')),
  version_number INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  user_template TEXT NOT NULL,
  is_active BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(prompt_type, version_number)
);

CREATE INDEX idx_prompt_versions_active
  ON prompt_versions(prompt_type) WHERE is_active = true;

-- Seed SQM v11b as version 1 (active) — prompt text inserted by application code
-- Seed QQP legacy as version 1 (inactive) — will be superseded by v2

-- Add columns to dossier_qqp_values
ALTER TABLE dossier_qqp_values
  ADD COLUMN prompt_version_id UUID REFERENCES prompt_versions(id),
  ADD COLUMN extraction_method TEXT DEFAULT 'ai_extracted'
    CHECK (extraction_method IN ('ai_extracted', 'programmatic_conversion'));

-- Add columns to qqp_model_versions
ALTER TABLE qqp_model_versions
  ADD COLUMN intercept DOUBLE PRECISION,
  ADD COLUMN lambda DOUBLE PRECISION,
  ADD COLUMN prompt_version_id UUID REFERENCES prompt_versions(id),
  ADD COLUMN training_config JSONB;
```

- [ ] **Step 2: Apply migration to Supabase**

Run via Supabase MCP `apply_migration` tool or SQL editor.
Verify tables exist: `SELECT * FROM prompt_versions LIMIT 1;`

- [ ] **Step 3: Seed initial prompt versions**

Write a seed script or API endpoint that inserts:
1. SQM v11b prompt (from `prompts.ts` constants) as `sqm_extraction` version 1, `is_active = true`
2. Current QQP prompt (from `prompts.ts` constants) as `qqp_extraction` version 1, `is_active = false`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add prompt_versions table, extend dossier_qqp_values and qqp_model_versions"
```

---

## Task 2: QQP Reference Ranges

**Files:**
- Create: `src/lib/qqp/reference-ranges.ts`

- [ ] **Step 1: Write the reference ranges module**

Define reference ranges for all 32 QQPs. These are used for:
1. Programmatic conversion of old data
2. Generating scoring guidance in the QQP prompt

```typescript
export type QQPRange = {
  name: string;
  dataType: 'numeric' | 'boolean' | 'ratio' | 'score';
  /** For numeric: [min_value, avg_value, max_value] mapping to [-1, 0, +1] */
  referencePoints?: { value: number; score: number }[];
  /** For boolean: score when true, score when false */
  booleanScores?: { whenTrue: number; whenFalse: number };
  /** Human-readable scoring guide for the prompt */
  promptGuide: string;
};

export const QQP_REFERENCE_RANGES: Record<string, QQPRange> = {
  total_livable_sqm: {
    name: 'total_livable_sqm',
    dataType: 'numeric',
    referencePoints: [
      { value: 60, score: -1.0 },
      { value: 100, score: -0.5 },
      { value: 150, score: 0.0 },
      { value: 220, score: 0.5 },
      { value: 300, score: 1.0 },
    ],
    promptGuide: 'Reference: <60m²=-1.0, 100m²=-0.5, 150m²=0.0, 220m²=+0.5, 300m²+=+1.0',
  },
  entrance_hall_sqm: {
    name: 'entrance_hall_sqm',
    dataType: 'numeric',
    referencePoints: [
      { value: 2, score: -1.0 },
      { value: 4, score: -0.5 },
      { value: 6, score: 0.0 },
      { value: 10, score: 0.5 },
      { value: 15, score: 1.0 },
    ],
    promptGuide: 'Reference: <2m²=-1.0, 4m²=-0.5, 6m²=0.0, 10m²=+0.5, 15m²+=+1.0',
  },
  // ... all 32 QQPs with reference ranges
  // (full list derived from docs/QQP_SEED_LIST.md)
  has_dressing: {
    name: 'has_dressing',
    dataType: 'boolean',
    booleanScores: { whenTrue: 0.5, whenFalse: 0.0 },
    promptGuide: 'Absent + small bedrooms=-0.5, absent + spacious=0.0, present=+0.7, large=+1.0',
  },
  // ... etc
};

/**
 * Convert an old-format QQP value to a -1/+1 score using reference ranges.
 */
export function convertToScore(
  qqpName: string,
  value: number | boolean | null
): number {
  if (value === null || value === undefined) return 0;
  const range = QQP_REFERENCE_RANGES[qqpName];
  if (!range) return 0;

  if (typeof value === 'boolean') {
    return value ? (range.booleanScores?.whenTrue ?? 0.5) : (range.booleanScores?.whenFalse ?? 0.0);
  }

  if (range.referencePoints && range.referencePoints.length >= 2) {
    return interpolateScore(value, range.referencePoints);
  }
  return 0;
}

function interpolateScore(
  value: number,
  points: { value: number; score: number }[]
): number {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  if (value <= sorted[0].value) return sorted[0].score;
  if (value >= sorted[sorted.length - 1].value) return sorted[sorted.length - 1].score;

  for (let i = 0; i < sorted.length - 1; i++) {
    if (value >= sorted[i].value && value <= sorted[i + 1].value) {
      const t = (value - sorted[i].value) / (sorted[i + 1].value - sorted[i].value);
      return sorted[i].score + t * (sorted[i + 1].score - sorted[i].score);
    }
  }
  return 0;
}
```

Complete all 32 QQP entries using `docs/QQP_SEED_LIST.md` as source. For each:
- Size/layout QQPs (1-11): reference points from Belgian building norms
- Room count QQPs (12-22): boolean scores or count-based reference points
- Equipment QQPs (23-28): boolean scores or count-based reference points
- Proportionality QQPs (29-32): ratio-based reference points

- [ ] **Step 2: Write tests for `convertToScore` and `interpolateScore`**

Create `src/lib/qqp/__tests__/reference-ranges.test.ts`:

```typescript
import { convertToScore } from '../reference-ranges';

describe('convertToScore', () => {
  test('boolean true → positive score', () => {
    expect(convertToScore('has_dressing', true)).toBe(0.5);
  });
  test('boolean false → 0', () => {
    expect(convertToScore('has_dressing', false)).toBe(0.0);
  });
  test('numeric at midpoint → 0', () => {
    const score = convertToScore('kitchen_sqm', 10);
    expect(score).toBeCloseTo(0.0, 1);
  });
  test('numeric below range → -1', () => {
    const score = convertToScore('kitchen_sqm', 3);
    expect(score).toBe(-1.0);
  });
  test('numeric above range → +1', () => {
    const score = convertToScore('kitchen_sqm', 25);
    expect(score).toBe(1.0);
  });
  test('numeric interpolates between points', () => {
    const score = convertToScore('kitchen_sqm', 7);
    expect(score).toBeGreaterThan(-1.0);
    expect(score).toBeLessThan(0.0);
  });
  test('null value → 0', () => {
    expect(convertToScore('kitchen_sqm', null)).toBe(0);
  });
  test('unknown QQP → 0', () => {
    expect(convertToScore('nonexistent_qqp', 42)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/lib/qqp/__tests__/reference-ranges.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/qqp/reference-ranges.ts src/lib/qqp/__tests__/reference-ranges.test.ts
git commit -m "feat: add QQP reference ranges for score conversion and prompt generation"
```

---

## Task 3: Ridge Regression Math

**Files:**
- Create: `src/lib/qqp/ridge-regression.ts`
- Create: `src/lib/qqp/__tests__/ridge-regression.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { trainRidge, predictRidge, crossValidateRidge } from '../ridge-regression';

describe('trainRidge', () => {
  test('perfect linear relationship recovers weights', () => {
    // y = 1.0 + 0.5*x1 - 0.3*x2
    const X = [
      [1, 0], [0, 1], [1, 1], [2, 0], [0, 2],
      [2, 1], [1, 2], [3, 0], [0, 3], [2, 2],
    ];
    const y = X.map(([x1, x2]) => 1.0 + 0.5 * x1 - 0.3 * x2);
    const model = trainRidge(X, y, 0.001); // very small lambda
    expect(model.intercept).toBeCloseTo(1.0, 1);
    expect(model.weights[0]).toBeCloseTo(0.5, 1);
    expect(model.weights[1]).toBeCloseTo(-0.3, 1);
  });

  test('regularization shrinks weights toward zero', () => {
    const X = [[1, 0], [0, 1], [1, 1], [2, 0], [0, 2]];
    const y = X.map(([x1, x2]) => 1.0 + 0.5 * x1 - 0.3 * x2);
    const weak = trainRidge(X, y, 0.001);
    const strong = trainRidge(X, y, 100);
    // Strong regularization → weights closer to 0
    expect(Math.abs(strong.weights[0])).toBeLessThan(Math.abs(weak.weights[0]));
  });

  test('prediction uses intercept + dot product', () => {
    const model = { intercept: 1.0, weights: [0.5, -0.3] };
    expect(predictRidge([2, 1], model)).toBeCloseTo(1.0 + 1.0 - 0.3, 2);
  });
});

describe('crossValidateRidge', () => {
  test('selects best lambda from candidates', () => {
    const X = Array.from({ length: 50 }, (_, i) => [
      Math.sin(i), Math.cos(i),
    ]);
    const y = X.map(([x1, x2]) => 1.0 + 0.4 * x1 - 0.2 * x2 + (Math.random() - 0.5) * 0.01);
    const result = crossValidateRidge(X, y, [0.001, 0.01, 0.1, 1, 10, 100], 5);
    expect(result.bestLambda).toBeDefined();
    expect(result.scores).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/qqp/__tests__/ridge-regression.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement Ridge regression**

```typescript
/**
 * Pure TypeScript Ridge regression — no external ML libraries.
 * Implements (XᵀX + λI)⁻¹ Xᵀy with matrix inversion via Gauss-Jordan.
 */

export type RidgeModel = {
  intercept: number;
  weights: number[];
};

export function trainRidge(
  X: number[][],
  y: number[],
  lambda: number
): RidgeModel {
  const n = X.length;
  const p = X[0].length;

  // Center X and y
  const xMeans = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) xMeans[j] += X[i][j];
    xMeans[j] /= n;
  }
  const yMean = y.reduce((a, b) => a + b, 0) / n;

  const Xc = X.map(row => row.map((v, j) => v - xMeans[j]));
  const yc = y.map(v => v - yMean);

  // XᵀX + λI
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += Xc[k][i] * Xc[k][j];
      XtX[i][j] = s + (i === j ? lambda : 0);
    }
  }

  // Xᵀy
  const Xty = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) Xty[j] += Xc[i][j] * yc[i];
  }

  // Solve via Gauss-Jordan elimination
  const weights = solveLinearSystem(XtX, Xty);

  // intercept = yMean - Σ(wⱼ × xMeanⱼ)
  let intercept = yMean;
  for (let j = 0; j < p; j++) intercept -= weights[j] * xMeans[j];

  return { intercept, weights };
}

export function predictRidge(x: number[], model: RidgeModel): number {
  let result = model.intercept;
  for (let j = 0; j < model.weights.length; j++) {
    result += model.weights[j] * (x[j] ?? 0);
  }
  return result;
}

export type CVResult = {
  bestLambda: number;
  scores: Record<number, number>; // lambda → mean MSE
};

export function crossValidateRidge(
  X: number[][],
  y: number[],
  lambdas: number[],
  folds: number = 5
): CVResult {
  const n = X.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  // Deterministic fold assignment
  const foldAssignment = indices.map(i => i % folds);

  const scores: Record<number, number> = {};

  for (const lambda of lambdas) {
    let totalMSE = 0;

    for (let fold = 0; fold < folds; fold++) {
      const trainIdx = indices.filter(i => foldAssignment[i] !== fold);
      const testIdx = indices.filter(i => foldAssignment[i] === fold);

      const Xtrain = trainIdx.map(i => X[i]);
      const ytrain = trainIdx.map(i => y[i]);
      const Xtest = testIdx.map(i => X[i]);
      const ytest = testIdx.map(i => y[i]);

      const model = trainRidge(Xtrain, ytrain, lambda);

      let mse = 0;
      for (let i = 0; i < Xtest.length; i++) {
        const pred = predictRidge(Xtest[i], model);
        mse += (pred - ytest[i]) ** 2;
      }
      totalMSE += mse / Xtest.length;
    }

    scores[lambda] = totalMSE / folds;
  }

  const bestLambda = lambdas.reduce((best, l) =>
    scores[l] < scores[best] ? l : best
  );

  return { bestLambda, scores };
}

/** Gauss-Jordan elimination to solve Ax = b */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  // Augmented matrix [A|b]
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue; // singular or near-singular

    // Scale pivot row
    for (let j = col; j <= n; j++) aug[col][j] /= pivot;

    // Eliminate column
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  return aug.map(row => row[n]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/qqp/__tests__/ridge-regression.test.ts`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/qqp/ridge-regression.ts src/lib/qqp/__tests__/ridge-regression.test.ts
git commit -m "feat: add Ridge regression implementation (pure TypeScript, no ML libraries)"
```

---

## Task 4: F Back-Calculation

**Files:**
- Create: `src/lib/qqp/f-backcalculate.ts`
- Create: `src/lib/qqp/__tests__/f-backcalculate.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { backcalculateF } from '../f-backcalculate';

describe('backcalculateF', () => {
  const pricing = {
    cat1_min: 1100, cat1_max: 1900,
    cat2_min: 550, cat2_max: 950,
    cat3_min: 330, cat3_max: 570,
  };

  test('midpoint pricing returns F≈1.10', () => {
    // At F=1.10: cat1_price = 1100 + (0.40/0.80)*800 = 1500
    const areas = { cat1_sqm: 150, cat2_sqm: 50, cat3_sqm: 20 };
    const cat1Price = 1100 + (1.10 - 0.70) / 0.80 * 800; // 1500
    const cat2Price = 550 + (1.10 - 0.70) / 0.80 * 400;  // 750
    const cat3Price = 330 + (1.10 - 0.70) / 0.80 * 240;  // 450
    const totalCost = (150 * cat1Price + 50 * cat2Price + 20 * cat3Price) * 1.0 * 1.0;
    const result = backcalculateF(totalCost, areas, pricing, 1.0, 1.0);
    expect(result.f).toBeCloseTo(1.10, 2);
    expect(result.isOutlier).toBe(false);
  });

  test('very cheap building → F at minimum (0.70)', () => {
    const areas = { cat1_sqm: 100, cat2_sqm: 0, cat3_sqm: 0 };
    const totalCost = 100 * 1100 * 1.0 * 1.0; // exactly at cat1_min
    const result = backcalculateF(totalCost, areas, pricing, 1.0, 1.0);
    expect(result.f).toBeCloseTo(0.70, 2);
  });

  test('outlier flagged when F > 1.50', () => {
    const areas = { cat1_sqm: 100, cat2_sqm: 0, cat3_sqm: 0 };
    const totalCost = 100 * 2200 * 1.0 * 1.0; // beyond cat1_max
    const result = backcalculateF(totalCost, areas, pricing, 1.0, 1.0);
    expect(result.isOutlier).toBe(true);
    expect(result.f).toBe(1.50); // clamped
  });

  test('regional and ABEX factors applied', () => {
    const areas = { cat1_sqm: 100, cat2_sqm: 0, cat3_sqm: 0 };
    const f = 1.10;
    const cat1Price = 1100 + (f - 0.70) / 0.80 * 800;
    const totalCost = 100 * cat1Price * 1.05 * 0.95;
    const result = backcalculateF(totalCost, areas, pricing, 1.05, 0.95);
    expect(result.f).toBeCloseTo(f, 2);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

- [ ] **Step 3: Implement**

```typescript
import { type PricingConfig, F_MIN, F_MAX } from '@/lib/cost/calculate-cost';

type AreaInput = { cat1_sqm: number; cat2_sqm: number; cat3_sqm: number };

export type BackcalcResult = {
  f: number;
  isOutlier: boolean;
  rawF: number; // before clamping
};

export function backcalculateF(
  totalCost: number,
  areas: AreaInput,
  pricing: PricingConfig,
  regionalFactor: number,
  abexFactor: number
): BackcalcResult {
  // total = (cat1*price1(F) + cat2*price2(F) + cat3*price3(F)) * regional * abex
  // price_i(F) = min_i + (F - 0.70) / 0.80 * (max_i - min_i)
  //
  // Let r = (F - 0.70) / 0.80
  // total = (cat1*(min1 + r*range1) + cat2*(min2 + r*range2) + cat3*(min3 + r*range3)) * reg * abex
  // total / (reg * abex) = cat1*min1 + cat2*min2 + cat3*min3 + r*(cat1*range1 + cat2*range2 + cat3*range3)
  //
  // Solve for r, then F = 0.70 + r * 0.80

  const externalFactors = regionalFactor * abexFactor;
  if (externalFactors === 0) return { f: 1.0, isOutlier: true, rawF: 1.0 };

  const costBeforeFactors = totalCost / externalFactors;

  const range1 = pricing.cat1_max - pricing.cat1_min;
  const range2 = pricing.cat2_max - pricing.cat2_min;
  const range3 = pricing.cat3_max - pricing.cat3_min;

  const minCost = areas.cat1_sqm * pricing.cat1_min
                + areas.cat2_sqm * pricing.cat2_min
                + areas.cat3_sqm * pricing.cat3_min;

  const rangeSlope = areas.cat1_sqm * range1
                   + areas.cat2_sqm * range2
                   + areas.cat3_sqm * range3;

  if (rangeSlope === 0) return { f: 1.0, isOutlier: true, rawF: 1.0 };

  const r = (costBeforeFactors - minCost) / rangeSlope;
  const rawF = F_MIN + r * (F_MAX - F_MIN);
  const isOutlier = rawF < F_MIN || rawF > F_MAX;
  const f = Math.max(F_MIN, Math.min(F_MAX, rawF));

  return { f, isOutlier, rawF };
}
```

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/lib/qqp/f-backcalculate.ts src/lib/qqp/__tests__/f-backcalculate.test.ts
git commit -m "feat: add F back-calculation from known costs"
```

---

## Task 5: Data Migration Script

**Files:**
- Create: `src/lib/qqp/data-migration.ts`

- [ ] **Step 1: Implement programmatic conversion**

This module converts existing `dossier_qqp_values` rows from `value_boolean`/`value_numeric` to the new `{score, confidence, reasoning}` jsonb format.

```typescript
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { convertToScore } from './reference-ranges';

export type MigrationResult = {
  processed: number;
  converted: number;
  errors: number;
};

/**
 * Converts all existing dossier_qqp_values from old format to new score format.
 * Processes in batches. Idempotent — skips rows already in new format.
 */
export async function migrateQQPValues(batchSize = 100): Promise<MigrationResult> {
  const admin = createSupabaseAdminClient();
  let processed = 0, converted = 0, errors = 0;

  // Load QQP definitions for name lookup
  const { data: defs } = await admin
    .from('qqp_definitions')
    .select('id, name, data_type');
  const defMap = new Map((defs ?? []).map(d => [d.id, d]));

  // Load all rows that still use old format (no extraction_method set)
  const { data: rows } = await admin
    .from('dossier_qqp_values')
    .select('id, qqp_id, value_numeric, value_boolean, confidence')
    .is('extraction_method', null)
    .limit(batchSize);

  for (const row of rows ?? []) {
    processed++;
    const def = defMap.get(row.qqp_id);
    if (!def) { errors++; continue; }

    const oldValue = row.value_numeric !== null
      ? Number(row.value_numeric)
      : row.value_boolean !== null
        ? row.value_boolean
        : null;

    const score = convertToScore(def.name, oldValue);

    const { error } = await admin
      .from('dossier_qqp_values')
      .update({
        value_numeric: score,
        value_boolean: null,
        value_text: null,
        confidence: Math.min(row.confidence ?? 0.5, 0.5), // lower confidence for converted data
        extraction_notes: `Programmatic conversion from ${def.data_type}: ${oldValue} → ${score.toFixed(3)}`,
        extraction_method: 'programmatic_conversion',
      })
      .eq('id', row.id);

    if (error) errors++;
    else converted++;
  }

  return { processed, converted, errors };
}
```

**Storage approach:** We reuse existing DB columns rather than adding a new jsonb column:
- `value_numeric` → stores the score (-1.0 to +1.0)
- `confidence` → stays as confidence (0.0 to 1.0)
- `extraction_notes` → stores the reasoning string
- `value_boolean` → set to null (no longer used)
- `extraction_method` → marks provenance ('ai_extracted' | 'programmatic_conversion')

The **in-memory format** in TypeScript code uses `{score, confidence, reasoning}` objects. The DB read/write layer converts between column format and object format. This avoids a complex jsonb migration while keeping the code clean.

- [ ] **Step 2: Commit**

```bash
git add src/lib/qqp/data-migration.ts
git commit -m "feat: add programmatic QQP data migration (old format → score)"
```

---

## Task 6: New QQP Prompt

**Files:**
- Modify: `src/lib/ai/prompts.ts` (lines 408-515)

- [ ] **Step 1: Write the new QQP system prompt and user template**

Replace `QQP_SYSTEM_PROMPT` and `QQP_USER_PROMPT_TEMPLATE` with new versions that:

1. Instruct Claude to score each QQP on -1.0 to +1.0 scale
2. Include reference values per QQP from `reference-ranges.ts`
3. Instruct to look for negative signals (absence of expected features)
4. Instruct to use plan images for visual quality assessment
5. Output format: `{score, confidence, reasoning}` per QQP

The new `QQP_SYSTEM_PROMPT` should explain:
- The scoring scale (-1 to +1, 0 = Belgian average new build)
- What negative signals look like
- That plan images are provided for visual assessment

The new `QQP_USER_PROMPT_TEMPLATE` should:
- Include `{sqm_extraction_json}` placeholder (existing)
- Include `{qqp_scoring_guide}` — generated from reference ranges
- Request JSON output with `{score, confidence, reasoning}` per QQP

Also update the `buildQQPUserPrompt()` function signature and types:
- Import `QQP_REFERENCE_RANGES` from `reference-ranges.ts`
- Generate the scoring guide from reference ranges
- Return the expanded prompt

- [ ] **Step 2: Update QQPResult types**

In the same file, update or add types:

```typescript
export type QQPScoreEntry = {
  score: number;      // -1.0 to +1.0
  confidence: number; // 0.0 to 1.0
  reasoning: string;  // brief explanation
};

export type QQPExtractionResult = {
  qqp_values: Record<string, QQPScoreEntry>;
  finishing_assessment: {
    level: string;
    coefficient: number;
    confidence: number;
    reasoning: string;
  };
  new_qqp_suggestions?: Array<{
    name: string;
    description: string;
    reasoning: string;
  }>;
};
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/prompts.ts
git commit -m "feat: new QQP prompt with -1/+1 scoring, negative signals, and visual assessment"
```

---

## Task 7: Prompt Settings — Load from `prompt_versions`

**Files:**
- Modify: `src/lib/ai/prompt-settings.ts`
- Modify: `src/lib/ai/prompt-keys.ts`

- [ ] **Step 1: Rewrite `getPromptSettings()` to read from `prompt_versions`**

Replace the current `system_settings` lookup with a query to `prompt_versions`:

```typescript
export async function getPromptSettings(): Promise<LoadedPrompts> {
  const admin = createSupabaseAdminClient();

  // Load active prompt versions
  const { data: versions } = await admin
    .from('prompt_versions')
    .select('*')
    .eq('is_active', true);

  const byType = Object.fromEntries(
    (versions ?? []).map(v => [v.prompt_type, v])
  );

  const sqmVersion = byType['sqm_extraction'];
  const qqpVersion = byType['qqp_extraction'];

  return {
    sqmSystem: sqmVersion?.system_prompt ?? SQM_SYSTEM_PROMPT,
    sqmUser: sqmVersion?.user_template ?? SQM_USER_PROMPT,
    qqpSystem: qqpVersion?.system_prompt ?? QQP_SYSTEM_PROMPT,
    qqpUserTemplate: qqpVersion?.user_template ?? QQP_USER_PROMPT_TEMPLATE,
    // Keep page classification and metadata from system_settings for now
    pageClassification: /* existing logic */,
    metadataUser: /* existing logic */,
    usingDefaults: {
      sqm: !sqmVersion,
      qqp: !qqpVersion,
      pageClassification: /* existing */,
      metadataUser: /* existing */,
    },
    // NEW: version IDs for tracking
    sqmVersionId: sqmVersion?.id ?? null,
    qqpVersionId: qqpVersion?.id ?? null,
  };
}
```

Update the `LoadedPrompts` type to include `sqmVersionId` and `qqpVersionId`.

- [ ] **Step 2: Update `prompt-keys.ts`**

Remove `PROMPT_SEPARATOR` export. Keep the keys for page classification and metadata (still in system_settings). Remove `prompt_sqm_extraction` and `prompt_qqp_extraction` from `PROMPT_KEYS`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/prompt-settings.ts src/lib/ai/prompt-keys.ts
git commit -m "feat: load SQM/QQP prompts from prompt_versions table"
```

---

## Task 8: Rewrite Model Prediction

**Files:**
- Modify: `src/lib/qqp/model-prediction.ts`

- [ ] **Step 1: Rewrite the module**

Replace `applyModelWeights()` and `flattenQQPValues()` with:

```typescript
import { predictRidge, type RidgeModel } from './ridge-regression';

/**
 * Predict finishing coefficient from QQP scores using a trained Ridge model.
 */
export function predictF(
  qqpScores: Record<string, number>,
  featureNames: string[],
  model: RidgeModel
): number {
  const x = featureNames.map(name => qqpScores[name] ?? 0);
  const raw = predictRidge(x, model);
  return Math.max(0.70, Math.min(1.50, raw));
}

/**
 * Extract score values from QQP extraction result (Claude API response) to a flat name→number map.
 * Input is the parsed JSON from Claude: each entry has {score, confidence, reasoning}.
 * This is used right after QQP extraction, before DB storage.
 */
export function flattenQQPScores(
  qqpValues: Record<string, { score: number; confidence?: number; reasoning?: string }> | undefined
): Record<string, number> {
  if (!qqpValues) return {};
  const out: Record<string, number> = {};
  for (const [name, data] of Object.entries(qqpValues)) {
    if (typeof data.score === 'number') out[name] = data.score;
  }
  return out;
}

/**
 * Load QQP scores from DB for a set of dossiers.
 * Reads from existing columns: value_numeric (score), confidence, extraction_notes (reasoning).
 * Returns structured objects for in-memory use.
 */
export function dbRowToScore(row: {
  value_numeric: number | null;
  confidence: number | null;
  extraction_notes: string | null;
}): { score: number; confidence: number; reasoning: string } {
  return {
    score: Number(row.value_numeric ?? 0),
    confidence: Number(row.confidence ?? 0),
    reasoning: row.extraction_notes ?? '',
  };
}

/**
 * Load active Ridge model from DB and convert to RidgeModel format.
 */
export async function loadActiveModel(
  admin: ReturnType<typeof import('@/lib/supabase/server').createSupabaseAdminClient>
): Promise<{ model: RidgeModel; featureNames: string[]; versionId: string } | null> {
  const { data } = await admin
    .from('qqp_model_versions')
    .select('id, weights, intercept, training_config')
    .eq('is_active', true)
    .maybeSingle();

  if (!data?.intercept || !data?.weights) return null;

  const weights = data.weights as Record<string, number>;
  const featureNames = (data.training_config as { feature_names?: string[] })?.feature_names
    ?? Object.keys(weights);

  return {
    model: {
      intercept: data.intercept,
      weights: featureNames.map(name => weights[name] ?? 0),
    },
    featureNames,
    versionId: data.id,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/qqp/model-prediction.ts
git commit -m "feat: rewrite model-prediction for Ridge format and new QQP scores"
```

---

## Task 9: Rewrite Weight Calibration (Training)

**Files:**
- Modify: `src/lib/qqp/weight-calibration.ts`

- [ ] **Step 1: Rewrite `calibrateWeights()` to use Ridge regression**

The function should:
1. Load analyzed dossiers with known costs and valid SQM data
2. Back-calculate `F_true` for each dossier (using `backcalculateF`)
3. Load QQP scores (new format) for each dossier
4. Build feature matrix X and target vector y
5. Cross-validate to find best lambda
6. Train final Ridge model
7. Store model version with intercept, weights, lambda, metrics, prompt_version_id

Key changes from current code:
- Replace Pearson correlations with `trainRidge()` and `crossValidateRidge()`
- Replace `known_price_per_sqm / nationalBasePrice` with proper `backcalculateF()`
- Read scores from `value_numeric` (now -1/+1 scores) instead of mixed boolean/numeric
- Store new columns: `intercept`, `lambda`, `prompt_version_id`, `training_config`
- Keep `shouldAutoCalibrate()` as-is (interval check logic is fine)

- [ ] **Step 2: Commit**

```bash
git add src/lib/qqp/weight-calibration.ts
git commit -m "feat: rewrite weight calibration to use Ridge regression with F back-calculation"
```

---

## Task 10: Update Estimate Pipeline

**Files:**
- Modify: `src/app/api/estimate-process/route.ts`

- [ ] **Step 1: Update QQP result parsing**

Find where QQP extraction results are parsed (around line 424). Change from:
```typescript
// OLD: { value: unknown; confidence?: number; notes?: string }
```
to:
```typescript
// NEW: { score: number; confidence?: number; reasoning?: string }
```

- [ ] **Step 2: Replace hardcoded F=1.0 with Ridge prediction**

Find the hardcoded `const finishingCoefficient = 1.0;` (around line 440). Replace with:

```typescript
import { loadActiveModel, flattenQQPScores, predictF } from '@/lib/qqp/model-prediction';

// After QQP extraction:
const qqpScores = flattenQQPScores(qqpResult.qqp_values);
const modelData = await loadActiveModel(admin);

let finishingCoefficient = 1.0; // fallback
let modelVersionId: string | null = null;

if (modelData) {
  finishingCoefficient = predictF(qqpScores, modelData.featureNames, modelData.model);
  modelVersionId = modelData.versionId;
}
```

- [ ] **Step 3: Store prompt_version_id with QQP values**

When writing QQP values to `dossier_qqp_values` (or estimation results), include the `prompt_version_id` from the loaded prompt settings.

- [ ] **Step 4: Test end-to-end locally**

Run `npm run dev`, upload a test plan to `/estimate`, verify:
- QQP extraction returns scores (-1 to +1)
- If no trained model: F = 1.0 (fallback)
- If trained model exists: F varies based on scores

- [ ] **Step 5: Commit**

```bash
git add src/app/api/estimate-process/route.ts
git commit -m "feat: use Ridge model prediction in estimate pipeline, parse new QQP format"
```

---

## Task 11: Update Process-Dossier Route

**Files:**
- Modify: `src/app/api/process-dossier/route.ts`

- [ ] **Step 1: Update QQP value storage**

Find where QQP values are written to `dossier_qqp_values`. Update to:
- Write `value_numeric = score` (the -1/+1 value)
- Set `value_boolean = null` (no longer used)
- Set `extraction_method = 'ai_extracted'`
- Set `prompt_version_id` from loaded prompt settings

- [ ] **Step 2: Commit**

```bash
git add src/app/api/process-dossier/route.ts
git commit -m "feat: update process-dossier to write new QQP score format"
```

---

## Task 12: Update Retroactive Extraction

**Files:**
- Modify: `src/lib/qqp/retroactive-extraction.ts`

- [ ] **Step 1: Update `extractOneQQP` to use new format**

Change the `RETROACTIVE_PROMPT` to request -1/+1 scores instead of raw values. Update the DB write from `value_numeric`/`value_boolean` to the new score format.

Change the row construction (lines 70-78) from:
```typescript
value_numeric: typeof parsed.value === "number" ? parsed.value : null,
value_boolean: typeof parsed.value === "boolean" ? parsed.value : null,
```
to:
```typescript
value_numeric: parsed.score, // -1.0 to +1.0
value_boolean: null,
extraction_method: 'ai_extracted',
```

Also update the prompt to ask for `{score, confidence, reasoning}` format.

- [ ] **Step 2: Commit**

```bash
git add src/lib/qqp/retroactive-extraction.ts
git commit -m "feat: update retroactive extraction for -1/+1 score format"
```

---

## Task 13: Update UI Components

**Files:**
- Modify: `src/components/dossiers/qqp-results.tsx`
- Modify: `src/components/estimate/results-view.tsx`
- Modify: `src/components/estimate/estimation-audit-view.tsx`
- Modify: `src/app/(dashboard)/admin/qqp/page.tsx`

- [ ] **Step 1: Update `qqp-results.tsx`**

Change `QQPValue` type (line 10-14):
```typescript
type QQPValue = {
  score: number;       // was: value: unknown
  confidence: number;
  reasoning?: string;  // was: notes?: string
};
```

Update `formatQQPValue()` (line 30-37): display score as formatted number with sign (+0.7, -0.3). Remove boolean check.

- [ ] **Step 2: Update `results-view.tsx`**

Find `QQPEntry` type and change `value: unknown` → `score: number`, `notes` → `reasoning`.
Remove `typeof v.value === "boolean"` checks (lines 403, 429). Display scores with sign and color coding (green for positive, red for negative, gray for near-zero).

- [ ] **Step 3: Update `estimation-audit-view.tsx`**

Change `QQPEntry` type (line 30):
```typescript
type QQPEntry = { score: number; confidence?: number; reasoning?: string };
```
Remove `typeof value === "boolean"` check (line 533).

- [ ] **Step 4: Update admin QQP page**

Update the QQP management page to display scores instead of boolean/numeric values. Show score as a colored bar (-1 red to +1 green).

- [ ] **Step 5: Test UI**

Run `npm run dev`, check each page:
- `/estimate` → results page shows scores correctly
- `/admin/dossiers` → dossier detail shows QQP scores
- `/admin/qqp` → QQP management shows score format

- [ ] **Step 6: Commit**

```bash
git add src/components/dossiers/qqp-results.tsx \
       src/components/estimate/results-view.tsx \
       src/components/estimate/estimation-audit-view.tsx \
       src/app/\(dashboard\)/admin/qqp/page.tsx
git commit -m "feat: update all UI components for -1/+1 QQP score format"
```

---

## Task 14: Run Data Migration + Train Initial Model

- [ ] **Step 1: Run the programmatic data conversion**

Call `migrateQQPValues()` repeatedly until all rows are converted. Can be done via a temporary API endpoint or script.

- [ ] **Step 2: Seed the new QQP prompt as version 2**

Insert the new QQP prompt (from Task 6) into `prompt_versions` as `qqp_extraction` version 2, `is_active = true`. Deactivate version 1.

- [ ] **Step 3: Train initial Ridge model**

Call `calibrateWeights()` to train the first Ridge model on converted data. Verify:
- Model version is created with intercept + 32 weights
- MAE and R² are reasonable
- Weights include both positive and negative values

- [ ] **Step 4: Verify end-to-end**

Upload a test plan to `/estimate`. Verify:
- F is NOT 1.0 (fallback) — the trained model is active
- F varies based on building characteristics
- F is somewhere in [0.70, 1.50], not always at extremes

- [ ] **Step 5: Commit any adjustments**

```bash
git add -A
git commit -m "feat: run data migration and train initial Ridge model"
```

---

## Task 15: Deploy and Verify

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

- [ ] **Step 2: Verify Vercel deployment**

Check build succeeds on Vercel. Test on production URL.

- [ ] **Step 3: Run migration on production Supabase**

Apply the `prompt_versions` migration to production if not already applied.

- [ ] **Step 4: Seed production prompts and run data migration**

Run the same seed + migration + training on production data.

- [ ] **Step 5: Final verification**

Upload a plan on production `/estimate` and verify F varies correctly.
