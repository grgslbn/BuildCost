// scripts/benchmark-run.mjs
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ─────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = await readFile(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env.local */ }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.BENCHMARK_BASE_URL || "http://localhost:3000";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });

// ── Parse CLI args ──────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    all:         { type: "boolean", default: false },
    subset:      { type: "string" },
    concurrency: { type: "string", default: "3" },
    name:        { type: "string" },
  },
  allowPositionals: false,
});

const concurrency = parseInt(args.concurrency, 10) || 3;

// ── Helpers ─────────────────────────────────────────────────────────

function computeErrorPct(predicted, expert) {
  if (predicted == null || expert == null || expert === 0) return null;
  return ((predicted - expert) / expert) * 100;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeRunMetrics(results) {
  const succeeded = results.filter((r) => !r.error_message);
  const costErrors = succeeded.map((r) => r.cost_error_pct).filter((v) => v != null);
  const absCost = costErrors.map(Math.abs);
  const fErrors = succeeded.map((r) => r.f_error).filter((v) => v != null).map(Math.abs);
  const total = costErrors.length || 1;
  const mae = (arr) => { const v = arr.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + Math.abs(x), 0) / v.length : 0; };

  return {
    cost_mae_pct: mae(costErrors),
    cost_median_pct: median(absCost),
    cost_worst_pct: absCost.length ? Math.max(...absCost) : 0,
    cost_within_10_pct: absCost.filter((e) => e <= 10).length / total,
    cost_within_15_pct: absCost.filter((e) => e <= 15).length / total,
    cat1_mae_pct: mae(succeeded.map((r) => r.cat1_error_pct)),
    cat2_mae_pct: mae(succeeded.map((r) => r.cat2_error_pct)),
    cat3_mae_pct: mae(succeeded.map((r) => r.cat3_error_pct)),
    f_mae: fErrors.length ? fErrors.reduce((s, v) => s + v, 0) / fErrors.length : 0,
    f_median: median(fErrors),
    dossiers_succeeded: succeeded.length,
    dossiers_failed: results.length - succeeded.length,
  };
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pollEstimation(estimationId, timeoutMs = 300_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin
      .from("estimations")
      .select("status, estimated_total_cost, sqm_extraction, extracted_qqps, finishing_coefficient, sub_areas, processing_time_ms, error_message")
      .eq("id", estimationId)
      .single();
    if (!data) throw new Error("Estimation row not found");
    if (data.status === "complete" || data.status === "error") return data;
    await sleep(3000);
  }
  throw new Error("Polling timeout (5 min)");
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  // 1. Load ground truth + dossiers
  const { data: gtRows, error: gtErr } = await admin
    .from("benchmark_ground_truth")
    .select("*, reference_dossiers!inner(id, tenant_id, plan_storage_path, plan_file_name, postcode, price_abex_year, price_abex_semester)")
    .not("expert_total_price", "is", null);

  if (gtErr || !gtRows) {
    console.error("Failed to load ground truth:", gtErr?.message);
    process.exit(1);
  }

  // 2. Filter dossiers based on subset mode
  let dossiers = gtRows;
  let subsetMode = "all";

  if (args.subset) {
    if (args.subset === "difficult") {
      subsetMode = "difficult";
      // Get latest complete run
      const { data: lastRun } = await admin
        .from("evaluation_runs")
        .select("id")
        .eq("status", "complete")
        .order("completed_at", { ascending: false })
        .limit(1)
        .single();
      if (!lastRun) {
        console.error("No previous complete run found. Use --all for the first run.");
        process.exit(1);
      }
      const { data: prevResults } = await admin
        .from("evaluation_results")
        .select("dossier_id, cost_error_pct")
        .eq("run_id", lastRun.id);
      const difficultIds = new Set(
        (prevResults ?? [])
          .filter((r) => r.cost_error_pct != null && Math.abs(r.cost_error_pct) > 15)
          .map((r) => r.dossier_id)
      );
      dossiers = dossiers.filter((d) => difficultIds.has(d.dossier_id));
    } else if (args.subset.startsWith("ids:")) {
      subsetMode = "manual";
      const ids = args.subset.slice(4).split(",").map((s) => s.trim());
      dossiers = dossiers.filter((d) => ids.includes(d.dossier_id) || ids.includes(d.dossier_id.slice(0, 8)));
    }
  } else if (!args.all) {
    console.error("Specify --all or --subset=difficult or --subset=ids:a,b,c");
    process.exit(1);
  }

  if (dossiers.length === 0) {
    console.log("No dossiers match the filter.");
    return;
  }

  // 3. Get active prompt versions and model
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

  const runName = args.name || `SQM v${sqmPrompt?.version_number ?? "?"} + QQP v${qqpPrompt?.version_number ?? "?"}`;

  // 4. Create evaluation run
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
    console.error("Failed to create run:", runErr?.message);
    process.exit(1);
  }

  console.log(`Benchmark run: "${runName}"`);
  console.log(`Prompts: SQM v${sqmPrompt?.version_number ?? "?"} / QQP v${qqpPrompt?.version_number ?? "?"}`);
  console.log(`Model: v${activeModel?.version ?? "none"}`);
  console.log(`Dossiers: ${dossiers.length} (${subsetMode})\n`);

  // 5. Process dossiers with concurrency
  const allResults = [];
  let idx = 0;

  async function processDossier(gt) {
    const myIdx = ++idx;
    const dossier = gt.reference_dossiers;
    const label = (dossier.plan_file_name || gt.dossier_id.slice(0, 8)).slice(0, 30).padEnd(30);
    const startTime = Date.now();

    try {
      // Create estimation row
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
      if (estErr || !est) throw new Error(`Create estimation: ${estErr?.message}`);

      // Fire estimate-process (same as end user)
      const processRes = await fetch(`${baseUrl}/api/estimate-process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimationId: est.id }),
      });
      if (!processRes.ok) {
        const body = await processRes.text();
        throw new Error(`estimate-process ${processRes.status}: ${body.slice(0, 200)}`);
      }

      // Poll for completion
      const result = await pollEstimation(est.id);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.status === "error") throw new Error(result.error_message || "Pipeline error");

      // Extract areas from result
      const subAreas = result.sub_areas;
      const extractedCat1 = subAreas?.cat1_sqm ?? null;
      const extractedCat2 = subAreas?.cat2_sqm ?? null;
      const extractedCat3 = subAreas?.cat3_sqm ?? null;
      const predictedCost = result.estimated_total_cost;
      const predictedF = result.finishing_coefficient;

      // Compute errors
      const cat1Err = computeErrorPct(extractedCat1, gt.expert_cat1_sqm);
      const cat2Err = computeErrorPct(extractedCat2, gt.expert_cat2_sqm);
      const cat3Err = computeErrorPct(extractedCat3, gt.expert_cat3_sqm);
      const costErr = computeErrorPct(predictedCost, gt.expert_total_price);

      // Back-calculate expert F using expert m² + expert price + regional/ABEX factors
      let expertF = null;
      let fErr = null;
      if (gt.expert_total_price && gt.expert_cat1_sqm) {
        // Load pricing config (same defaults as pipeline)
        const pricing = { cat1_min: 1100, cat1_max: 1900, cat2_min: 550, cat2_max: 950, cat3_min: 330, cat3_max: 570 };

        // Regional factor from postcode
        let regionalFactor = 1.0;
        if (dossier.postcode) {
          const { data: pp } = await admin.from("postcode_prices").select("base_price_per_sqm").eq("postcode", dossier.postcode).maybeSingle();
          if (pp?.base_price_per_sqm) {
            const cat1AtF1 = pricing.cat1_min + ((1.0 - 0.70) / 0.80) * (pricing.cat1_max - pricing.cat1_min);
            regionalFactor = pp.base_price_per_sqm / cat1AtF1;
          }
        }

        // ABEX factor from dossier's valuation date
        let abexFactor = 1.0;
        const abexYear = dossier.price_abex_year;
        const abexSemester = dossier.price_abex_semester;
        if (abexYear && abexSemester) {
          const { data: abex } = await admin.from("abex_index").select("index_value").eq("year", abexYear).eq("semester", abexSemester).maybeSingle();
          if (abex?.index_value) abexFactor = abex.index_value / 1000;
        }

        // backcalculateF: solve for F given total cost, areas, pricing, factors
        const areas = { cat1_sqm: gt.expert_cat1_sqm, cat2_sqm: gt.expert_cat2_sqm || 0, cat3_sqm: gt.expert_cat3_sqm || 0 };
        const costBeforeFactors = gt.expert_total_price / (regionalFactor * abexFactor);
        // minCost = cat1*cat1_min + cat2*cat2_min + cat3*cat3_min
        const minCost = areas.cat1_sqm * pricing.cat1_min + areas.cat2_sqm * pricing.cat2_min + areas.cat3_sqm * pricing.cat3_min;
        const maxCost = areas.cat1_sqm * pricing.cat1_max + areas.cat2_sqm * pricing.cat2_max + areas.cat3_sqm * pricing.cat3_max;
        const rangeSlope = maxCost - minCost;
        if (rangeSlope > 0) {
          const r = (costBeforeFactors - minCost) / rangeSlope;
          const rawF = 0.70 + r * 0.80;
          expertF = Math.max(0.70, Math.min(1.50, rawF));
        }
      }
      fErr = (predictedF != null && expertF != null) ? predictedF - expertF : null;

      const evalResult = {
        run_id: run.id,
        dossier_id: gt.dossier_id,
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
      };

      await admin.from("evaluation_results").insert(evalResult);
      allResults.push(evalResult);

      const costStr = costErr != null ? `${costErr > 0 ? "+" : ""}${costErr.toFixed(1)}%` : "N/A";
      const cat1Str = cat1Err != null ? `${cat1Err > 0 ? "+" : ""}${cat1Err.toFixed(1)}%` : "N/A";
      console.log(`[${myIdx}/${dossiers.length}] ${label} ✓  cost: ${costStr}  cat1: ${cat1Str}  (${elapsed}s)`);
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const evalResult = {
        run_id: run.id,
        dossier_id: gt.dossier_id,
        error_message: err.message?.slice(0, 500),
      };
      await admin.from("evaluation_results").insert(evalResult);
      allResults.push(evalResult);
      console.log(`[${myIdx}/${dossiers.length}] ${label} ✗  ${err.message?.slice(0, 80)}  (${elapsed}s)`);
    }
  }

  // Run with concurrency limit
  const queue = [...dossiers];
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) await processDossier(item);
      }
    })());
  }
  await Promise.all(workers);

  // 6. Compute aggregate metrics and finalize run
  const metrics = computeRunMetrics(allResults);
  await admin
    .from("evaluation_runs")
    .update({ status: "complete", completed_at: new Date().toISOString(), metrics })
    .eq("id", run.id);

  console.log(`\n── Summary ──────────────────────────────`);
  console.log(`SQM  MAE cat1: ${metrics.cat1_mae_pct.toFixed(1)}%  cat2: ${metrics.cat2_mae_pct.toFixed(1)}%  cat3: ${metrics.cat3_mae_pct.toFixed(1)}%`);
  console.log(`Cost MAE: ${metrics.cost_mae_pct.toFixed(1)}%  Median: ${metrics.cost_median_pct.toFixed(1)}%  Worst: ${metrics.cost_worst_pct.toFixed(1)}%`);
  console.log(`     Within 10%: ${(metrics.cost_within_10_pct * 100).toFixed(0)}%  Within 15%: ${(metrics.cost_within_15_pct * 100).toFixed(0)}%`);
  console.log(`F    MAE: ${metrics.f_mae.toFixed(2)}`);
  console.log(`Succeeded: ${metrics.dossiers_succeeded}  Failed: ${metrics.dossiers_failed}`);
  console.log(`\nRun ID: ${run.id}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
