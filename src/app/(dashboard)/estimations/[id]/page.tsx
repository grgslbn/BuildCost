import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import {
  EstimationAuditView,
  type EstimationAuditData,
  type PricingSettings,
  type QQPDef,
  type PostcodeMeta,
  type ModelInfo,
} from "@/components/estimate/estimation-audit-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

function toNum(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!isNaN(n)) return n;
    // might be JSON-encoded number string e.g. '"1100"'
    try { const p = JSON.parse(v); if (typeof p === "number") return p; } catch {}
  }
  return fallback;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function EstimationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const admin = createSupabaseAdminClient();

  // ── Auth ──────────────────────────────────────────────────────────────────
  let tenantId: string | null = null;
  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: userRow } = await admin
        .from("users").select("tenant_id").eq("id", user.id).single();
      tenantId = userRow?.tenant_id ?? null;
    }
  }
  if (!tenantId) notFound();

  // ── Fetch estimation + settings + model + QQP defs in parallel ────────────
  const [estResult, settingsResult, modelResult, qqpDefsResult] = await Promise.all([
    admin
      .from("estimations")
      .select([
        "id", "status", "error_message",
        "plan_file_name", "postcode", "created_at",
        "building_type", "total_livable_sqm", "total_gross_sqm",
        "finishing_level", "finishing_coefficient",
        "base_price_per_sqm", "abex_factor",
        "estimated_price_per_sqm", "estimated_total_cost",
        "sqm_confidence", "qqp_confidence", "overall_confidence",
        "sqm_extraction", "extracted_qqps", "sub_areas",
        "processing_time_ms", "model_version_id",
      ].join(", "))
      .eq("id", params.id)
      .eq("tenant_id", tenantId)
      .single(),

    admin
      .from("system_settings")
      .select("key, value")
      .in("key", [
        "cat1_price_min", "cat1_price_max",
        "cat2_price_min", "cat2_price_max",
        "cat3_price_min", "cat3_price_max",
      ]),

    admin
      .from("qqp_model_versions")
      .select("id, version, weights")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),

    admin
      .from("qqp_definitions")
      .select("name, display_name, data_type")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  if (estResult.error || !estResult.data) notFound();

  const est = estResult.data as unknown as EstimationAuditData;

  // ── Postcode lookup (needs estimation.postcode) ────────────────────────────
  const postcodeResult = est.postcode
    ? await admin
        .from("postcode_prices")
        .select("municipality, region, base_price_per_sqm")
        .eq("postcode", est.postcode)
        .maybeSingle()
    : { data: null };

  // ── Build prop objects ────────────────────────────────────────────────────
  const settingsMap = Object.fromEntries(
    (settingsResult.data ?? []).map((s) => [s.key, s.value])
  );

  const pricing: PricingSettings = {
    cat1_min: toNum(settingsMap.cat1_price_min, 1100),
    cat1_max: toNum(settingsMap.cat1_price_max, 1900),
    cat2_min: toNum(settingsMap.cat2_price_min, 550),
    cat2_max: toNum(settingsMap.cat2_price_max, 950),
    cat3_min: toNum(settingsMap.cat3_price_min, 330),
    cat3_max: toNum(settingsMap.cat3_price_max, 570),
  };

  const modelInfo: ModelInfo = modelResult.data
    ? {
        id:      modelResult.data.id as string,
        version: modelResult.data.version as number,
        weights: (modelResult.data.weights ?? {}) as Record<string, unknown>,
      }
    : null;

  const qqpDefs: QQPDef[] = (qqpDefsResult.data ?? []) as unknown as QQPDef[];

  const postcodeMeta: PostcodeMeta = postcodeResult.data
    ? {
        municipality:       (postcodeResult.data.municipality  as string | null) ?? null,
        region:             (postcodeResult.data.region         as string | null) ?? null,
        base_price_per_sqm: (postcodeResult.data.base_price_per_sqm as number | null) ?? null,
      }
    : null;

  // ── Non-complete states ───────────────────────────────────────────────────
  if (est.status !== "complete") {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-4xl space-y-5">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/estimations">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All Estimations
            </Link>
          </Button>
          {est.status === "error" ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center space-y-2">
              <p className="font-semibold text-destructive">Processing failed</p>
              <p className="text-sm text-muted-foreground">
                {est.error_message ?? "An unexpected error occurred."}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/30 p-8 text-center space-y-2">
              <p className="font-semibold">Still processing</p>
              <p className="text-sm text-muted-foreground">
                This estimation is in status <strong>{est.status}</strong>.{" "}
                <Link href="/estimate" className="underline">
                  Track progress live →
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Full audit view ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl">
        <EstimationAuditView
          estimation={est}
          pricing={pricing}
          modelInfo={modelInfo}
          qqpDefs={qqpDefs}
          postcodeMeta={postcodeMeta}
        />
      </div>
    </div>
  );
}
