import { redirect } from "next/navigation";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

export const dynamic = "force-dynamic";

const ACCENT = "#C85A2A";

function fmtMonth(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

export default async function CustomerUsagePage() {
  const session = SKIP_AUTH ? null : await getSessionWithRole();
  if (!SKIP_AUTH && (!session || session.isAdmin)) redirect("/dashboard");

  const tenantId = session?.profile.tenant_id ?? DEV_TENANT_ID;
  const admin = createSupabaseAdminClient();

  const { data: usage } = await admin
    .from("tenant_usage_monthly")
    .select("month, estimation_count, completed_count, errored_count, total_tokens_input, total_tokens_output, estimated_cost_usd, total_processing_ms")
    .eq("tenant_id", tenantId)
    .order("month", { ascending: false });

  const rows = usage ?? [];
  const current = rows[0];

  return (
    <div className="space-y-8">
      <div>
        <h1
          style={{
            fontFamily: "var(--font-bricolage), sans-serif",
            fontWeight: 700,
            fontSize: "1.75rem",
            color: "#1a1a1a",
          }}
        >
          Usage
        </h1>
        <p style={{ color: "#666", marginTop: "0.25rem", fontSize: "0.9375rem" }}>
          Your estimation usage and API consumption.
        </p>
      </div>

      {/* Current month summary */}
      {current && (
        <div>
          <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.75rem" }}>
            {fmtMonth(current.month)} — current period
          </p>
          <div className="grid grid-cols-2 gap-4" style={{ maxWidth: "480px" }}>
            {[
              { label: "Estimations run", value: fmt(current.estimation_count) },
              { label: "Completed", value: fmt(current.completed_count) },
              { label: "Tokens consumed", value: fmt(current.total_tokens_input + current.total_tokens_output) },
              { label: "Est. API cost (USD)", value: `$${Number(current.estimated_cost_usd).toFixed(2)}` },
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
        </div>
      )}

      {/* History table */}
      <div>
        <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.75rem" }}>
          History
        </p>
        {rows.length === 0 ? (
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
            No usage data yet.
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
                gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr",
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
              <span>Month</span>
              <span style={{ textAlign: "right" }}>Estimations</span>
              <span style={{ textAlign: "right" }}>Completed</span>
              <span style={{ textAlign: "right" }}>Tokens</span>
              <span style={{ textAlign: "right" }}>Est. cost</span>
            </div>

            {rows.map((r, idx) => (
              <div
                key={`${r.month}-${idx}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr",
                  gap: "1rem",
                  alignItems: "center",
                  padding: "0.875rem 1.25rem",
                  borderTop: idx > 0 ? "1px solid #f0ece6" : "none",
                  fontSize: "0.9375rem",
                }}
              >
                <span style={{ fontWeight: 500, color: "#1a1a1a" }}>{fmtMonth(r.month)}</span>
                <span style={{ textAlign: "right", color: "#444" }}>{fmt(r.estimation_count)}</span>
                <span style={{ textAlign: "right", color: "#444" }}>{fmt(r.completed_count)}</span>
                <span style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.8125rem", color: "#555" }}>
                  {fmt(r.total_tokens_input + r.total_tokens_output)}
                </span>
                <span style={{ textAlign: "right", fontWeight: 600, color: ACCENT }}>
                  ${Number(r.estimated_cost_usd).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
