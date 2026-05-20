export type AreaCategory = "CAT1" | "CAT2" | "CAT3" | "EXCLUDED";

// Legacy room-to-category mapping (for old format compatibility)
const CATEGORY_MAP: Record<string, AreaCategory> = {
  living: "CAT1",
  bedroom: "CAT1",
  bathroom: "CAT1",
  toilet: "CAT1",
  kitchen: "CAT1",
  dining: "CAT1",
  office: "CAT1",
  hallway: "CAT1",
  stairs: "CAT1",
  dressing: "CAT1",
  laundry: "CAT1",
  wellness: "CAT1",
  other: "CAT1",
  utility: "CAT2",
  garage: "CAT2",
  storage: "CAT2",
  terrace: "CAT3",
  balcony: "CAT3",
  garden: "EXCLUDED",
};

export type AreaBreakdown = {
  cat1_sqm: number;
  cat2_sqm: number;
  cat3_sqm: number;
};

// ── v11b format types ──────────────────────────────────────────────────────

type V11bFloor = {
  cat1_sqm?: number;
  cat2_sqm?: number;
  cat3_sqm?: number;
};

type V11bBuilding = {
  floors?: V11bFloor[];
  building_totals?: {
    cat1_sqm?: number;
    cat2_sqm?: number;
    cat3_sqm?: number;
  };
};

type V11bData = {
  buildings?: V11bBuilding[];
  project_totals?: {
    total_cat1_sqm?: number;
    total_cat2_sqm?: number;
    total_cat3_sqm?: number;
  };
};

// ── Legacy format types ────────────────────────────────────────────────────

type LegacyRoom = {
  area_sqm: number;
  category?: string;
};

type LegacyFloor = {
  rooms: LegacyRoom[];
};

type LegacyData = {
  floors?: LegacyFloor[];
  summary?: {
    total_livable_sqm?: number;
    total_sqm?: number;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqmExtractionData = Record<string, any>;

/**
 * Detect whether the extraction data uses v11b format.
 * v11b has `buildings[]` with per-floor cat1/cat2/cat3, or `project_totals`.
 */
function isV11bFormat(data: SqmExtractionData): boolean {
  return !!(data?.buildings || data?.project_totals);
}

/**
 * Extract area breakdown from SQM extraction data.
 * Supports both v11b format (buildings/project_totals) and legacy format (floors/rooms).
 */
export function categorizeAreas(sqmData: SqmExtractionData): AreaBreakdown {
  if (!sqmData) return { cat1_sqm: 0, cat2_sqm: 0, cat3_sqm: 0 };

  // ── v11b format: read project_totals or sum buildings ──────────────────
  if (isV11bFormat(sqmData)) {
    const d = sqmData as V11bData;

    // Prefer project_totals (pre-summed)
    if (d.project_totals) {
      return {
        cat1_sqm: d.project_totals.total_cat1_sqm ?? 0,
        cat2_sqm: d.project_totals.total_cat2_sqm ?? 0,
        cat3_sqm: d.project_totals.total_cat3_sqm ?? 0,
      };
    }

    // Fallback: sum building_totals across buildings
    if (d.buildings && d.buildings.length > 0) {
      const breakdown: AreaBreakdown = { cat1_sqm: 0, cat2_sqm: 0, cat3_sqm: 0 };
      for (const bldg of d.buildings) {
        if (bldg.building_totals) {
          breakdown.cat1_sqm += bldg.building_totals.cat1_sqm ?? 0;
          breakdown.cat2_sqm += bldg.building_totals.cat2_sqm ?? 0;
          breakdown.cat3_sqm += bldg.building_totals.cat3_sqm ?? 0;
        } else if (bldg.floors) {
          // Sum from individual floors
          for (const floor of bldg.floors) {
            breakdown.cat1_sqm += floor.cat1_sqm ?? 0;
            breakdown.cat2_sqm += floor.cat2_sqm ?? 0;
            breakdown.cat3_sqm += floor.cat3_sqm ?? 0;
          }
        }
      }
      return breakdown;
    }

    return { cat1_sqm: 0, cat2_sqm: 0, cat3_sqm: 0 };
  }

  // ── Legacy format: iterate floors[].rooms[] ────────────────────────────
  const legacy = sqmData as LegacyData;
  const floors = legacy?.floors;

  if (floors && floors.length > 0) {
    const breakdown: AreaBreakdown = { cat1_sqm: 0, cat2_sqm: 0, cat3_sqm: 0 };
    for (const floor of floors) {
      for (const room of floor.rooms ?? []) {
        const cat = CATEGORY_MAP[room.category ?? "other"] ?? "CAT1";
        const area = room.area_sqm ?? 0;
        if (cat === "CAT1") breakdown.cat1_sqm += area;
        else if (cat === "CAT2") breakdown.cat2_sqm += area;
        else if (cat === "CAT3") breakdown.cat3_sqm += area;
      }
    }
    return breakdown;
  }

  // Fallback: use summary totals, put everything in CAT1
  const livable = legacy?.summary?.total_livable_sqm ?? legacy?.summary?.total_sqm ?? 0;
  return { cat1_sqm: livable, cat2_sqm: 0, cat3_sqm: 0 };
}

/**
 * Extract total gross sqm from SQM extraction data (for display purposes).
 * Returns cat1 + cat2 (enclosed area), which is the insurance-relevant total.
 */
export function getTotalGrossSqm(sqmData: SqmExtractionData): number | null {
  if (!sqmData) return null;
  const areas = categorizeAreas(sqmData);
  const total = areas.cat1_sqm + areas.cat2_sqm;
  return total > 0 ? total : null;
}

/**
 * Extract apartment/unit count from SQM extraction data.
 */
export function getUnitCount(sqmData: SqmExtractionData): number | null {
  if (!sqmData) return null;

  // v11b: sum unit_count across buildings
  if (isV11bFormat(sqmData)) {
    const d = sqmData as V11bData;
    if (d.buildings && d.buildings.length > 0) {
      let total = 0;
      for (const bldg of d.buildings) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unitCount = (bldg as any).unit_count;
        if (typeof unitCount === "number" && unitCount > 0) total += unitCount;
      }
      return total > 0 ? total : null;
    }
    return null;
  }

  // Legacy: read from summary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacy = sqmData as any;
  return legacy?.summary?.apartment_count ?? null;
}

/**
 * Extract building type from SQM extraction data.
 */
export function getBuildingType(sqmData: SqmExtractionData): string | null {
  if (!sqmData) return null;

  // v11b: use first building's type
  if (isV11bFormat(sqmData)) {
    const d = sqmData as V11bData;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstType = (d.buildings as any)?.[0]?.type;
    if (firstType === "apartment_block") return "apartment_building";
    return firstType ?? null;
  }

  // Legacy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (sqmData as any)?.building_type?.primary ?? null;
}
