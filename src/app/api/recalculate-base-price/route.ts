import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// GET: compute suggested base price from analyzed reference dossiers
export async function GET() {
  const admin = createSupabaseAdminClient();

  const { data: settingsRows } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", ["national_base_price_sqm", "abex_reference_year", "abex_reference_semester"]);

  const settings = Object.fromEntries((settingsRows ?? []).map((s) => [s.key, s.value]));
  const abexYear = Number(settings.abex_reference_year ?? 2026);
  const abexSemester = Number(settings.abex_reference_semester ?? 1);

  const { data: abexRow } = await admin
    .from("abex_index")
    .select("index_value")
    .eq("year", abexYear)
    .eq("semester", abexSemester)
    .maybeSingle();

  const abexFactor = abexRow ? Number(abexRow.index_value) / 1000 : 1.0;

  const { data: dossiers, error } = await admin
    .from("reference_dossiers")
    .select("id, known_price_per_sqm, predicted_finishing_coefficient, postcode")
    .not("known_price_per_sqm", "is", null)
    .not("predicted_finishing_coefficient", "is", null)
    .in("status", ["analyzed", "validated"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!dossiers || dossiers.length === 0) {
    return NextResponse.json({ error: "No analyzed dossiers with known price data" }, { status: 422 });
  }

  const rawValues: number[] = [];
  for (const d of dossiers) {
    const kp = Number(d.known_price_per_sqm);
    const fc = Number(d.predicted_finishing_coefficient);
    if (fc <= 0 || abexFactor <= 0 || kp <= 0) continue;
    // implied base regional price = known / (finishing_coeff × abex)
    const implied = kp / (fc * abexFactor);
    if (implied > 100 && implied < 10000) rawValues.push(implied);
  }

  if (rawValues.length === 0) {
    return NextResponse.json({ error: "No valid data points after filtering" }, { status: 422 });
  }

  // Remove outliers beyond 3σ
  const mean = rawValues.reduce((a, b) => a + b, 0) / rawValues.length;
  const variance = rawValues.map((v) => (v - mean) ** 2).reduce((a, b) => a + b, 0) / rawValues.length;
  const stddev = Math.sqrt(variance);
  const filtered = rawValues.filter((v) => Math.abs(v - mean) <= 3 * stddev);
  const outliers_removed = rawValues.length - filtered.length;

  filtered.sort((a, b) => a - b);

  return NextResponse.json({
    suggested_base: Math.round(percentile(filtered, 0.5)),
    suggested_min: Math.round(percentile(filtered, 0.1)),
    suggested_max: Math.round(percentile(filtered, 0.9)),
    dossier_count: filtered.length,
    outliers_removed,
  });
}

// POST: apply suggested values (upsert all three keys)
export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();
  const body = await req.json() as { base?: number; min?: number; max?: number };

  const { base, min, max } = body;
  if (base == null || min == null || max == null) {
    return NextResponse.json({ error: "Missing base, min or max" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const upserts = [
    { key: "national_base_price_sqm", value: base },
    { key: "national_base_price_min", value: min },
    { key: "national_base_price_max", value: max },
  ];

  for (const row of upserts) {
    await admin
      .from("system_settings")
      .update({ value: row.value, updated_at: now })
      .eq("key", row.key);
  }

  return NextResponse.json({ success: true, updated_at: now });
}
