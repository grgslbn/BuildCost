/**
 * SQM confidence / sanity gating.
 *
 * Benchmark finding (2026-05-31, selectie building, 12 methods): autonomous SQM
 * measurement from bare PDF plans via vision is irreducibly unreliable (median
 * 24–46% error, occasional −96% / +156% outliers). The measurement accuracy
 * itself cannot be pushed below ~±20% with current tech — but the SYSTEM can be
 * made trustworthy by DETECTING implausible extractions and flagging them for
 * manual review instead of silently emitting a wrong number.
 *
 * This module applies cheap, deterministic physical sanity-checks to a finished
 * SQM extraction (no extra API calls) and returns a confidence level + reasons.
 * High confidence → use the number. Low → surface "manual check required".
 */

export type SqmConfidenceInput = {
  /** Gross livable (cat1) m² the extraction produced */
  cat1Sqm: number;
  /** Enclosed non-livable (cat2) m² */
  cat2Sqm: number;
  /** Outdoor (cat3) m² */
  cat3Sqm: number;
  /** Sum of net dwelling-unit areas read from labels, if available (Opp/BO) */
  netUnitSqmSum?: number | null;
  /** Number of dwelling units detected, if available */
  unitCount?: number | null;
  /** Number of building levels detected (from section/titles), if available */
  levelCount?: number | null;
  /** A TOTAL floor area printed on the plan/table (e.g. "Totale oppervlakte"), if read.
   *  Used only as an under-capture cross-check: if the summed extraction falls far
   *  below a stated total, capture is incomplete → downgrade. Never used to inflate. */
  statedTotalSqm?: number | null;
};

export type SqmConfidenceLevel = "high" | "medium" | "low";

export type SqmConfidenceResult = {
  level: SqmConfidenceLevel;
  score: number; // 0..1
  flags: string[]; // human-readable reasons for any downgrade
  needsManualReview: boolean;
};

/**
 * Deterministic physical plausibility checks. Each failing check downgrades
 * confidence. Thresholds are derived from the benchmark (apartment buildings).
 */
export function computeSqmConfidence(
  input: SqmConfidenceInput
): SqmConfidenceResult {
  const {
    cat1Sqm,
    cat2Sqm,
    cat3Sqm,
    netUnitSqmSum = null,
    unitCount = null,
    levelCount = null,
    statedTotalSqm = null,
  } = input;

  const flags: string[] = [];
  let score = 1.0;

  // 1. Absolute plausibility: a multi-unit building's livable area is rarely < 120 m².
  //    A near-zero cat1 on a real building is the classic catastrophic-fail signature.
  if (cat1Sqm < 80) {
    flags.push(`cat1 (${Math.round(cat1Sqm)} m²) onrealistisch laag — extractie waarschijnlijk mislukt`);
    score -= 0.6;
  }

  // 2. Physical rule: gross livable ≥ net unit-area sum (gross includes walls + circulation).
  //    If the measured cat1 is BELOW the sum of the net unit labels, the measurement is wrong.
  if (netUnitSqmSum != null && netUnitSqmSum > 0) {
    if (cat1Sqm < netUnitSqmSum * 0.98) {
      flags.push(`cat1 (${Math.round(cat1Sqm)}) < netto-units (${Math.round(netUnitSqmSum)}) — fysiek onmogelijk (bruto<netto)`);
      score -= 0.5;
    } else {
      // healthy gross/net ratio is ~1.1–1.7; outside that is suspicious
      const ratio = cat1Sqm / netUnitSqmSum;
      if (ratio > 1.9) {
        flags.push(`cat1/netto-ratio ${ratio.toFixed(2)} te hoog — mogelijk overmeten`);
        score -= 0.25;
      }
    }
  }

  // 3. Consistency with unit count: ~50–160 m² gross per dwelling unit is normal.
  if (unitCount != null && unitCount > 0) {
    const perUnit = cat1Sqm / unitCount;
    if (perUnit < 35) {
      flags.push(`${Math.round(perUnit)} m²/unit te laag voor ${unitCount} units — onder-gemeten of units fout geteld`);
      score -= 0.3;
    } else if (perUnit > 220) {
      flags.push(`${Math.round(perUnit)} m²/unit te hoog voor ${unitCount} units — over-gemeten of units gemist`);
      score -= 0.25;
    }
  }

  // 4. Tall building drawn on few sheets → floors likely missed. If levelCount is high
  //    but cat1 per level is tiny, flag.
  if (levelCount != null && levelCount >= 4) {
    const perLevel = cat1Sqm / levelCount;
    if (perLevel < 40) {
      flags.push(`${Math.round(perLevel)} m²/verdieping over ${levelCount} niveaus — verdiepingen vrijwel zeker gemist (ernstig)`);
      score -= 0.55;
    } else if (perLevel < 60) {
      flags.push(`${Math.round(perLevel)} m²/verdieping over ${levelCount} niveaus — verdiepingen waarschijnlijk gemist`);
      score -= 0.3;
    }
  }

  // 5. Category sanity: cat3 (terras) shouldn't dwarf cat1.
  if (cat1Sqm > 0 && cat3Sqm > cat1Sqm * 0.6) {
    flags.push(`terras (${Math.round(cat3Sqm)}) groot t.o.v. woon (${Math.round(cat1Sqm)}) — categorisatie nazien`);
    score -= 0.15;
  }

  // 6. Stated-total cross-check (under-capture detector). When the plan/table prints a
  //    TOTAL floor area, the summed extraction should be in its ballpark. A big shortfall
  //    means floors/units were missed (the classic Tier-2 failure on big/mixed bundles).
  //    Conservative: only PENALISE a shortfall; never inflate confidence on a match.
  if (statedTotalSqm != null && statedTotalSqm > 50) {
    const captured = cat1Sqm + cat2Sqm + cat3Sqm;
    const ratio = captured / statedTotalSqm;
    if (ratio < 0.7) {
      flags.push(`gevonden ${Math.round(captured)} m² << vermeld totaal ${Math.round(statedTotalSqm)} m² (${Math.round(ratio * 100)}%) — capture onvolledig`);
      score -= 0.45;
    } else if (ratio < 0.85) {
      flags.push(`gevonden ${Math.round(captured)} m² onder vermeld totaal ${Math.round(statedTotalSqm)} m² (${Math.round(ratio * 100)}%) — mogelijk onvolledig`);
      score -= 0.2;
    } else if (ratio > 1.3) {
      flags.push(`gevonden ${Math.round(captured)} m² boven vermeld totaal ${Math.round(statedTotalSqm)} m² (${Math.round(ratio * 100)}%) — mogelijke dubbeltelling`);
      score -= 0.2;
    }
  }

  score = Math.max(0, Math.min(1, score));
  const level: SqmConfidenceLevel = score >= 0.75 ? "high" : score >= 0.5 ? "medium" : "low";

  return {
    level,
    score: Math.round(score * 100) / 100,
    flags,
    needsManualReview: level === "low",
  };
}
