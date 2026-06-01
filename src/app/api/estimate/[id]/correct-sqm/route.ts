import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import { calculateCost, type PricingConfig } from "@/lib/cost/calculate-cost";
import { getRegionalCoefficient } from "@/lib/cost/regional-coefficients";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Manual SQM correction. When the automated SQM is low-confidence (bare/dimension-only
 * plans that vision cannot measure reliably), the user confirms/corrects the m² and we
 * recompute the cost deterministically from the stored F + pricing + regional + ABEX.
 * Body: { cat1_sqm, cat2_sqm?, cat3_sqm? }.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = createSupabaseAdminClient();

  // ── auth / tenant scoping ────────────────────────────────────────────────
  let tenantId: string | null = null;
  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: userRow } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    tenantId = userRow?.tenant_id ?? null;
    if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  // ── parse + validate body ────────────────────────────────────────────────
  let body: { cat1_sqm?: unknown; cat2_sqm?: unknown; cat3_sqm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const cat1 = num(body.cat1_sqm);
  const cat2 = num(body.cat2_sqm) ?? 0;
  const cat3 = num(body.cat3_sqm) ?? 0;
  if (cat1 === null || cat1 <= 0) {
    return NextResponse.json({ error: "cat1_sqm (livable m²) is required and must be > 0" }, { status: 400 });
  }
  if (cat1 > 100000 || cat2 > 100000 || cat3 > 100000) {
    return NextResponse.json({ error: "m² value out of range" }, { status: 400 });
  }

  // ── load the estimation (scoped to tenant) ───────────────────────────────
  const { data: est, error: estErr } = await admin
    .from("estimations")
    .select("id, tenant_id, finishing_coefficient, abex_factor, postcode, qqp_confidence")
    .eq("id", params.id)
    .maybeSingle();
  if (estErr || !est) return NextResponse.json({ error: "Estimation not found" }, { status: 404 });
  if (!SKIP_AUTH && est.tenant_id !== tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── load pricing + factors, recompute cost ───────────────────────────────
  const { data: settingsRows } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", [
      "cat1_price_min", "cat1_price_max",
      "cat2_price_min", "cat2_price_max",
      "cat3_price_min", "cat3_price_max",
    ]);
  const settings = Object.fromEntries((settingsRows ?? []).map((s) => [s.key, s.value]));
  const pricing: PricingConfig = {
    cat1_min: (settings.cat1_price_min as number) ?? 1100,
    cat1_max: (settings.cat1_price_max as number) ?? 1900,
    cat2_min: (settings.cat2_price_min as number) ?? 550,
    cat2_max: (settings.cat2_price_max as number) ?? 950,
    cat3_min: (settings.cat3_price_min as number) ?? 330,
    cat3_max: (settings.cat3_price_max as number) ?? 570,
  };

  const finishingCoefficient = Number(est.finishing_coefficient) || 0.96;
  const abexFactor = Number(est.abex_factor) || 1.0;
  const regionalFactor = getRegionalCoefficient(est.postcode as string | null).coeff;

  const costBreakdown = calculateCost(
    { cat1_sqm: cat1, cat2_sqm: cat2, cat3_sqm: cat3 },
    finishingCoefficient,
    pricing,
    regionalFactor,
    abexFactor,
  );

  const qqpConfidence = Number(est.qqp_confidence) || 0.7;
  // Manual confirmation → SQM is now user-verified: treat as fully confident.
  const overallConfidence = (1.0 + qqpConfidence) / 2;

  const { error: updErr } = await admin
    .from("estimations")
    .update({
      sub_areas: costBreakdown,
      total_livable_sqm: cat1,
      total_gross_sqm: cat1 + cat2 + cat3,
      finishing_level: costBreakdown.finishing_label,
      base_price_per_sqm: costBreakdown.cat1_price_per_sqm,
      estimated_price_per_sqm: costBreakdown.effective_price_per_livable_sqm,
      estimated_total_cost: costBreakdown.total_cost,
      sqm_confidence: 1.0,
      overall_confidence: overallConfidence,
      price_out_of_range: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    areas: { cat1_sqm: cat1, cat2_sqm: cat2, cat3_sqm: cat3 },
    breakdown: costBreakdown,
    overall_confidence: overallConfidence,
  });
}
