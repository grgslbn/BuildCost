import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

export type UserProfile = {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "customer";
};

export type SessionWithRole = {
  authUser: { id: string; email: string };
  profile: UserProfile;
  isAdmin: boolean;
};

export async function getSessionWithRole(): Promise<SessionWithRole | null> {
  if (SKIP_AUTH) {
    return {
      authUser: { id: "dev-user", email: "dev@buildcost.local" },
      profile: {
        id: "dev-user",
        tenant_id: DEV_TENANT_ID,
        email: "dev@buildcost.local",
        full_name: "Dev User",
        role: "admin",
      },
      isAdmin: true,
    };
  }

  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("id, tenant_id, email, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile?.tenant_id) return null;

  return {
    authUser: { id: user.id, email: user.email },
    profile: profile as UserProfile,
    isAdmin: profile.role === "admin",
  };
}
