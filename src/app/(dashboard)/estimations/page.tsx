import Link from "next/link";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatEur(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  complete:       { label: "Complete",   variant: "default" },
  uploading:      { label: "Uploading",  variant: "secondary" },
  extracting_sqm: { label: "Processing", variant: "secondary" },
  analyzing_qqp:  { label: "Processing", variant: "secondary" },
  calculating:    { label: "Processing", variant: "secondary" },
  error:          { label: "Error",      variant: "destructive" },
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
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
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
    created_at: string | null;
  };

  let estimations: EstimationRow[] = [];

  if (tenantId) {
    const { data } = await admin
      .from("estimations")
      .select(
        "id, plan_file_name, postcode, building_type, total_livable_sqm, finishing_level, estimated_total_cost, status, created_at"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100);

    estimations = (data ?? []) as unknown as EstimationRow[];
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Estimations</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {estimations.length} estimation{estimations.length !== 1 ? "s" : ""} total
            </p>
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
          <CardHeader className="pb-3">
            <CardTitle className="text-base">All Estimations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {estimations.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <p className="text-sm text-muted-foreground">No estimations yet.</p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/estimate">Create your first estimation</Link>
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Postcode</TableHead>
                    <TableHead>Building type</TableHead>
                    <TableHead className="text-right">Livable m²</TableHead>
                    <TableHead>Finishing</TableHead>
                    <TableHead className="text-right">Total cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estimations.map((est) => {
                    const meta = STATUS_META[est.status] ?? { label: est.status, variant: "outline" as const };
                    return (
                      <TableRow key={est.id} className="cursor-pointer hover:bg-muted/50">
                        <TableCell>
                          <Link
                            href={`/estimations/${est.id}`}
                            className="block w-full font-medium text-foreground hover:underline"
                          >
                            {est.plan_file_name ?? "—"}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {est.postcode ?? "—"}
                        </TableCell>
                        <TableCell className="capitalize text-muted-foreground">
                          {est.building_type ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {est.total_livable_sqm != null
                            ? `${est.total_livable_sqm.toFixed(1)} m²`
                            : "—"}
                        </TableCell>
                        <TableCell className="capitalize text-muted-foreground">
                          {est.finishing_level ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatEur(est.estimated_total_cost)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
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
