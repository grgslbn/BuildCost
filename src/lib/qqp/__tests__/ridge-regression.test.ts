import { describe, it, expect } from "vitest";
import {
  trainRidge,
  predictRidge,
  crossValidateRidge,
} from "../ridge-regression";

describe("trainRidge", () => {
  it("recovers weights from a perfect linear relationship", () => {
    // y = 1.0 + 0.5*x1 - 0.3*x2
    const X = [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [0, 2],
      [2, 1],
      [1, 2],
      [3, 0],
      [0, 3],
      [2, 2],
    ];
    const y = X.map(([x1, x2]) => 1.0 + 0.5 * x1 - 0.3 * x2);
    const model = trainRidge(X, y, 0.001);
    expect(model.intercept).toBeCloseTo(1.0, 1);
    expect(model.weights[0]).toBeCloseTo(0.5, 1);
    expect(model.weights[1]).toBeCloseTo(-0.3, 1);
  });

  it("regularization shrinks weights toward zero", () => {
    const X = [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 0],
      [0, 2],
    ];
    const y = X.map(([x1, x2]) => 1.0 + 0.5 * x1 - 0.3 * x2);
    const weak = trainRidge(X, y, 0.001);
    const strong = trainRidge(X, y, 100);
    expect(Math.abs(strong.weights[0])).toBeLessThan(
      Math.abs(weak.weights[0])
    );
  });

  it("handles single-feature input", () => {
    // y = 2.0 + 3.0*x
    const X = [[1], [2], [3], [4], [5]];
    const y = X.map(([x]) => 2.0 + 3.0 * x);
    const model = trainRidge(X, y, 0.001);
    expect(model.intercept).toBeCloseTo(2.0, 0);
    expect(model.weights[0]).toBeCloseTo(3.0, 0);
  });
});

describe("predictRidge", () => {
  it("uses intercept + dot product", () => {
    const model = { intercept: 1.0, weights: [0.5, -0.3] };
    // 1.0 + 0.5*2 + (-0.3)*1 = 1.0 + 1.0 - 0.3 = 1.7
    expect(predictRidge([2, 1], model)).toBeCloseTo(1.7, 2);
  });

  it("handles missing features as 0", () => {
    const model = { intercept: 1.0, weights: [0.5, -0.3, 0.2] };
    // Only 2 features provided, 3rd defaults to 0
    expect(predictRidge([2, 1], model)).toBeCloseTo(1.7, 2);
  });
});

describe("crossValidateRidge", () => {
  it("selects best lambda from candidates", () => {
    const X = Array.from({ length: 50 }, (_, i) => [
      Math.sin(i),
      Math.cos(i),
    ]);
    const y = X.map(([x1, x2]) => 1.0 + 0.4 * x1 - 0.2 * x2);
    const result = crossValidateRidge(
      X,
      y,
      [0.001, 0.01, 0.1, 1, 10, 100],
      5
    );
    expect(result.bestLambda).toBeDefined();
    expect(result.scores).toBeDefined();
    // With perfect data, small lambda should win
    expect(result.bestLambda).toBeLessThan(1);
  });

  it("returns MSE scores for all lambda candidates", () => {
    const X = Array.from({ length: 30 }, (_, i) => [i / 10, (i * 3) / 10]);
    const y = X.map(([x1, x2]) => 2.0 + x1 - 0.5 * x2);
    const lambdas = [0.01, 0.1, 1, 10];
    const result = crossValidateRidge(X, y, lambdas, 3);
    expect(Object.keys(result.scores).length).toBe(4);
    for (const l of lambdas) {
      expect(result.scores[l]).toBeGreaterThanOrEqual(0);
    }
  });
});
