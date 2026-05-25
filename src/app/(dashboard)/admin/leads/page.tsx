import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { PUBLIC_TENANT_ID } from "@/lib/dev-auth";
import { LeadsTable, type LeadRow } from "@/components/leads/leads-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EstimationLite = {
  id: string;
  plan_file_name: string | null;
  postcode: string | null;
  building_type: string | null;
  total_livable_sqm: number | null;
  estimated_total_cost: number | null;
};

export default async function LeadsPage() {
  const admin = createSupabaseAdminClient();

  const [leadsRes, publicEstCountRes] = await Promise.all([
    admin
      .from("leads")
      .select("id, email, company, role, intent, volume, region, estimation_id, email_sent, email_sent_at, email_error, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    admin
      .from("estimations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", PUBLIC_TENANT_ID),
  ]);

  type RawLead = {
    id: string;
    email: string;
    company: string | null;
    role: string | null;
    intent: string | null;
    volume: string | null;
    region: string | null;
    estimation_id: string | null;
    email_sent: boolean | null;
    email_sent_at: string | null;
    email_error: string | null;
    created_at: string;
  };
  const rawLeads = (leadsRes.data ?? []) as RawLead[];

  const estIds = Array.from(
    new Set(rawLeads.map((l) => l.estimation_id).filter((v): v is string => !!v))
  );

  let estMap = new Map<string, EstimationLite>();
  if (estIds.length > 0) {
    const { data: ests } = await admin
      .from("estimations")
      .select("id, plan_file_name, postcode, building_type, total_livable_sqm, estimated_total_cost")
      .in("id", estIds);
    estMap = new Map(((ests ?? []) as EstimationLite[]).map((e) => [e.id, e]));
  }

  const leads: LeadRow[] = rawLeads.map((l) => {
    const e = l.estimation_id ? estMap.get(l.estimation_id) ?? null : null;
    return {
      id: l.id,
      email: l.email,
      company: l.company,
      role: l.role,
      intent: l.intent,
      volume: l.volume,
      region: l.region,
      created_at: l.created_at,
      email_sent: l.email_sent ?? false,
      email_sent_at: l.email_sent_at,
      email_error: l.email_error,
      estimation: e
        ? {
            id: e.id,
            plan_file_name: e.plan_file_name,
            postcode: e.postcode,
            building_type: e.building_type,
            total_livable_sqm: e.total_livable_sqm == null ? null : Number(e.total_livable_sqm),
            estimated_total_cost: e.estimated_total_cost == null ? null : Number(e.estimated_total_cost),
          }
        : null,
    };
  });

  const pendingEmails = leads.filter(
    (l) => l.estimation && !l.email_sent
  ).length;

  // Stats
  const total = leads.length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = leads.filter((l) => new Date(l.created_at).getTime() >= weekAgo).length;
  const withEst = leads.filter((l) => l.estimation != null).length;
  const totalPublicEstimations = publicEstCountRes.count ?? 0;
  const conversionRate =
    totalPublicEstimations > 0
      ? (withEst / totalPublicEstimations) * 100
      : null;

  const postcodeCounts = new Map<string, number>();
  for (const l of leads) {
    const pc = l.estimation?.postcode;
    if (pc) postcodeCounts.set(pc, (postcodeCounts.get(pc) ?? 0) + 1);
  }
  const topPostcode = Array.from(postcodeCounts.entries()).sort((a, b) => b[1] - a[1])[0] ?? null;

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{total} total</span>
            <span>·</span>
            <span>{thisWeek} this week</span>
            <span>·</span>
            <span>{withEst} with estimations</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total leads" value={total.toLocaleString()} />
          <StatCard label="This week" value={thisWeek.toLocaleString()} />
          <StatCard
            label="Conversion rate"
            value={conversionRate == null ? "—" : `${conversionRate.toFixed(1)}%`}
            hint={
              totalPublicEstimations > 0
                ? `${withEst}/${totalPublicEstimations} public estimations`
                : "no public estimations yet"
            }
          />
          <StatCard
            label="Top postcode"
            value={topPostcode ? topPostcode[0] : "—"}
            hint={topPostcode ? `${topPostcode[1]} lead${topPostcode[1] === 1 ? "" : "s"}` : ""}
          />
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
            <CardTitle className="text-base">All leads</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <LeadsTable leads={leads} pendingEmails={pendingEmails} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
