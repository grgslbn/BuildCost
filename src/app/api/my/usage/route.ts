import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";

// GET /api/my/usage — own tenant's usage stats
export async function GET() {
  const session = await getSessionWithRole();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const tenantId = session.profile.tenant_id;

  const { data: usage, error } = await admin
    .from("tenant_usage_monthly")
    .select("tenant_id, month, estimation_count, completed_count, errored_count, total_tokens_input, total_tokens_output, estimated_cost_usd, total_processing_ms")
    .eq("tenant_id", tenantId)
    .order("month", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ usage: usage ?? [] });
}
