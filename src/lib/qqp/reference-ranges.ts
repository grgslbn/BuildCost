/**
 * QQP Reference Ranges
 *
 * Single source of truth for:
 * 1. Programmatic conversion of old boolean/numeric QQP data to -1/+1 scores
 * 2. Generating scoring guidance in the QQP extraction prompt
 *
 * Each QQP defines reference points that map raw values to scores in [-1, +1],
 * where 0.0 = average Belgian new-build.
 */

export type QQPRange = {
  name: string;
  dataType: "numeric" | "boolean" | "ratio" | "score";
  /** For numeric: interpolation points mapping raw value → score */
  referencePoints?: { value: number; score: number }[];
  /** For boolean: score when true/false */
  booleanScores?: { whenTrue: number; whenFalse: number };
  /** Human-readable scoring guide for the QQP extraction prompt */
  promptGuide: string;
};

// ─── A. SIZE & LAYOUT (1–11) ──────────────────────────────────────────────

const SIZE_LAYOUT: Record<string, QQPRange> = {
  total_livable_sqm: {
    name: "total_livable_sqm",
    dataType: "numeric",
    referencePoints: [
      { value: 60, score: -1.0 },
      { value: 100, score: -0.5 },
      { value: 150, score: 0.0 },
      { value: 220, score: 0.5 },
      { value: 300, score: 1.0 },
    ],
    promptGuide:
      "Reference: <60m²=-1.0, 100m²=-0.5, 150m²=0.0, 220m²=+0.5, 300m²+=+1.0",
  },
  entrance_hall_sqm: {
    name: "entrance_hall_sqm",
    dataType: "numeric",
    referencePoints: [
      { value: 2, score: -1.0 },
      { value: 4, score: -0.5 },
      { value: 6, score: 0.0 },
      { value: 10, score: 0.5 },
      { value: 15, score: 1.0 },
    ],
    promptGuide:
      "Reference: <2m²=-1.0, 4m²=-0.5, 6m²=0.0, 10m²=+0.5, 15m²+=+1.0",
  },
  living_room_sqm: {
    name: "living_room_sqm",
    dataType: "numeric",
    referencePoints: [
      { value: 15, score: -1.0 },
      { value: 25, score: -0.5 },
      { value: 35, score: 0.0 },
      { value: 50, score: 0.5 },
      { value: 70, score: 1.0 },
    ],
    promptGuide:
      "Reference: <15m²=-1.0, 25m²=-0.5, 35m²=0.0, 50m²=+0.5, 70m²+=+1.0",
  },
  kitchen_sqm: {
    name: "kitchen_sqm",
    dataType: "numeric",
    referencePoints: [
      { value: 5, score: -1.0 },
      { value: 8, score: -0.5 },
      { value: 10, score: 0.0 },
      { value: 15, score: 0.5 },
      { value: 20, score: 1.0 },
    ],
    promptGuide:
      "Reference: <5m²=-1.0, 8m²=-0.5, 10m²=0.0, 15m²=+0.5, 20m²+=+1.0\nNegative signal: kitchenette without full kitchen = -1.0",
  },
  master_bedroom_sqm: {
    name: "master_bedroom_sqm",
    dataType: "numeric",
    referencePoints: [
      { value: 9, score: -1.0 },
      { value: 12, score: -0.5 },
      { value: 15, score: 0.0 },
      { value: 20, score: 0.5 },
      { value: 28, score: 1.0 },
    ],
    promptGuide:
      "Reference: <9m²=-1.0, 12m²=-0.5, 15m²=0.0, 20m²=+0.5, 28m²+=+1.0",
  },
  avg_bedroom_sqm: {
    name: "avg_bedroom_sqm",
    dataType: "numeric",
    referencePoints: [
      { value: 8, score: -1.0 },
      { value: 10, score: -0.5 },
      { value: 12, score: 0.0 },
      { value: 16, score: 0.5 },
      { value: 22, score: 1.0 },
    ],
    promptGuide:
      "Reference: <8m²=-1.0, 10m²=-0.5, 12m²=0.0, 16m²=+0.5, 22m²+=+1.0",
  },
  largest_bathroom_sqm: {
    name: "largest_bathroom_sqm",
    dataType: "numeric",
    referencePoints: [
      { value: 3, score: -1.0 },
      { value: 5, score: -0.5 },
      { value: 7, score: 0.0 },
      { value: 10, score: 0.5 },
      { value: 15, score: 1.0 },
    ],
    promptGuide:
      "Reference: <3m²=-1.0, 5m²=-0.5, 7m²=0.0, 10m²=+0.5, 15m²+=+1.0\nNegative signal: only a small shower room (<3m²) = -1.0",
  },
  garage_sqm: {
    name: "garage_sqm",
    dataType: "numeric",
    referencePoints: [
      { value: 0, score: -0.5 },
      { value: 15, score: 0.0 },
      { value: 25, score: 0.3 },
      { value: 40, score: 0.7 },
      { value: 60, score: 1.0 },
    ],
    promptGuide:
      "Reference: none=-0.5, 15m²=0.0, 25m²=+0.3, 40m²=+0.7, 60m²+=+1.0\nNegative signal: no garage at all in a villa = -0.5",
  },
  terrace_balcony_sqm: {
    name: "terrace_balcony_sqm",
    dataType: "numeric",
    referencePoints: [
      { value: 0, score: -0.5 },
      { value: 5, score: -0.2 },
      { value: 15, score: 0.0 },
      { value: 30, score: 0.5 },
      { value: 50, score: 1.0 },
    ],
    promptGuide:
      "Reference: none=-0.5, 5m²=-0.2, 15m²=0.0, 30m²=+0.5, 50m²+=+1.0",
  },
  circulation_ratio: {
    name: "circulation_ratio",
    dataType: "ratio",
    referencePoints: [
      { value: 0.05, score: -1.0 },
      { value: 0.1, score: -0.5 },
      { value: 0.15, score: 0.0 },
      { value: 0.2, score: 0.5 },
      { value: 0.3, score: 1.0 },
    ],
    promptGuide:
      "Reference: <5%=-1.0, 10%=-0.5, 15%=0.0, 20%=+0.5, 30%+=+1.0\nGenerous hallways/landings = higher finish",
  },
  floor_count: {
    name: "floor_count",
    dataType: "numeric",
    referencePoints: [
      { value: 1, score: -0.3 },
      { value: 2, score: 0.0 },
      { value: 3, score: 0.3 },
      { value: 4, score: 0.7 },
    ],
    promptGuide: "Reference: 1 floor=-0.3, 2=0.0, 3=+0.3, 4+=+0.7",
  },
};

