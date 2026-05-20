import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import { ResultsView, type EstimationResult } from "@/components/estimate/results-view";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EstimationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const admin = createSupabaseAdminClient();

  let tenantId: string | null = null;
  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: userRow } = await admin
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      tenantId = userRow?.tenant_id ?? null;
    }
  }

  if (!tenantId) notFound();

  const { data, error } = await admin
    .from("estimations")
    .select([
      "id", "status", "error_message",
      "building_type", "total_livable_sqm", "total_gross_sqm",
      "finishing_level", "finishing_coefficient",
      "base_price_per_sqm", "abex_factor",
      "estimated_price_per_sqm", "estimated_total_cost",
      "sqm_confidence", "qqp_confidence", "overall_confidence",
      "sqm_extraction", "extracted_qqps",
      "sub_areas",
      "postcode", "plan_file_name",
      "processing_time_ms",
    ].join(", "))
    .eq("id", params.id)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) notFound();

  const estimation = data as unknown as EstimationResult & { error_message?: string | null };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Back link */}
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/estimations">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All Estimations
          </Link>
        </Button>

        {/* Results or status message */}
        {estimation.status === "complete" ? (
          <ResultsView result={estimation} />
        ) : estimation.status === "error" ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center space-y-2">
            <p className="font-medium text-destructive">Processing failed</p>
            <p className="text-sm text-muted-foreground">
              {estimation.error_message ?? "An unexpected error occurred."}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/30 p-6 text-center space-y-2">
            <p className="font-medium">Still processing</p>
            <p className="text-sm text-muted-foreground">
              This estimation is currently in status <strong>{estimation.status}</strong>.
              Check back in a moment or open it from the{" "}
              <Link href="/estimate" className="underline">
                New Estimation
              </Link>{" "}
              page to track progress live.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
