import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";

// GET /api/admin/usage — cross-tenant usage for billing overview
export async function GET() {
  const session = await getSessionWithRole();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();

  const [usageRes, tenantsRes] = await Promise.all([
    admin
      .from("tenant_usage_monthly")
      .select("tenant_id, month, estimation_count, completed_count, errored_count, total_tokens_input, total_tokens_output, estimated_cost_usd, total_processing_ms")
      .order("month", { ascending: false }),
    admin
      .from("tenants")
      .select("id, name, slug"),
  ]);

  const tenantMap: Record<string, { name: string; slug: string }> = {};
  for (const t of tenantsRes.data ?? []) {
    tenantMap[t.id] = { name: t.name, slug: t.slug };
  }

  const rows = (usageRes.data ?? []).map((r) => ({
    ...r,
    tenant_name: tenantMap[r.tenant_id]?.name ?? r.tenant_id,
    tenant_slug: tenantMap[r.tenant_id]?.slug ?? "",
  }));

  return NextResponse.json({ usage: rows });
}
