import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";

// GET /api/admin/tenants — list all tenants with user counts
export async function GET() {
  const session = await getSessionWithRole();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch user counts per tenant
  const { data: userCounts } = await admin
    .from("users")
    .select("tenant_id")
    .in("tenant_id", (tenants ?? []).map((t) => t.id));

  const countMap: Record<string, number> = {};
  for (const u of userCounts ?? []) {
    countMap[u.tenant_id] = (countMap[u.tenant_id] ?? 0) + 1;
  }

  const result = (tenants ?? []).map((t) => ({
    ...t,
    user_count: countMap[t.id] ?? 0,
  }));

  return NextResponse.json({ tenants: result });
}

// POST /api/admin/tenants — create a new tenant
export async function POST(req: NextRequest) {
  const session = await getSessionWithRole();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, slug } = await req.json();
  if (!name || !slug) {
    return NextResponse.json({ error: "name and slug are required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .insert({ name, slug })
    .select("id, name, slug, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ tenant: data }, { status: 201 });
}
