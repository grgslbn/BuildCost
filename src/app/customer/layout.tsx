import { redirect } from "next/navigation";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import { SKIP_AUTH } from "@/lib/dev-auth";
import { CustomerNav } from "@/components/customer/customer-nav";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let tenantName = "BuildCost";

  if (!SKIP_AUTH) {
    const session = await getSessionWithRole();
    if (!session) redirect("/login");
    // Admins have their own dashboard — send them there
    if (session.isAdmin) redirect("/dashboard");

    const { createSupabaseAdminClient } = await import("@/lib/supabase/server");
    const admin = createSupabaseAdminClient();
    const { data: tenant } = await admin
      .from("tenants")
      .select("name")
      .eq("id", session.profile.tenant_id)
      .single();
    if (tenant?.name) tenantName = tenant.name;
  }
  // In SKIP_AUTH mode fall through — dev sees customer portal with default tenant name

  return (
    <div
      className="min-h-screen"
      style={{
        background: "#FBFAF5",
        color: "#1a1a1a",
        fontFamily: "var(--font-geist-sans), sans-serif",
      }}
    >
      <CustomerNav tenantName={tenantName} />
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