// ─── B. ROOM COUNT & COMPOSITION (12–22) ──────────────────────────────────

const ROOM_COUNT: Record<string, QQPRange> = {
  bedroom_count: {
    name: "bedroom_count",
    dataType: "numeric",
    referencePoints: [
      { value: 1, score: -0.5 },
      { value: 2, score: -0.2 },
      { value: 3, score: 0.0 },
      { value: 4, score: 0.3 },
      { value: 5, score: 0.7 },
    ],
    promptGuide: "Reference: 1=-0.5, 2=-0.2, 3=0.0, 4=+0.3, 5+=+0.7",
  },
  bathroom_count: {
    name: "bathroom_count",
    dataType: "numeric",
    referencePoints: [
      { value: 1, score: -0.5 },
      { value: 1.5, score: 0.0 },
      { value: 2, score: 0.3 },
      { value: 3, score: 0.7 },
      { value: 4, score: 1.0 },
    ],
    promptGuide:
      "Reference: 1=-0.5, 1.5=0.0, 2=+0.3, 3=+0.7, 4+=+1.0\nStrong quality signal",
  },
  toilet_count: {
    name: "toilet_count",
    dataType: "numeric",
    referencePoints: [
      { value: 1, score: -0.3 },
      { value: 2, score: 0.0 },
      { value: 3, score: 0.5 },
      { value: 4, score: 1.0 },
    ],
    promptGuide: "Reference: 1=-0.3, 2=0.0, 3=+0.5, 4+=+1.0",
  },
  bathroom_per_bedroom_ratio: {
    name: "bathroom_per_bedroom_ratio",
    dataType: "ratio",
    referencePoints: [
      { value: 0.3, score: -1.0 },
      { value: 0.5, score: -0.3 },
      { value: 0.67, score: 0.0 },
      { value: 0.8, score: 0.5 },
      { value: 1.0, score: 1.0 },
    ],
    promptGuide:
      "Reference: 0.3=-1.0, 0.5=-0.3, 0.67=0.0, 0.8=+0.5, 1.0+=+1.0\nStrong quality signal: en-suite bathrooms",
  },
  has_separate_dining: {
    name: "has_separate_dining",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.5, whenFalse: 0.0 },
    promptGuide:
      "Absent=0.0, present=+0.5\nNote: open-plan living/dining is neutral (0.0), separate formal dining is +0.5",
  },
  has_office: {
    name: "has_office",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.5, whenFalse: 0.0 },
    promptGuide: "Absent=0.0, dedicated office/study=+0.5",
  },
  has_dressing: {
    name: "has_dressing",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.5, whenFalse: 0.0 },
    promptGuide:
      "Absent + small bedrooms=-0.5, absent + spacious bedrooms=0.0, present=+0.7, large dressing=+1.0\nStrong luxury signal",
  },
  has_laundry_room: {
    name: "has_laundry_room",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.5, whenFalse: 0.0 },
    promptGuide: "Absent=0.0, dedicated laundry room=+0.5",
  },
  has_wellness: {
    name: "has_wellness",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.8, whenFalse: 0.0 },
    promptGuide:
      "Absent=0.0, present (sauna/pool/spa)=+0.8\nVery strong luxury signal",
  },
  has_basement: {
    name: "has_basement",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.3, whenFalse: 0.0 },
    promptGuide: "Absent=0.0, present=+0.3",
  },
  has_garage: {
    name: "has_garage",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.3, whenFalse: 0.0 },
    promptGuide: "Absent=0.0, present=+0.3",
  },
};

