import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

const ACCENT = "#C85A2A";

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

export default async function CustomerOverviewPage() {
  const session = SKIP_AUTH ? null : await getSessionWithRole();
  if (!SKIP_AUTH && (!session || session.isAdmin)) redirect("/dashboard");

  const tenantId = session?.profile.tenant_id ?? DEV_TENANT_ID;
  const admin = createSupabaseAdminClient();

  const [estimationsRes, usageRes] = await Promise.all([
    admin
      .from("estimations")
      .select("id, created_at, status, estimated_total_cost, postcode, building_type, finishing_coefficient, plan_file_name")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("tenant_usage_monthly")
      .select("estimation_count, completed_count, estimated_cost_usd")
      .eq("tenant_id", tenantId)
      .order("month", { ascending: false })
      .limit(1),
  ]);

  const recent = estimationsRes.data ?? [];
  const thisMonth = usageRes.data?.[0];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1
          style={{
            fontFamily: "var(--font-bricolage), sans-serif",
            fontWeight: 700,
            fontSize: "1.75rem",
            color: "#1a1a1a",
          }}
        >
          Welcome back
        </h1>
        <p style={{ color: "#666", marginTop: "0.25rem", fontSize: "0.9375rem" }}>
          Here&apos;s a summary of your reconstruction cost estimates.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Estimations this month", value: thisMonth?.estimation_count ?? 0 },
          { label: "Completed", value: thisMonth?.completed_count ?? 0 },
          { label: "Est. API cost", value: thisMonth ? `$${Number(thisMonth.estimated_cost_usd).toFixed(2)}` : "$0.00" },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "#fff",
              border: "1px solid #e8e3dc",
              borderRadius: "0.75rem",
              padding: "1.25rem 1.5rem",
            }}
          >
            <p style={{ fontSize: "0.8125rem", color: "#888", marginBottom: "0.375rem" }}>{s.label}</p>
            <p style={{ fontSize: "1.5rem", fontWeight: 600, color: "#1a1a1a" }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Recent estimations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 style={{ fontWeight: 600, fontSize: "1rem" }}>Recent estimations</h2>
          <Link
            href="/customer/estimations"
            style={{ fontSize: "0.875rem", color: ACCENT, textDecoration: "none", fontWeight: 500 }}
          >
            View all →
          </Link>
        </div>

        {recent.length === 0 ? (
          <div
            style={{
              background: "#fff",
              border: "1px solid #e8e3dc",
              borderRadius: "0.75rem",
              padding: "2.5rem",
              textAlign: "center",
              color: "#888",
              fontSize: "0.9375rem",
            }}
          >
            No estimations yet.{" "}
            <Link href="/estimate" style={{ color: ACCENT, textDecoration: "none", fontWeight: 500 }}>
              Run your first estimation →
            </Link>
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
            {recent.map((e, idx) => (
              <Link
                key={e.id}
                href={`/customer/estimations/${e.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
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
                  <p style={{ fontSize: "0.8125rem", color: "#888", marginTop: "0.125rem" }}>
                    {e.building_type ?? "Building"} · {e.postcode ?? "—"} · {fmt(e.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span style={{ fontWeight: 600, fontSize: "1rem", color: "#1a1a1a" }}>
                    {fmtCost(e.estimated_total_cost)}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 500,
                      color: statusColor(e.status),
                      background: `${statusColor(e.status)}15`,
                      padding: "0.2rem 0.6rem",
                      borderRadius: "999px",
                    }}
                  >
                    {e.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* New estimation CTA */}
      <div
        style={{
          background: `${ACCENT}0d`,
          border: `1px solid ${ACCENT}33`,
          borderRadius: "0.75rem",
          padding: "1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <p style={{ fontWeight: 600, color: "#1a1a1a" }}>Run a new estimation</p>
          <p style={{ fontSize: "0.875rem", color: "#666", marginTop: "0.25rem" }}>
            Upload a floor plan and get a precise reconstruction cost in minutes.
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
            whiteSpace: "nowrap",
          }}
        >
          New estimation
        </Link>
      </div>
    </div>
  );
}
