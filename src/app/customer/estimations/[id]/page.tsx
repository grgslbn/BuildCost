import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSessionWithRole } from "@/lib/auth/get-session-with-role";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import { ShareButtons } from "@/components/customer/share-buttons";

export const dynamic = "force-dynamic";

const ACCENT = "#C85A2A";

function fmtCost(cost: number | null) {
  if (!cost) return "—";
  return new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cost);
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusColor(status: string) {
  if (status === "complete") return "#16a34a";
  if (status === "error") return "#dc2626";
  return "#d97706";
}

function finishingLabel(coeff: number | null) {
  if (!coeff) return "—";
  if (coeff < 0.85) return "Basic";
  if (coeff < 1.0) return "Standard";
  if (coeff < 1.15) return "Comfort";
  if (coeff < 1.30) return "Comfort+";
  return "Luxury";
}

function pct(v: number | null) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

export default async function CustomerEstimationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = SKIP_AUTH ? null : await getSessionWithRole();
  if (!SKIP_AUTH && (!session || session.isAdmin)) redirect("/dashboard");

  const tenantId = session?.profile.tenant_id ?? DEV_TENANT_ID;
  const admin = createSupabaseAdminClient();

  const { data: estimation } = await admin
    .from("estimations")
    .select(
      "id, created_at, status, estimated_total_cost, postcode, building_type, finishing_coefficient, plan_file_name, sqm_confidence, qqp_confidence, overall_confidence, sqm_extraction, tenant_id, processing_time_ms"
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!estimation) notFound();

  const sqm = estimation.sqm_extraction as Record<string, unknown> | null;
  const summary = sqm?.summary as Record<string, unknown> | null;
  const totalSqm =
    (summary?.total_livable_sqm as number | null) ??
    (summary?.total_gross_sqm as number | null) ??
    null;

  const processingSeconds = estimation.processing_time_ms
    ? Math.round(estimation.processing_time_ms / 1000)
    : null;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Back */}
      <Link
        href="/customer/estimations"
        style={{ fontSize: "0.875rem", color: "#888", textDecoration: "none" }}
      >
        ← Back to estimations
      </Link>

      {/* Hero cost card */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e8e3dc",
          borderRadius: "1rem",
          padding: "2rem",
        }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p style={{ fontSize: "0.875rem", color: "#888", marginBottom: "0.25rem" }}>
              Reconstruction cost estimate
            </p>
            <p
              style={{
                fontFamily: "var(--font-bricolage), sans-serif",
                fontWeight: 700,
                fontSize: "2.5rem",
                color: ACCENT,
                lineHeight: 1.1,
              }}
            >
              {fmtCost(estimation.estimated_total_cost)}
            </p>
          </div>
          <span
            style={{
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: statusColor(estimation.status),
              background: `${statusColor(estimation.status)}15`,
              padding: "0.3rem 0.75rem",
              borderRadius: "999px",
            }}
          >
            {estimation.status}
          </span>
        </div>

        <div
          style={{
            marginTop: "1.5rem",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1rem",
          }}
        >
          {[
            { label: "Building type", value: estimation.building_type ?? "—" },
            { label: "Postcode", value: estimation.postcode ?? "—" },
            { label: "Finishing", value: finishingLabel(estimation.finishing_coefficient) },
            { label: "Total area", value: totalSqm ? `${Math.round(totalSqm)} m²` : "—" },
            { label: "Confidence", value: pct(estimation.overall_confidence) },
            {
              label: "Processed in",
              value: processingSeconds ? `${processingSeconds}s` : "—",
            },
          ].map((item) => (
            <div key={item.label}>
              <p style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.2rem" }}>
                {item.label}
              </p>
              <p style={{ fontWeight: 500, fontSize: "0.9375rem", color: "#1a1a1a" }}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Confidence breakdown */}
      {(estimation.sqm_confidence != null || estimation.qqp_confidence != null) && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e8e3dc",
            borderRadius: "0.75rem",
            padding: "1.25rem 1.5rem",
          }}
        >
          <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.75rem" }}>
            Confidence breakdown
          </p>
          {[
            { label: "Area extraction (SQM)", value: estimation.sqm_confidence },
            { label: "Finishing quality (QQP)", value: estimation.qqp_confidence },
            { label: "Overall", value: estimation.overall_confidence },
          ].map((item) => (
            <div key={item.label} style={{ marginBottom: "0.625rem" }}>
              <div className="flex justify-between" style={{ marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "0.8125rem", color: "#555" }}>{item.label}</span>
                <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: "#1a1a1a" }}>
                  {pct(item.value)}
                </span>
              </div>
              <div style={{ background: "#f0ece6", borderRadius: "999px", height: "6px" }}>
                <div
                  style={{
                    width: `${Math.round((item.value ?? 0) * 100)}%`,
                    height: "100%",
                    background: ACCENT,
                    borderRadius: "999px",
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sharing */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e8e3dc",
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
        }}
      >
        <p style={{ fontWeight: 600, fontSize: "0.9375rem", marginBottom: "0.75rem" }}>
          Share this report
        </p>
        <ShareButtons estimationId={estimation.id} />
      </div>

      {/* Meta */}
      <p style={{ fontSize: "0.8125rem", color: "#aaa" }}>
        Created {fmt(estimation.created_at)} · {estimation.plan_file_name ?? "plan"}
      </p>
    </div>
  );
}