// ─── C. EQUIPMENT & FEATURES (23–28) ─────────────────────────────────────

const EQUIPMENT: Record<string, QQPRange> = {
  kitchen_appliance_count: {
    name: "kitchen_appliance_count",
    dataType: "numeric",
    referencePoints: [
      { value: 0, score: -1.0 },
      { value: 2, score: -0.3 },
      { value: 4, score: 0.0 },
      { value: 6, score: 0.5 },
      { value: 8, score: 1.0 },
    ],
    promptGuide:
      "Reference: 0=-1.0, 2=-0.3, 4=0.0, 6=+0.5, 8+=+1.0\nCount: oven, dishwasher, fridge, microwave, steamer, wine fridge, island, induction",
  },
  has_kitchen_island: {
    name: "has_kitchen_island",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.6, whenFalse: 0.0 },
    promptGuide:
      "Absent=0.0, present=+0.6\nStrong quality signal in combination with open kitchen",
  },
  bathroom_luxury_score: {
    name: "bathroom_luxury_score",
    dataType: "score",
    referencePoints: [
      { value: 1, score: -1.0 },
      { value: 3, score: -0.3 },
      { value: 5, score: 0.0 },
      { value: 7, score: 0.5 },
      { value: 10, score: 1.0 },
    ],
    promptGuide:
      "Reference: 1=-1.0, 3=-0.3, 5=0.0, 7=+0.5, 10=+1.0\nScoring: bath(+2) shower(+1) double_sink(+2) bidet(+1) jacuzzi(+3) heated_floor(+1), normalized per bathroom",
  },
  has_fireplace: {
    name: "has_fireplace",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.5, whenFalse: 0.0 },
    promptGuide: "Absent=0.0, present=+0.5",
  },
  has_open_kitchen: {
    name: "has_open_kitchen",
    dataType: "boolean",
    booleanScores: { whenTrue: 0.4, whenFalse: 0.0 },
    promptGuide: "Closed kitchen=0.0, open to living=+0.4 (modern style signal)",
  },
  built_in_storage_count: {
    name: "built_in_storage_count",
    dataType: "numeric",
    referencePoints: [
      { value: 0, score: -0.5 },
      { value: 2, score: 0.0 },
      { value: 4, score: 0.3 },
      { value: 6, score: 0.6 },
      { value: 10, score: 1.0 },
    ],
    promptGuide:
      "Reference: 0=-0.5, 2=0.0, 4=+0.3, 6=+0.6, 10+=+1.0\nBuilt-in closets and storage units visible on plan",
  },
};

// ─── D. PROPORTIONALITY (29–32) ──────────────────────────────────────────

