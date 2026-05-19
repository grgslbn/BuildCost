import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProcessingControls } from "@/components/dossiers/processing-controls";
import { SqmResults } from "@/components/dossiers/sqm-results";
import { QqpResults } from "@/components/dossiers/qqp-results";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "secondary",
  extracting_sqm: "outline",
  sqm_done: "outline",
  extracting_qqp: "outline",
  analyzed: "default",
  validated: "default",
  error: "destructive",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

export default async function DossierDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const admin = createSupabaseAdminClient();

  const { data: userRow } = await admin
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (!userRow?.tenant_id) notFound();

  const { data: dossier, error } = await admin
    .from("reference_dossiers")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", userRow.tenant_id)
    .single();

  if (error || !dossier) notFound();

  // Signed URL for plan preview (1 hour)
  let planUrl: string | null = null;
  if (dossier.plan_storage_path) {
    const { data: signed } = await admin.storage
      .from("plans")
      .createSignedUrl(dossier.plan_storage_path, 3600);
    planUrl = signed?.signedUrl ?? null;
  }

  const isImage = dossier.plan_file_type === "image";

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link href="/admin/dossiers">← Back to dossiers</Link>
        </Button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {dossier.address ?? "Untitled dossier"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {[dossier.postcode, dossier.municipality, dossier.building_type]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Badge
            variant={STATUS_VARIANT[dossier.status] ?? "secondary"}
            className="mt-1 capitalize"
          >
            {dossier.status?.replace(/_/g, " ")}
          </Badge>
        </div>
      </div>

      <Separator />

      <div className="grid gap-6 md:grid-cols-2">
        {/* Known data */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Known data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <InfoRow
              label="Known price/m²"
              value={
                dossier.known_price_per_sqm != null
                  ? new Intl.NumberFormat("fr-BE", {
                      style: "currency",
                      currency: "EUR",
                    }).format(dossier.known_price_per_sqm)
                  : "—"
              }
            />
            <InfoRow
              label="Total price"
              value={
                dossier.known_total_price != null
                  ? new Intl.NumberFormat("fr-BE", {
                      style: "currency",
                      currency: "EUR",
                      maximumFractionDigits: 0,
                    }).format(dossier.known_total_price)
                  : "—"
              }
            />
            <InfoRow
              label="Total area"
              value={
                dossier.known_total_sqm != null
                  ? `${dossier.known_total_sqm} m²`
                  : "—"
              }
            />
            <InfoRow
              label="Finishing coefficient"
              value={
                dossier.known_finishing_coefficient != null
                  ? dossier.known_finishing_coefficient.toFixed(3)
                  : "—"
              }
            />
            <InfoRow
              label="Finishing level"
              value={dossier.expert_finishing_level ?? "—"}
            />
            <InfoRow
              label="ABEX reference"
              value={
                dossier.price_abex_year
                  ? `${dossier.price_abex_year} S${dossier.price_abex_semester}`
                  : "—"
              }
            />
            {dossier.expert_notes && (
              <div className="border-t pt-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Expert notes
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dossier.expert_notes}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Processing + plan preview */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Processing</CardTitle>
            </CardHeader>
            <CardContent>
              <ProcessingControls
                dossierId={dossier.id}
                initialStatus={dossier.status}
              />
              {dossier.status === "error" && dossier.error_message && (
                <p className="mt-2 text-sm text-destructive">
                  {dossier.error_message}
                </p>
              )}
            </CardContent>
          </Card>

          {planUrl && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Plan</CardTitle>
              </CardHeader>
              <CardContent>
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={planUrl}
                    alt="Building plan"
                    className="w-full max-h-72 rounded-md border object-contain"
                  />
                ) : (
                  <a
                    href={planUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {dossier.plan_file_name ?? "Open file"} ↗
                  </a>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Results */}
      {(dossier.sqm_extraction || dossier.qqp_extraction) && (
        <>
          <Separator />
          <Tabs defaultValue={dossier.sqm_extraction ? "sqm" : "qqp"}>
            <TabsList>
              {dossier.sqm_extraction && (
                <TabsTrigger value="sqm">Room extraction</TabsTrigger>
              )}
              {dossier.qqp_extraction && (
                <TabsTrigger value="qqp">QQP analysis</TabsTrigger>
              )}
            </TabsList>

            {dossier.sqm_extraction && (
              <TabsContent value="sqm" className="mt-4">
                <SqmResults
                  data={
                    dossier.sqm_extraction as Parameters<
                      typeof SqmResults
                    >[0]["data"]
                  }
                />
              </TabsContent>
            )}

            {dossier.qqp_extraction && (
              <TabsContent value="qqp" className="mt-4">
                <QqpResults
                  data={
                    dossier.qqp_extraction as Parameters<
                      typeof QqpResults
                    >[0]["data"]
                  }
                  knownCoefficient={dossier.known_finishing_coefficient}
                />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
    </div>
  );
}
