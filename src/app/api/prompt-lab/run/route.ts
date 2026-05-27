// POST: create a new benchmark run, return dossier list for client to iterate
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { name, mode } = (await req.json()) as { name?: string; mode?: string };
    const admin = createSupabaseAdminClient();

    // Load ground truth with dossier info
    const { data: gtRows, error: gtErr } = await admin
      .from("benchmark_ground_truth")
      .select("dossier_id, expert_total_price, expert_cat1_sqm, expert_cat2_sqm, expert_cat3_sqm, reference_dossiers!inner(id, tenant_id, plan_storage_path, plan_file_name, postcode, price_abex_year, price_abex_semester)")
      .not("expert_total_price", "is", null);

    if (gtErr || !gtRows) {
      return NextResponse.json({ error: `Failed to load ground truth: ${gtErr?.message}` }, { status: 500 });
    }

    let dossiers = gtRows;
    let subsetMode = mode || "all";

    // Filter for difficult subset
    if (mode === "difficult") {
      const { data: lastRun } = await admin
        .from("evaluation_runs")
        .select("id")
        .eq("status", "complete")
        .order("completed_at", { ascending: false })
        .limit(1)
        .single();

      if (!lastRun) {
        return NextResponse.json({ error: "No previous complete run found. Use 'all' for the first run." }, { status: 400 });
      }

      const { data: prevResults } = await admin
        .from("evaluation_results")
        .select("dossier_id, cost_error_pct")
        .eq("run_id", lastRun.id);

      const difficultIds = new Set(
        (prevResults ?? [])
          .filter((r) => r.cost_error_pct != null && Math.abs(r.cost_error_pct) > 15)
          .map((r) => r.dossier_id),
      );
      dossiers = dossiers.filter((d) => difficultIds.has(d.dossier_id));
      subsetMode = "difficult";
    }

    if (dossiers.length === 0) {
      return NextResponse.json({ error: "No dossiers match the filter." }, { status: 400 });
    }

    // Get active prompt versions + model
    const { data: activePrompts } = await admin
      .from("prompt_versions")
      .select("id, prompt_type, version_number")
      .eq("is_active", true);

    const sqmPrompt = activePrompts?.find((p) => p.prompt_type === "sqm_extraction");
    const qqpPrompt = activePrompts?.find((p) => p.prompt_type === "qqp_extraction");

    const { data: activeModel } = await admin
      .from("qqp_model_versions")
      .select("id, version")
      .eq("is_active", true)
      .maybeSingle();

    const runName = name || `SQM v${sqmPrompt?.version_number ?? "?"} + QQP v${qqpPrompt?.version_number ?? "?"}`;

    // Create the run
    const { data: run, error: runErr } = await admin
      .from("evaluation_runs")
      .insert({
        name: runName,
        sqm_prompt_version_id: sqmPrompt?.id ?? null,
        qqp_prompt_version_id: qqpPrompt?.id ?? null,
        model_version_id: activeModel?.id ?? null,
        dossier_count: dossiers.length,
        subset_mode: subsetMode,
        status: "running",
      })
      .select("id")
      .single();

    if (runErr || !run) {
      return NextResponse.json({ error: `Failed to create run: ${runErr?.message}` }, { status: 500 });
    }

    return NextResponse.json({
      runId: run.id,
      runName,
      dossiers: dossiers.map((d) => ({
        dossierId: d.dossier_id,
        fileName: (d.reference_dossiers as unknown as { plan_file_name: string | null })?.plan_file_name ?? d.dossier_id.slice(0, 8),
      })),
    });
  } catch (err) {
    console.error("[benchmark/run]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