const PROPORTIONALITY: Record<string, QQPRange> = {
  living_to_total_ratio: {
    name: "living_to_total_ratio",
    dataType: "ratio",
    referencePoints: [
      { value: 0.15, score: -0.5 },
      { value: 0.2, score: 0.0 },
      { value: 0.25, score: 0.3 },
      { value: 0.35, score: 0.0 },
      { value: 0.5, score: -0.3 },
    ],
    promptGuide:
      "Reference: 15%=-0.5, 20%=0.0, 25%=+0.3, 35%=0.0, 50%=-0.3\nSweet spot ~25%. Very high ratio may mean fewer rooms",
  },
  wet_room_to_total_ratio: {
    name: "wet_room_to_total_ratio",
    dataType: "ratio",
    referencePoints: [
      { value: 0.1, score: -0.5 },
      { value: 0.15, score: 0.0 },
      { value: 0.2, score: 0.3 },
      { value: 0.25, score: 0.6 },
      { value: 0.35, score: 1.0 },
    ],
    promptGuide:
      "Reference: 10%=-0.5, 15%=0.0, 20%=+0.3, 25%=+0.6, 35%+=+1.0\n(bathrooms + kitchen + laundry) / total livable",
  },
  outdoor_to_indoor_ratio: {
    name: "outdoor_to_indoor_ratio",
    dataType: "ratio",
    referencePoints: [
      { value: 0, score: -0.5 },
      { value: 0.05, score: 0.0 },
      { value: 0.1, score: 0.3 },
      { value: 0.2, score: 0.6 },
      { value: 0.35, score: 1.0 },
    ],
    promptGuide:
      "Reference: 0=-0.5, 5%=0.0, 10%=+0.3, 20%=+0.6, 35%+=+1.0\nOutdoor m² / livable m²",
  },
  avg_room_size: {
    name: "avg_room_size",
    dataType: "numeric",
    referencePoints: [
      { value: 10, score: -1.0 },
      { value: 14, score: -0.5 },
      { value: 18, score: 0.0 },
      { value: 24, score: 0.5 },
      { value: 32, score: 1.0 },
    ],
    promptGuide:
      "Reference: 10m²=-1.0, 14m²=-0.5, 18m²=0.0, 24m²=+0.5, 32m²+=+1.0\nTotal livable / room count",
  },
};

// ─── Combined export ─────────────────────────────────────────────────────

export const QQP_REFERENCE_RANGES: Record<string, QQPRange> = {
  ...SIZE_LAYOUT,
  ...ROOM_COUNT,
  ...EQUIPMENT,
  ...PROPORTIONALITY,
};

/** All QQP names in definition order */
export const QQP_NAMES = Object.keys(QQP_REFERENCE_RANGES);

// ─── Score conversion ────────────────────────────────────────────────────

/**
 * Linearly interpolate a raw value into a score using reference points.
 * Clamps to the edge scores if value is out of range.
 */
function interpolateScore(
  value: number,
  points: { value: number; score: number }[]
): number {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  if (value <= sorted[0].value) return sorted[0].score;
  if (value >= sorted[sorted.length - 1].value)
    return sorted[sorted.length - 1].score;

  for (let i = 0; i < sorted.length - 1; i++) {
    if (value >= sorted[i].value && value <= sorted[i + 1].value) {
      const t =
        (value - sorted[i].value) / (sorted[i + 1].value - sorted[i].value);
      return sorted[i].score + t * (sorted[i + 1].score - sorted[i].score);
    }
  }
  return 0;
}

/**
 * Convert an old-format QQP value (boolean or numeric) to a -1/+1 score.
 * Uses reference ranges for interpolation.
 *
 * Returns 0 (neutral) for unknown QQPs or null values.
 */
export function convertToScore(
  qqpName: string,
  value: number | boolean | null
): number {
  if (value === null || value === undefined) return 0;

  const range = QQP_REFERENCE_RANGES[qqpName];
  if (!range) return 0;

  if (typeof value === "boolean") {
    return value
      ? (range.booleanScores?.whenTrue ?? 0.5)
      : (range.booleanScores?.whenFalse ?? 0.0);
  }

  if (range.referencePoints && range.referencePoints.length >= 2) {
    return interpolateScore(value, range.referencePoints);
  }

  return 0;
}
