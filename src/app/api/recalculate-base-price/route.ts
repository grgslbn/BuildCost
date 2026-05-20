import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { F_MIN, F_MAX } from "@/lib/cost/calculate-cost";

export const dynamic = "force-dynamic";

// Fixed ratios: cat2 and cat3 as fractions of cat1
const CAT2_RATIO = 0.5;  // 550/1100
const CAT3_RATIO = 0.3;  // 330/1100

function mean(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[], m = mean(arr)) {
  const variance = arr.map((v) => (v - m) ** 2).reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(variance);
}

// OLS for z = intercept + slope * t
function olsLinear(ts: number[], zs: number[]): { intercept: number; slope: number } {
  const n = ts.length;
  const sumT = ts.reduce((a, b) => a + b, 0);
  const sumZ = zs.reduce((a, b) => a + b, 0);
  const sumTZ = ts.reduce((s, t, i) => s + t * zs[i], 0);
  const sumT2 = ts.reduce((s, t) => s + t * t, 0);
  const det = n * sumT2 - sumT * sumT;
  if (Math.abs(det) < 1e-10) {
    // Degenerate: all t values the same — fall back to mean
    return { intercept: mean(zs), slope: 0 };
  }
  const intercept = (sumZ * sumT2 - sumTZ * sumT) / det;
  const slope = (n * sumTZ - sumT * sumZ) / det;
  return { intercept, slope };
}

// GET: compute suggested category prices from analyzed reference dossiers
export async function GET() {
  const admin = createSupabaseAdminClient();

  const { data: settingsRows } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", ["abex_reference_year", "abex_reference_semester"]);

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

  const { data: rawDossiers, error } = await admin
    .from("reference_dossiers")
    .select("id, known_price_per_sqm, predicted_finishing_coefficient, sqm_extraction")
    .not("known_price_per_sqm", "is", null)
    .not("predicted_finishing_coefficient", "is", null)
    .not("sqm_extraction", "is", null)
    .in("status", ["analyzed", "validated"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Only include dossiers where SQM extraction produced meaningful surface data
  const dossiers = (rawDossiers ?? []).filter((d) => {
    const summary = (d.sqm_extraction as { summary?: { total_gross_sqm?: number } } | null)?.summary;
    return summary?.total_gross_sqm != null && summary.total_gross_sqm > 0;
  });

  if (dossiers.length === 0) {
    return NextResponse.json({ error: "No analyzed dossiers with known price data and valid SQM" }, { status: 422 });
  }

  const range = F_MAX - F_MIN;
  const points: { t: number; z: number }[] = [];

  for (const d of dossiers) {
    const kp = Number(d.known_price_per_sqm);
    const fc = Number(d.predicted_finishing_coefficient);
    if (fc <= 0 || abexFactor <= 0 || kp <= 0) continue;
    if (fc < F_MIN || fc > F_MAX) continue;
    // z = implied cat1 price at this finishing level (national, pre-ABEX)
    const z = kp / abexFactor;
    const t = (fc - F_MIN) / range;
    if (z > 100 && z < 10000) points.push({ t, z });
  }

  if (points.length === 0) {
    return NextResponse.json({ error: "No valid data points after filtering" }, { status: 422 });
  }

  // Remove outliers beyond 3σ on z
  const zs = points.map((p) => p.z);
  const zm = mean(zs);
  const zsd = stddev(zs, zm);
  const filtered = points.filter((p) => Math.abs(p.z - zm) <= 3 * zsd);
  const outliers_removed = points.length - filtered.length;

  if (filtered.length < 2) {
    return NextResponse.json({ error: "Too few data points after outlier removal" }, { status: 422 });
  }

  const { intercept, slope } = olsLinear(
    filtered.map((p) => p.t),
    filtered.map((p) => p.z)
  );

  // cat1_min = price at F_MIN (t=0), cat1_max = price at F_MAX (t=1)
  let cat1_min = Math.round(intercept);
  let cat1_max = Math.round(intercept + slope);

  // Sanity clamps
  cat1_min = Math.max(300, Math.min(cat1_min, 3000));
  cat1_max = Math.max(cat1_min + 100, Math.min(cat1_max, 5000));

  return NextResponse.json({
    cat1_min,
    cat1_max,
    cat2_min: Math.round(cat1_min * CAT2_RATIO),
    cat2_max: Math.round(cat1_max * CAT2_RATIO),
    cat3_min: Math.round(cat1_min * CAT3_RATIO),
    cat3_max: Math.round(cat1_max * CAT3_RATIO),
    dossier_count: filtered.length,
    outliers_removed,
  });
}

// POST: apply suggested values
export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();
  const body = await req.json() as {
    cat1_min?: number; cat1_max?: number;
    cat2_min?: number; cat2_max?: number;
    cat3_min?: number; cat3_max?: number;
  };

  const { cat1_min, cat1_max, cat2_min, cat2_max, cat3_min, cat3_max } = body;
  if (
    cat1_min == null || cat1_max == null ||
    cat2_min == null || cat2_max == null ||
    cat3_min == null || cat3_max == null
  ) {
    return NextResponse.json({ error: "Missing one or more price fields" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const updates = [
    { key: "cat1_price_min", value: cat1_min },
    { key: "cat1_price_max", value: cat1_max },
    { key: "cat2_price_min", value: cat2_min },
    { key: "cat2_price_max", value: cat2_max },
    { key: "cat3_price_min", value: cat3_min },
    { key: "cat3_price_max", value: cat3_max },
  ];

  for (const row of updates) {
    await admin
      .from("system_settings")
      .update({ value: row.value, updated_at: now })
      .eq("key", row.key);
  }

  return NextResponse.json({ success: true, updated_at: now });
}
