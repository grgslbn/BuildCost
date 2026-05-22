import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RefreshUsageButton } from "@/components/billing/refresh-usage-button";

export const dynamic = "force-dynamic";

type UsageRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  month: string;
  estimation_count: number;
  completed_count: number;
  errored_count: number;
  total_tokens_input: number;
  total_tokens_output: number;
  estimated_cost_usd: number;
  total_processing_ms: number;
};

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

function fmtMonth(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

async function fetchUsage() {
  const admin = createSupabaseAdminClient();

  const [usageRes, tenantsRes] = await Promise.all([
    admin
      .from("tenant_usage_monthly")
      .select("*")
      .order("month", { ascending: false }),
    admin.from("tenants").select("id, name, slug"),
  ]);

  const tenantMap: Record<string, { name: string; slug: string }> = {};
  for (const t of tenantsRes.data ?? []) {
    tenantMap[t.id] = { name: t.name, slug: t.slug };
  }

  return (usageRes.data ?? []).map((r) => ({
    ...r,
    tenant_name: tenantMap[r.tenant_id]?.name ?? r.tenant_id,
    tenant_slug: tenantMap[r.tenant_id]?.slug ?? "",
  })) as UsageRow[];
}

export default async function AdminBillingPage() {
  const rows = await fetchUsage();

  // Aggregate totals across all tenants for current month
  const thisMonth = new Date();
  thisMonth.setDate(1);
  const currentMonthStr = thisMonth.toISOString().slice(0, 7);

  const thisMonthRows = rows.filter((r) => r.month.startsWith(currentMonthStr));
  const totals = thisMonthRows.reduce(
    (acc, r) => ({
      estimations: acc.estimations + r.estimation_count,
      tokens_in: acc.tokens_in + r.total_tokens_input,
      tokens_out: acc.tokens_out + r.total_tokens_output,
      cost_usd: acc.cost_usd + Number(r.estimated_cost_usd),
    }),
    { estimations: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0 }
  );

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Billing overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Usage per tenant, refreshed on-demand from the materialized view.
          </p>
        </div>
        <RefreshUsageButton />
      </div>

      {/* This-month summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardDescription>Estimations this month</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-semibold">{fmt(totals.estimations)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardDescription>Tokens in</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-semibold">{fmt(totals.tokens_in)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardDescription>Tokens out</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-semibold">{fmt(totals.tokens_out)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardDescription>Est. cost (USD)</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-semibold">${totals.cost_usd.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Full usage table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage by tenant & month</CardTitle>
          <CardDescription>
            Sonnet pricing: $3/MTok input, $15/MTok output
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6">
              No usage data yet. Run a customer estimation to populate this view.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Estimations</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                  <TableHead className="text-right">Tokens in</TableHead>
                  <TableHead className="text-right">Tokens out</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.tenant_id}-${r.month}-${i}`}>
                    <TableCell>
                      <div className="font-medium">{r.tenant_name}</div>
                      <div className="text-xs text-muted-foreground">{r.tenant_slug}</div>
                    </TableCell>
                    <TableCell>{fmtMonth(r.month)}</TableCell>
                    <TableCell className="text-right">{fmt(r.estimation_count)}</TableCell>
                    <TableCell className="text-right">{fmt(r.completed_count)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(r.total_tokens_input)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(r.total_tokens_output)}</TableCell>
                    <TableCell className="text-right font-medium">${Number(r.estimated_cost_usd).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
