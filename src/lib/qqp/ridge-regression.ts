/**
 * Pure TypeScript Ridge regression — no external ML libraries.
 *
 * Algorithm: w = (XᵀX + λI)⁻¹ Xᵀy
 * Matrix inversion via Gauss-Jordan elimination with partial pivoting.
 *
 * Used to train the finishing coefficient (F) model from QQP scores.
 */

export type RidgeModel = {
  intercept: number;
  weights: number[];
};

/**
 * Train a Ridge regression model.
 *
 * @param X - Feature matrix: n_samples × n_features
 * @param y - Target vector: n_samples
 * @param lambda - L2 regularization strength (≥ 0)
 * @returns Trained model with intercept and weights
 */
export function trainRidge(
  X: number[][],
  y: number[],
  lambda: number
): RidgeModel {
  const n = X.length;
  const p = X[0].length;

  // 1. Center X and y (subtract means)
  const xMeans = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) xMeans[j] += X[i][j];
    xMeans[j] /= n;
  }
  const yMean = y.reduce((a, b) => a + b, 0) / n;

  const Xc = X.map((row) => row.map((v, j) => v - xMeans[j]));
  const yc = y.map((v) => v - yMean);

  // 2. Compute XᵀX + λI
  const XtX: number[][] = Array.from({ length: p }, () =>
    new Array(p).fill(0)
  );
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += Xc[k][i] * Xc[k][j];
      XtX[i][j] = s + (i === j ? lambda : 0);
    }
  }

  // 3. Compute Xᵀy
  const Xty = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < n; i++) Xty[j] += Xc[i][j] * yc[i];
  }

  // 4. Solve (XᵀX + λI)w = Xᵀy via Gauss-Jordan
  const weights = solveLinearSystem(XtX, Xty);

  // 5. intercept = mean(y) - Σ(wⱼ × mean(Xⱼ))
  let intercept = yMean;
  for (let j = 0; j < p; j++) intercept -= weights[j] * xMeans[j];

  return { intercept, weights };
}

/**
 * Predict using a trained Ridge model.
 *
 * @param x - Feature vector (missing features default to 0)
 * @param model - Trained Ridge model
 * @returns Predicted value (not clamped — caller decides clamping)
 */
export function predictRidge(x: number[], model: RidgeModel): number {
  let result = model.intercept;
  for (let j = 0; j < model.weights.length; j++) {
    result += model.weights[j] * (x[j] ?? 0);
  }
  return result;
}

export type CVResult = {
  bestLambda: number;
  /** lambda → mean MSE across folds */
  scores: Record<number, number>;
};

/**
 * K-fold cross-validation to select the best λ.
 *
 * @param X - Feature matrix
 * @param y - Target vector
 * @param lambdas - Candidate λ values to evaluate
 * @param folds - Number of CV folds (default 5)
 * @returns Best λ and all scores
 */
export function crossValidateRidge(
  X: number[][],
  y: number[],
  lambdas: number[],
  folds: number = 5
): CVResult {
  const n = X.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  // Deterministic fold assignment (round-robin)
  const foldAssignment = indices.map((i) => i % folds);

  const scores: Record<number, number> = {};

  for (const lambda of lambdas) {
    let totalMSE = 0;

    for (let fold = 0; fold < folds; fold++) {
      const trainIdx = indices.filter((i) => foldAssignment[i] !== fold);
      const testIdx = indices.filter((i) => foldAssignment[i] === fold);

      const Xtrain = trainIdx.map((i) => X[i]);
      const ytrain = trainIdx.map((i) => y[i]);
      const Xtest = testIdx.map((i) => X[i]);
      const ytest = testIdx.map((i) => y[i]);

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

/**
 * Gauss-Jordan elimination with partial pivoting to solve Ax = b.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  // Build augmented matrix [A|b]
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting: find row with largest absolute value in column
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue; // near-singular, skip

    // Scale pivot row
    for (let j = col; j <= n; j++) aug[col][j] /= pivot;

    // Eliminate column in all other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  return aug.map((row) => row[n]);
}
