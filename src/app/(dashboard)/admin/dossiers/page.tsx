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
import { DossierUploadForm } from "@/components/dossiers/upload-form";
import { DossierTable, type DossierRow } from "@/components/dossiers/dossier-table";
import { BatchProcessButton } from "@/components/dossiers/batch-process-button";

export const dynamic = "force-dynamic";

async function getDossiers(tenantId: string): Promise<DossierRow[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("reference_dossiers")
    .select(
      "id, address, postcode, building_type, known_price_per_sqm, expert_finishing_level, status, created_at"
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

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reference dossiers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload historical expert dossiers to train the QQP model.
        </p>
      </div>

      {/* Section 1 — Upload form */}
      <Card>
        <CardHeader>
          <CardTitle>Upload a dossier</CardTitle>
          <CardDescription>
            Attach a building plan (PDF / PNG / JPG) along with the known expert data.
            The plan is stored in Supabase Storage bucket{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">plans</code>; make
            sure the bucket exists before uploading (Storage → New bucket → name:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">plans</code>, public:{" "}
            <span className="font-medium">off</span>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DossierUploadForm />
        </CardContent>
      </Card>

      <Separator />

      {/* Section 2 — Dossier list */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">All dossiers</h2>
            <p className="text-sm text-muted-foreground">
              {dossiers.length} dossier{dossiers.length !== 1 ? "s" : ""} in your workspace.
            </p>
          </div>
          <BatchProcessButton dossierIds={pendingIds} />
        </div>
        <DossierTable dossiers={dossiers} />
      </div>
    </div>
  );
}
