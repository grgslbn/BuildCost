import Link from "next/link";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle, Loader2 } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEur(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(v);
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-BE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

const PROCESSING = new Set(["uploading", "extracting_sqm", "analyzing_qqp", "calculating"]);

type StatusMeta = { label: string; cls: string; spin?: boolean };

function getStatusMeta(status: string): StatusMeta {
  if (status === "complete") return { label: "Complete", cls: "bg-green-100 text-green-700" };
  if (status === "error")    return { label: "Error",    cls: "bg-red-100 text-red-700"     };
  if (PROCESSING.has(status)) return { label: "Processing", cls: "bg-amber-100 text-amber-700", spin: true };
  return { label: status, cls: "bg-slate-100 text-slate-600" };
}

const LEVEL_COLORS: Record<string, string> = {
  basic:      "bg-slate-100 text-slate-600",
  standard:   "bg-blue-50 text-blue-700",
  comfort:    "bg-emerald-50 text-emerald-700",
  "comfort+": "bg-orange-50 text-orange-700",
  luxury:     "bg-purple-50 text-purple-700",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function EstimationsPage() {
  const admin = createSupabaseAdminClient();

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

  type EstimationRow = {
    id: string;
    plan_file_name: string | null;
    postcode: string | null;
    building_type: string | null;
    total_livable_sqm: number | null;
    finishing_level: string | null;
    estimated_total_cost: number | null;
    status: string;
    source: string | null;
    created_at: string | null;
  };

  let estimations: EstimationRow[] = [];
  if (tenantId) {
    // Include both the user's tenant and the public tenant so the internal
    // team can see landing-page submissions alongside their own work.
    const { data } = await admin
      .from("estimations")
      .select("id, plan_file_name, postcode, building_type, total_livable_sqm, finishing_level, estimated_total_cost, status, source, created_at")
      .in("tenant_id", [tenantId, "00000000-0000-0000-0000-000000000002"])
      .order("created_at", { ascending: false })
      .limit(200);
    estimations = (data ?? []) as unknown as EstimationRow[];
  }

  const complete   = estimations.filter((e) => e.status === "complete").length;
  const processing = estimations.filter((e) => PROCESSING.has(e.status)).length;
  const errors     = estimations.filter((e) => e.status === "error").length;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-6xl space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Estimations</h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>{estimations.length} total</span>
              {complete > 0    && <span className="text-green-600 font-medium">{complete} complete</span>}
              {processing > 0  && <span className="text-amber-600 font-medium">{processing} processing</span>}
              {errors > 0      && <span className="text-red-500 font-medium">{errors} error{errors !== 1 ? "s" : ""}</span>}
            </div>
          </div>
          <Button asChild>
            <Link href="/estimate">
              <PlusCircle className="mr-2 h-4 w-4" />
              New Estimation
            </Link>
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base">All Estimations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {estimations.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <p className="text-sm text-muted-foreground">No estimations yet.</p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/estimate">Create your first estimation</Link>
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">File</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Postcode</TableHead>
                    <TableHead>Building type</TableHead>
                    <TableHead className="text-right">Livable m²</TableHead>
                    <TableHead>Finishing</TableHead>
                    <TableHead className="text-right">Total cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estimations.map((est) => {
                    const sm   = getStatusMeta(est.status);
                    const lvCls = LEVEL_COLORS[(est.finishing_level ?? "").toLowerCase()] ?? "bg-slate-100 text-slate-600";
                    const isComplete = est.status === "complete";

                    return (
                      <TableRow key={est.id} className="hover:bg-muted/40">
                        <TableCell className="pl-6 max-w-xs">
                          <Link
                            href={`/estimations/${est.id}`}
                            className={`block truncate text-sm font-medium hover:underline ${isComplete ? "text-foreground" : "text-muted-foreground"}`}
                          >
                            {est.plan_file_name ?? "—"}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {est.source === "public" ? (
                            <span className="rounded px-2 py-0.5 text-xs font-semibold bg-orange-50 text-orange-700">
                              Public
                            </span>
                          ) : (
                            <span className="rounded px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-600">
                              Internal
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {est.postcode ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm capitalize">
                          {(est.building_type ?? "—").replace(/_/g, " ")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {est.total_livable_sqm != null
                            ? `${est.total_livable_sqm.toFixed(1)} m²`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {est.finishing_level ? (
                            <span className={`rounded px-2 py-0.5 text-xs font-semibold capitalize ${lvCls}`}>
                              {est.finishing_level}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-sm">
                          {formatEur(est.estimated_total_cost)}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold ${sm.cls}`}>
                            {sm.spin && (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            )}
                            {sm.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm pr-6">
                          {formatDate(est.created_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
