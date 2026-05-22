import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";

// POST /api/admin/usage/refresh — refresh the tenant_usage_monthly materialized view
export async function POST() {
  const session = await getSessionWithRole();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("refresh_tenant_usage_monthly");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
