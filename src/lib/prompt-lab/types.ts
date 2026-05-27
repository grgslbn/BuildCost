// src/lib/benchmark/types.ts

// ── Ground Truth ────────────────────────────────────────────────────

export type GroundTruth = {
  id: string;
  dossier_id: string;
  expert_total_price: number | null;
  expert_cat1_sqm: number | null;
  expert_cat2_sqm: number | null;
  expert_cat3_sqm: number | null;
  expert_total_sqm: number | null;
  expert_finishing_level: string | null;
  extraction_confidence: number | null;
  verified: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ── Evaluation Run ──────────────────────────────────────────────────

export type EvaluationRun = {
  id: string;
  name: string;
  sqm_prompt_version_id: string | null;
  qqp_prompt_version_id: string | null;
  model_version_id: string | null;
  dossier_count: number;
  subset_mode: string;
  metrics: RunMetrics | null;
  status: "running" | "complete" | "failed";
  started_at: string;
  completed_at: string | null;
  notes: string | null;
};

// ── Evaluation Result ───────────────────────────────────────────────

export type EvaluationResult = {
  id: string;
  run_id: string;
  dossier_id: string;
  // SQM
  extracted_cat1_sqm: number | null;
  extracted_cat2_sqm: number | null;
  extracted_cat3_sqm: number | null;
  sqm_extraction: unknown;
  cat1_error_pct: number | null;
  cat2_error_pct: number | null;
  cat3_error_pct: number | null;
  // QQP / F
  extracted_qqps: unknown;
  predicted_f: number | null;
  expert_f: number | null;
  f_error: number | null;
  // Cost
  predicted_total_cost: number | null;
  cost_error_pct: number | null;
  // Meta
  processing_time_ms: number | null;
  error_message: string | null;
  created_at: string;
};

// ── Aggregate Metrics ───────────────────────────────────────────────

export type RunMetrics = {
  cost_mae_pct: number;
  cost_median_pct: number;
  cost_worst_pct: number;
  cost_within_10_pct: number;
  cost_within_15_pct: number;
  cat1_mae_pct: number;
  cat2_mae_pct: number;
  cat3_mae_pct: number;
  f_mae: number;
  f_median: number;
  dossiers_succeeded: number;
  dossiers_failed: number;
};

// ── Extracted Ground Truth (from AI) ────────────────────────────────

export type ExtractedGroundTruth = {
  expert_total_price: number | null;
  expert_cat1_sqm: number | null;
  expert_cat2_sqm: number | null;
  expert_cat3_sqm: number | null;
  expert_finishing_level: string | null;
  confidence: number;
};

// ── Annotation ─────────────────────────────────────────────────────

export const ANNOTATION_CATEGORIES = [
  "general",
  "vision_limit",
  "prompt_issue",
  "classifier_error",
  "scale_error",
  "room_missing",
  "room_extra",
  "qqp_error",
  "ground_truth_error",
] as const;

export type AnnotationCategory = (typeof ANNOTATION_CATEGORIES)[number];

export type BenchmarkAnnotation = {
  id: string;
  dossier_id: string;
  run_id: string | null;
  category: AnnotationCategory;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
