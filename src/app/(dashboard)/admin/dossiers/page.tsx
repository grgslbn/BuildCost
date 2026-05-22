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
import { GDriveImportForm } from "@/components/dossiers/gdrive-import-form";
import { DossierTable, type DossierRow } from "@/components/dossiers/dossier-table";
import { BatchProcessButton } from "@/components/dossiers/batch-process-button";
import { RetryFailedButton } from "@/components/dossiers/retry-failed-button";
import { DeleteAllButton } from "@/components/dossiers/delete-all-button";

export const dynamic = "force-dynamic";

async function getDossiers(tenantId: string): Promise<DossierRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("reference_dossiers")
    .select(
      "id, address, postcode, building_type, apartment_count, known_price_per_sqm, expert_finishing_level, predicted_finishing_level, status, error_message, created_at"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch dossiers", error);
    return [];
  }
  return (data ?? []) as DossierRow[];
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
  const pendingIds = dossiers
    .filter((d) => d.status === "pending")
    .map((d) => d.id);
  const failedIds = dossiers
    .filter((d) => d.status === "error")
    .map((d) => d.id);
  const allIds = dossiers.map((d) => d.id);

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
            Use <strong>Batch upload</strong> to drop many files at once, <strong>Google Drive</strong> to import a whole folder, or <strong>Detailed upload</strong> for a single file with full PDF analysis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="batch">
            <TabsList className="mb-6">
              <TabsTrigger value="batch">Batch upload</TabsTrigger>
              <TabsTrigger value="gdrive">Import from Google Drive</TabsTrigger>
              <TabsTrigger value="detailed">Detailed upload (single)</TabsTrigger>
            </TabsList>
            <TabsContent value="batch">
              <BatchUploadForm />
            </TabsContent>
            <TabsContent value="gdrive">
              <GDriveImportForm />
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
              {pendingIds.length > 0 && (
                <span className="ml-1 text-amber-600">
                  {pendingIds.length} pending processing.
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RetryFailedButton failedCount={failedIds.length} />
            <BatchProcessButton dossierIds={pendingIds} />
            <DeleteAllButton dossierIds={allIds} />
          </div>
        </div>
        <DossierTable dossiers={dossiers} />
      </div>
    </div>
  );
}
