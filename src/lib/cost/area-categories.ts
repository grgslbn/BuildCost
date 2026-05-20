export type AreaCategory = "CAT1" | "CAT2" | "CAT3" | "EXCLUDED";

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

export type SqmRoom = {
  area_sqm: number;
  category?: string;
};

export type SqmFloor = {
  rooms: SqmRoom[];
};

export type SqmExtractionData = {
  floors?: SqmFloor[];
  summary?: {
    total_livable_sqm?: number;
    total_sqm?: number;
  };
};

export function categorizeAreas(sqmData: SqmExtractionData): AreaBreakdown {
  const floors = sqmData?.floors;

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
  const livable = sqmData?.summary?.total_livable_sqm ?? sqmData?.summary?.total_sqm ?? 0;
  return { cat1_sqm: livable, cat2_sqm: 0, cat3_sqm: 0 };
}
