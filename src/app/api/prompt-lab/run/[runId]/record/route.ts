// POST: read completed estimation, compare with ground truth, insert evaluation_result
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

function computeErrorPct(predicted: number | null, expert: number | null): number | null {
  if (predicted == null || expert == null || expert === 0) return null;
  return ((predicted - expert) / expert) * 100;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const { dossierId, estimationId } = (await req.json()) as {
      dossierId: string;
      estimationId: string;
    };

    if (!dossierId || !estimationId) {
      return NextResponse.json({ error: "Missing dossierId or estimationId" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Read completed estimation
    const { data: result } = await admin
      .from("estimations")
      .select("status, estimated_total_cost, sqm_extraction, extracted_qqps, finishing_coefficient, sub_areas, processing_time_ms, error_message")
      .eq("id", estimationId)
      .single();

    if (!result) {
      return NextResponse.json({ error: "Estimation not found" }, { status: 404 });
    }

    if (result.status === "error") {
      // Record failed result
      await admin.from("evaluation_results").insert({
        run_id: params.runId,
        dossier_id: dossierId,
        error_message: (result.error_message as string | null)?.slice(0, 500) ?? "Pipeline error",
      });
      return NextResponse.json({ success: false, error: result.error_message });
    }

    // Load ground truth + dossier for F back-calculation
    const { data: gt } = await admin
      .from("benchmark_ground_truth")
      .select("*, reference_dossiers!inner(postcode, price_abex_year, price_abex_semester)")
      .eq("dossier_id", dossierId)
      .single();

    if (!gt) {
      return NextResponse.json({ error: "Ground truth not found" }, { status: 404 });
    }

    const dossier = gt.reference_dossiers as Record<string, unknown>;

    // Extract pipeline values
    const subAreas = result.sub_areas as Record<string, number> | null;
    const extractedCat1 = subAreas?.cat1_sqm ?? null;
    const extractedCat2 = subAreas?.cat2_sqm ?? null;
    const extractedCat3 = subAreas?.cat3_sqm ?? null;
    const predictedCost = result.estimated_total_cost as number | null;
    const predictedF = result.finishing_coefficient as number | null;

    // Compute errors
    const cat1Err = computeErrorPct(extractedCat1, gt.expert_cat1_sqm);
    const cat2Err = computeErrorPct(extractedCat2, gt.expert_cat2_sqm);
    const cat3Err = computeErrorPct(extractedCat3, gt.expert_cat3_sqm);
    const costErr = computeErrorPct(predictedCost, gt.expert_total_price);

    // Back-calculate expert F
    let expertF: number | null = null;
    if (gt.expert_total_price && gt.expert_cat1_sqm) {
      const pricing = { cat1_min: 1100, cat1_max: 1900, cat2_min: 550, cat2_max: 950, cat3_min: 330, cat3_max: 570 };

      let regionalFactor = 1.0;
      if (dossier.postcode) {
        const { data: pp } = await admin
          .from("postcode_prices")
          .select("base_price_per_sqm")
          .eq("postcode", dossier.postcode)
          .maybeSingle();
        if (pp?.base_price_per_sqm) {
          const cat1AtF1 = pricing.cat1_min + ((1.0 - 0.70) / 0.80) * (pricing.cat1_max - pricing.cat1_min);
          regionalFactor = pp.base_price_per_sqm / cat1AtF1;
        }
      }

      let abexFactor = 1.0;
      if (dossier.price_abex_year && dossier.price_abex_semester) {
        const { data: abex } = await admin
          .from("abex_index")
          .select("index_value")
          .eq("year", dossier.price_abex_year)
          .eq("semester", dossier.price_abex_semester)
          .maybeSingle();
        if (abex?.index_value) abexFactor = abex.index_value / 1000;
      }

      const areas = { cat1_sqm: gt.expert_cat1_sqm, cat2_sqm: gt.expert_cat2_sqm || 0, cat3_sqm: gt.expert_cat3_sqm || 0 };
      const costBeforeFactors = gt.expert_total_price / (regionalFactor * abexFactor);
      const minCost = areas.cat1_sqm * pricing.cat1_min + areas.cat2_sqm * pricing.cat2_min + areas.cat3_sqm * pricing.cat3_min;
      const maxCost = areas.cat1_sqm * pricing.cat1_max + areas.cat2_sqm * pricing.cat2_max + areas.cat3_sqm * pricing.cat3_max;
      const rangeSlope = maxCost - minCost;
      if (rangeSlope > 0) {
        const r = (costBeforeFactors - minCost) / rangeSlope;
        expertF = Math.max(0.70, Math.min(1.50, 0.70 + r * 0.80));
      }
    }

    const fErr = predictedF != null && expertF != null ? predictedF - expertF : null;

    // Insert evaluation result
    const { error: insertErr } = await admin.from("evaluation_results").insert({
      run_id: params.runId,
      dossier_id: dossierId,
      extracted_cat1_sqm: extractedCat1,
      extracted_cat2_sqm: extractedCat2,
      extracted_cat3_sqm: extractedCat3,
      sqm_extraction: result.sqm_extraction,
      cat1_error_pct: cat1Err,
      cat2_error_pct: cat2Err,
      cat3_error_pct: cat3Err,
      extracted_qqps: result.extracted_qqps,
      predicted_f: predictedF,
      expert_f: expertF,
      f_error: fErr,
      predicted_total_cost: predictedCost,
      cost_error_pct: costErr,
      processing_time_ms: result.processing_time_ms,
      error_message: null,
    });

    if (insertErr) {
      return NextResponse.json({ error: `Insert result: ${insertErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, costErrorPct: costErr, predictedCost });
  } catch (err) {
    console.error("[benchmark/run/record]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
