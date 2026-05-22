import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";

// POST /api/admin/tenants/[id]/invite — invite a user to a tenant
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithRole();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: tenantId } = await params;
  const { email, full_name } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  // Verify tenant exists
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  // Check if user already exists in this tenant
  const { data: existingUser } = await admin
    .from("users")
    .select("id, email")
    .eq("email", email)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existingUser) {
    return NextResponse.json({ error: "User already exists in this tenant" }, { status: 409 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Invite the user via Supabase auth — sends a magic link email
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo: `${appUrl}/auth/callback?next=/customer/overview`,
      data: { full_name: full_name ?? null },
    }
  );

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  const authUserId = inviteData.user.id;

  // Create profile row in users table
  const { error: profileError } = await admin.from("users").upsert(
    {
      id: authUserId,
      tenant_id: tenantId,
      email,
      full_name: full_name ?? null,
      role: "customer",
      invited_by: session.authUser.id,
      invited_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (profileError) {
    console.error("[invite] Failed to create user profile:", profileError);
    return NextResponse.json({ error: "User invited but profile creation failed" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    user: { id: authUserId, email, tenant_id: tenantId },
  });
}
