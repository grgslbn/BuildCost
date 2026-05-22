// POST: process ONE dossier for a benchmark run
// Creates estimation → calls estimate-process → compares with ground truth → records result
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const maxDuration = 300; // 5 minutes — same as estimate-process

function computeErrorPct(predicted: number | null, expert: number | null): number | null {
  if (predicted == null || expert == null || expert === 0) return null;
  return ((predicted - expert) / expert) * 100;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(
  req: NextRequest,
  { params }: { params: { runId: string } },
) {
  const startTime = Date.now();

  try {
    const { dossierId } = (await req.json()) as { dossierId: string };
    if (!dossierId) {
      return NextResponse.json({ error: "Missing dossierId" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Load ground truth + dossier info
    const { data: gt } = await admin
      .from("benchmark_ground_truth")
      .select("*, reference_dossiers!inner(id, tenant_id, plan_storage_path, plan_file_name, postcode, price_abex_year, price_abex_semester)")
      .eq("dossier_id", dossierId)
      .single();

    if (!gt) {
      return NextResponse.json({ error: "No ground truth for this dossier" }, { status: 404 });
    }

    const dossier = gt.reference_dossiers as Record<string, unknown>;

    // 1. Create estimation row
    const { data: est, error: estErr } = await admin
      .from("estimations")
      .insert({
        tenant_id: dossier.tenant_id,
        plan_storage_path: dossier.plan_storage_path,
        plan_file_name: dossier.plan_file_name,
        postcode: dossier.postcode,
        status: "uploading",
      })
      .select("id")
      .single();

    if (estErr || !est) {
      throw new Error(`Create estimation: ${estErr?.message}`);
    }

    // 2. Call estimate-process (same endpoint as end users)
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const baseUrl = `${proto}://${host}`;

    const processRes = await fetch(`${baseUrl}/api/estimate-process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estimationId: est.id }),
    });

    if (!processRes.ok) {
      const body = await processRes.text();
      throw new Error(`estimate-process ${processRes.status}: ${body.slice(0, 200)}`);
    }

    // 3. Read the completed estimation (belt-and-suspenders: poll briefly if needed)
    let result: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data } = await admin
        .from("estimations")
        .select("status, estimated_total_cost, sqm_extraction, extracted_qqps, finishing_coefficient, sub_areas, processing_time_ms, error_message")
        .eq("id", est.id)
        .single();
      if (data?.status === "complete" || data?.status === "error") {
        result = data;
        break;
      }
      await sleep(2000);
    }

    if (!result) throw new Error("Estimation not complete after processing");
    if (result.status === "error") throw new Error((result.error_message as string) || "Pipeline error");

    // 4. Extract values
    const subAreas = result.sub_areas as Record<string, number> | null;
    const extractedCat1 = subAreas?.cat1_sqm ?? null;
    const extractedCat2 = subAreas?.cat2_sqm ?? null;
    const extractedCat3 = subAreas?.cat3_sqm ?? null;
    const predictedCost = result.estimated_total_cost as number | null;
    const predictedF = result.finishing_coefficient as number | null;

    // 5. Compute errors
    const cat1Err = computeErrorPct(extractedCat1, gt.expert_cat1_sqm);
    const cat2Err = computeErrorPct(extractedCat2, gt.expert_cat2_sqm);
    const cat3Err = computeErrorPct(extractedCat3, gt.expert_cat3_sqm);
    const costErr = computeErrorPct(predictedCost, gt.expert_total_price);

    // 6. Back-calculate expert F
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

      const areas = {
        cat1_sqm: gt.expert_cat1_sqm,
        cat2_sqm: gt.expert_cat2_sqm || 0,
        cat3_sqm: gt.expert_cat3_sqm || 0,
      };
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
    const elapsedMs = Date.now() - startTime;

    // 7. Insert evaluation result
    const evalResult = {
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
      processing_time_ms: result.processing_time_ms ?? elapsedMs,
      error_message: null,
    };

    const { error: insertErr } = await admin.from("evaluation_results").insert(evalResult);
    if (insertErr) throw new Error(`Insert result: ${insertErr.message}`);

    return NextResponse.json({
      success: true,
      costErrorPct: costErr,
      predictedCost,
      elapsedMs,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    const admin = createSupabaseAdminClient();
    const errorMsg = err instanceof Error ? err.message : "Unexpected error";

    // Record failed result
    try {
      const { dossierId } = (await req.clone().json()) as { dossierId: string };
      await admin.from("evaluation_results").insert({
        run_id: params.runId,
        dossier_id: dossierId,
        error_message: errorMsg.slice(0, 500),
      });
    } catch { /* best effort */ }

    console.error("[benchmark/run/process]", err);
    return NextResponse.json({ success: false, error: errorMsg, elapsedMs });
  }
}
