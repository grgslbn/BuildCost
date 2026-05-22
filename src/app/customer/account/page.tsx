import { redirect } from "next/navigation";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import { SKIP_AUTH } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

const ACCENT = "#C85A2A";

export default async function CustomerAccountPage() {
  const session = SKIP_AUTH ? null : await getSessionWithRole();
  if (!SKIP_AUTH && (!session || session.isAdmin)) redirect("/dashboard");

  const profile = session?.profile;

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1
          style={{
            fontFamily: "var(--font-bricolage), sans-serif",
            fontWeight: 700,
            fontSize: "1.75rem",
            color: "#1a1a1a",
          }}
        >
          Account
        </h1>
        <p style={{ color: "#666", marginTop: "0.25rem", fontSize: "0.9375rem" }}>
          Your profile and sign-in details.
        </p>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e8e3dc",
          borderRadius: "0.75rem",
          padding: "1.5rem",
        }}
      >
        <div className="space-y-4">
          {[
            { label: "Email", value: profile?.email ?? "—" },
            { label: "Name", value: profile?.full_name ?? "—" },
            { label: "Role", value: profile?.role ?? "customer" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "1rem", borderBottom: "1px solid #f0ece6" }}>
              <span style={{ fontSize: "0.875rem", color: "#888" }}>{item.label}</span>
              <span style={{ fontSize: "0.9375rem", fontWeight: 500, color: "#1a1a1a" }}>{item.value}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: "0.8125rem", color: "#aaa", marginTop: "1rem" }}>
          To update your profile, contact your account administrator.
        </p>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e8e3dc",
          borderRadius: "0.75rem",
          padding: "1.5rem",
        }}
      >
        <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.5rem" }}>Sign out</p>
        <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1rem" }}>
          You&apos;ll need to use a magic link to sign in again.
        </p>
        <form action="/auth/signout" method="POST">
          <button
            type="submit"
            style={{
              background: "transparent",
              border: "1px solid #e8e3dc",
              borderRadius: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "#555",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
