import { NextResponse, type NextRequest } from "next/server";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { ensureTenantAndUser } from "@/lib/auth/provision-user";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? origin;

  if (!code) {
    return NextResponse.redirect(`${appUrl}/login?error=missing_code`);
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    return NextResponse.redirect(
      `${appUrl}/login?error=${encodeURIComponent(error?.message ?? "auth_failed")}`
    );
  }

  try {
    const admin = createSupabaseAdminClient();
    await ensureTenantAndUser(admin, {
      id: data.user.id,
      email: data.user.email,
    });
  } catch (err) {
    console.error("Failed to provision tenant/user", err);
    return NextResponse.redirect(`${appUrl}/login?error=provisioning_failed`);
  }

  return NextResponse.redirect(`${appUrl}${next}`);
}
