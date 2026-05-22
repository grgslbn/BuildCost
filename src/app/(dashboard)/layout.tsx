import { redirect } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { SKIP_AUTH } from "@/lib/dev-auth";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!SKIP_AUTH) {
    const session = await getSessionWithRole();
    if (!session) redirect("/login");
    // Customers have their own portal — redirect them out of the admin shell
    if (!session.isAdmin) redirect("/customer/overview");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
