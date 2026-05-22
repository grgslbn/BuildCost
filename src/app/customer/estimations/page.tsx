import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

const ACCENT = "#C85A2A";

const FINISHING_LABELS: Record<string, string> = {
  basic: "Basic",
  standard: "Standard",
  comfort: "Comfort",
  "comfort+": "Comfort+",
  luxury: "Luxury",
  premium: "Premium",
};

function statusColor(status: string) {
  if (status === "complete") return "#16a34a";
  if (status === "error") return "#dc2626";
  return "#d97706";
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtCost(cost: number | null) {
  if (!cost) return "—";
  return new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cost);
}

export default async function CustomerEstimationsPage() {
  const session = SKIP_AUTH ? null : await getSessionWithRole();
  if (!SKIP_AUTH && (!session || session.isAdmin)) redirect("/dashboard");

  const tenantId = session?.profile.tenant_id ?? DEV_TENANT_ID;
  const admin = createSupabaseAdminClient();

  const { data: estimations } = await admin
    .from("estimations")
    .select("id, created_at, status, estimated_total_cost, postcode, building_type, finishing_coefficient, plan_file_name, sqm_confidence, qqp_confidence, overall_confidence")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  const rows = estimations ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1
            style={{
              fontFamily: "var(--font-bricolage), sans-serif",
              fontWeight: 700,
              fontSize: "1.75rem",
              color: "#1a1a1a",
            }}
          >
            Estimations
          </h1>
          <p style={{ color: "#666", marginTop: "0.25rem", fontSize: "0.9375rem" }}>
            {rows.length} estimation{rows.length !== 1 ? "s" : ""} in your account
          </p>
        </div>
        <Link
          href="/estimate"
          style={{
            background: ACCENT,
            color: "#fff",
            padding: "0.625rem 1.25rem",
            borderRadius: "0.5rem",
            fontWeight: 600,
            fontSize: "0.9375rem",
            textDecoration: "none",
          }}
        >
          + New estimation
        </Link>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e8e3dc",
            borderRadius: "0.75rem",
            padding: "3rem",
            textAlign: "center",
            color: "#888",
          }}
        >
          <p style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>No estimations yet</p>
          <p style={{ fontSize: "0.875rem" }}>
            Upload a floor plan to get your first reconstruction cost estimate.
          </p>
        </div>
      ) : (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e8e3dc",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: "1rem",
              padding: "0.75rem 1.25rem",
              borderBottom: "1px solid #f0ece6",
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            <span>Plan</span>
            <span style={{ textAlign: "right" }}>Total cost</span>
            <span style={{ textAlign: "center" }}>Finishing</span>
            <span style={{ textAlign: "center" }}>Status</span>
          </div>

          {rows.map((e, idx) => {
            const finLabel = e.finishing_coefficient != null
              ? e.finishing_coefficient < 0.85 ? "Basic"
              : e.finishing_coefficient < 1.0 ? "Standard"
              : e.finishing_coefficient < 1.15 ? "Comfort"
              : e.finishing_coefficient < 1.30 ? "Comfort+"
              : "Luxury"
              : "—";

            return (
              <Link
                key={e.id}
                href={`/customer/estimations/${e.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto",
                  gap: "1rem",
                  alignItems: "center",
                  padding: "0.875rem 1.25rem",
                  borderTop: idx > 0 ? "1px solid #f0ece6" : "none",
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background 0.1s",
                }}
                className="hover:bg-stone-50"
              >
                <div>
                  <p style={{ fontWeight: 500, fontSize: "0.9375rem", color: "#1a1a1a" }}>
                    {e.plan_file_name ?? "Unnamed plan"}
                  </p>
                  <p style={{ fontSize: "0.8125rem", color: "#888", marginTop: "0.1rem" }}>
                    {e.building_type ?? "Building"} · {e.postcode ?? "—"} · {fmt(e.created_at)}
                  </p>
                </div>
                <span style={{ fontWeight: 600, fontSize: "1rem", color: "#1a1a1a", textAlign: "right" }}>
                  {fmtCost(e.estimated_total_cost)}
                </span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: "#555",
                    background: "#f5f0ea",
                    padding: "0.2rem 0.6rem",
                    borderRadius: "999px",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                  }}
                >
                  {finLabel}
                </span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    color: statusColor(e.status),
                    background: `${statusColor(e.status)}15`,
                    padding: "0.2rem 0.6rem",
                    borderRadius: "999px",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.status}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
