import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { DossierUploadForm } from "@/components/dossiers/upload-form";
import { BatchUploadForm } from "@/components/dossiers/batch-upload-form";
import { DossierTable, type DossierRow } from "@/components/dossiers/dossier-table";
import { BatchProcessButton, type BatchDossier } from "@/components/dossiers/batch-process-button";
import { RetryFailedButton } from "@/components/dossiers/retry-failed-button";
import { DeleteAllButton } from "@/components/dossiers/delete-all-button";
import { AutoRefresh } from "@/components/dossiers/auto-refresh";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getDossiers(tenantId: string): Promise<DossierRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("reference_dossiers")
    .select(
      "id, address, postcode, building_type, apartment_count, known_total_sqm, sqm_extraction, known_price_per_sqm, expert_finishing_level, predicted_finishing_level, status, error_message, created_at"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch dossiers", error);
    return [];
  }

  return (data ?? []).map((d) => {
    // Support both v11b (project_totals) and legacy (summary) format
    const sqm = d.sqm_extraction as Record<string, unknown> | null;
    let gross: number | null = null;
    if (sqm) {
      // v11b format: project_totals.total_cat1_sqm + total_cat2_sqm
      const pt = sqm.project_totals as { total_cat1_sqm?: number; total_cat2_sqm?: number } | undefined;
      if (pt) {
        gross = (pt.total_cat1_sqm ?? 0) + (pt.total_cat2_sqm ?? 0);
      } else {
        // Legacy format
        const summary = sqm.summary as { total_gross_sqm?: number } | undefined;
        gross = summary?.total_gross_sqm ?? null;
      }
    }
    const total_sqm = d.known_total_sqm != null ? Number(d.known_total_sqm) : (gross != null && gross > 0 ? gross : null);
    return { ...d, total_sqm } as DossierRow;
  });
}

export default async function AdminDossiersPage() {
  let tenantId: string | null = null;

  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const admin = createSupabaseAdminClient();
      const { data: userRow } = await admin
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      tenantId = userRow?.tenant_id ?? null;
    }
  }

  const dossiers = tenantId ? await getDossiers(tenantId) : [];
  const pendingDossiers: BatchDossier[] = dossiers
    .filter((d) => d.status === "pending")
    .map((d) => ({ id: d.id, address: d.address, postcode: d.postcode }));
  const failedDossiers: BatchDossier[] = dossiers
    .filter((d) => d.status === "error")
    .map((d) => ({ id: d.id, address: d.address, postcode: d.postcode }));
  const allIds = dossiers.map((d) => d.id); // for DeleteAllButton

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reference dossiers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload historical expert dossiers to train the QQP model.
        </p>
      </div>

      {/* Upload card with tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Upload dossiers</CardTitle>
          <CardDescription>
            Use <strong>Batch upload</strong> to drop many files at once (metadata filled later).
            Use <strong>Detailed upload</strong> for a single file with full PDF analysis and
            pre-filled metadata.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="batch">
            <TabsList className="mb-6">
              <TabsTrigger value="batch">Batch upload</TabsTrigger>
              <TabsTrigger value="detailed">Detailed upload (single)</TabsTrigger>
            </TabsList>
            <TabsContent value="batch">
              <BatchUploadForm />
            </TabsContent>
            <TabsContent value="detailed">
              <DossierUploadForm />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Separator />

      {/* Dossier list */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">All dossiers</h2>
            <p className="text-sm text-muted-foreground">
              {dossiers.length} dossier{dossiers.length !== 1 ? "s" : ""} in your workspace.
              {pendingDossiers.length > 0 && (
                <span className="ml-1 text-amber-600">
                  {pendingDossiers.length} pending processing.
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RetryFailedButton dossiers={failedDossiers} />
            <BatchProcessButton dossiers={pendingDossiers} />
            <DeleteAllButton dossierIds={allIds} />
          </div>
        </div>
        <DossierTable dossiers={dossiers} />
        <AutoRefresh statuses={dossiers.map((d) => d.status)} />
      </div>
    </div>
  );
}
