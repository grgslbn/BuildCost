import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Building Reconstruction Estimate — Plan Based",
  description: "AI-powered reconstruction cost estimate for Belgian insurance.",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type EstimationRow = {
  id: string;
  status: string;
  building_type: string | null;
  postcode: string | null;
  created_at: string | null;
  total_livable_sqm: number | null;
  total_gross_sqm: number | null;
  finishing_level: string | null;
  finishing_coefficient: number | null;
  estimated_total_cost: number | null;
  overall_confidence: number | null;
  sub_areas: CostBreakdown | null;
  sqm_extraction: SqmExt | null;
};

type CostBreakdown = {
  cat1_sqm?: number; cat1_price_per_sqm?: number; cat1_cost?: number;
  cat2_sqm?: number; cat2_price_per_sqm?: number; cat2_cost?: number;
  cat3_sqm?: number; cat3_price_per_sqm?: number; cat3_cost?: number;
  subtotal?: number; regional_factor?: number; abex_factor?: number;
  total_cost?: number;
};

type Room   = { id?: string; label?: string; label_en?: string; area_sqm?: number; category?: string };
type Floor  = { level?: number; label_en?: string; label?: string; rooms?: Room[] };
type Bldg   = { id?: string; name?: string; floors?: Floor[] };
type SqmExt = { floors?: Floor[]; buildings?: Bldg[]; summary?: { total_livable_sqm?: number; total_gross_sqm?: number } };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtEur(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v));
}

function fmtSqm(v: number | null | undefined) {
  if (v == null) return "—";
  return `${Number(v).toFixed(1)} m²`;
}

function finishingLabel(coeff: number | null): string {
  if (coeff == null) return "—";
  if (coeff < 0.85) return "Basic";
  if (coeff < 1.0)  return "Standard";
  if (coeff < 1.15) return "Comfort";
  if (coeff < 1.30) return "Comfort+";
  return "Luxury";
}

function confidenceBadge(v: number | null): { label: string; color: string; bg: string } {
  if (v == null) return { label: "—", color: "#888", bg: "#f0f0f0" };
  if (v >= 0.8)  return { label: "High", color: "#15803d", bg: "#dcfce7" };
  if (v >= 0.6)  return { label: "Medium", color: "#b45309", bg: "#fef3c7" };
  return { label: "Low", color: "#b91c1c", bg: "#fee2e2" };
}

function extractFloors(sqmExt: SqmExt | null): Floor[] {
  if (!sqmExt) return [];
  if (sqmExt.buildings?.length) return sqmExt.buildings.flatMap(b => b.floors ?? []);
  return sqmExt.floors ?? [];
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PublicReportPage({ params }: { params: { id: string } }) {
  const admin = createSupabaseAdminClient();

  // No tenant filter — UUID is the secret (unguessable, shareable by design)
  const { data: est, error } = await admin
    .from("estimations")
    .select([
      "id", "status",
      "building_type", "postcode", "created_at",
      "total_livable_sqm", "total_gross_sqm",
      "finishing_level", "finishing_coefficient",
      "estimated_total_cost", "overall_confidence",
      "sub_areas", "sqm_extraction",
    ].join(", "))
    .eq("id", params.id)
    .single();

  if (error || !est) notFound();
  const row = est as unknown as EstimationRow;

  // Postcode municipality lookup (optional)
  const { data: postcodeMeta } = row.postcode
    ? await admin.from("postcode_prices").select("municipality, region").eq("postcode", row.postcode).maybeSingle()
    : { data: null };

  const bd      = row.sub_areas;
  const sqmExt  = row.sqm_extraction;
  const floors  = extractFloors(sqmExt);
  const allRooms: Room[] = floors.flatMap(f => f.rooms ?? []);
  const confidence = confidenceBadge(row.overall_confidence);
  const generatedDate = row.created_at
    ? new Date(row.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  if (row.status !== "complete") {
    return (
      <div className="public-report-root">
        <PublicReportHeader />
        <div className="public-report-pending">
          <h2>Report is being prepared</h2>
          <p>
            {row.status === "error"
              ? "We hit a snag analyzing this plan. Our team will follow up."
              : "We're still analyzing your plan. Check back shortly."}
          </p>
        </div>
        <PublicReportFooter />
      </div>
    );
  }

  const subtotal    = bd?.subtotal ?? ((bd?.cat1_cost ?? 0) + (bd?.cat2_cost ?? 0) + (bd?.cat3_cost ?? 0));
  const totalCost   = row.estimated_total_cost;
  const location    = [row.postcode, postcodeMeta?.municipality].filter(Boolean).join(" ");

  return (
    <div className="public-report-root">
      <PublicReportHeader />

      <div className="public-report-body">
        {/* Generated date */}
        {generatedDate && (
          <p style={{ fontSize: "0.8rem", color: "#9C9088", marginBottom: "1.5rem" }}>
            Generated: {generatedDate}
          </p>
        )}

        {/* ── Hero cost card ── */}
        <div style={{
          background: "linear-gradient(135deg, #FAE8DC, #FFFFFF)",
          border: "1px solid #E8C4A8",
          borderRadius: "12px",
          padding: "2rem",
          marginBottom: "1.5rem",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "0.8rem", color: "#8B3C1A", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: "0.5rem" }}>
            Estimated Rebuild Cost
          </div>
          <div style={{ fontFamily: "var(--font-bricolage), Georgia, serif", fontSize: "3rem", fontWeight: 700, color: "#8B3C1A", lineHeight: 1, marginBottom: "1rem" }}>
            {fmtEur(totalCost)}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: "0.75rem", flexWrap: "wrap", fontSize: "0.875rem", color: "#524840" }}>
            {row.building_type && <span>{row.building_type.replace(/_/g, " ")}</span>}
            {location && <><span style={{ color: "#CCC" }}>·</span><span>{location}</span></>}
            {row.finishing_coefficient && <><span style={{ color: "#CCC" }}>·</span><span>{finishingLabel(row.finishing_coefficient)} finishing (F={Number(row.finishing_coefficient).toFixed(2)})</span></>}
          </div>
          {/* Metrics row */}
          <div style={{ display: "flex", justifyContent: "center", gap: "2rem", marginTop: "1.25rem", paddingTop: "1.25rem", borderTop: "1px solid #E8C4A8" }}>
            {[
              { label: "Total area", value: fmtSqm(row.total_gross_sqm ?? row.total_livable_sqm) },
              { label: "Livable area", value: fmtSqm(row.total_livable_sqm) },
              { label: "Confidence", value: (
                <span style={{ background: confidence.bg, color: confidence.color, padding: "2px 10px", borderRadius: "999px", fontWeight: 600, fontSize: "0.8rem" }}>
                  {confidence.label}
                </span>
              )},
            ].map(item => (
              <div key={item.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.75rem", color: "#9C9088", marginBottom: "0.2rem" }}>{item.label}</div>
                <div style={{ fontWeight: 600, color: "#1A1714" }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Cost breakdown ── */}
        {bd && (
          <section style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontFamily: "var(--font-bricolage), Georgia, serif", fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.875rem", color: "#1A1714" }}>
              Cost Breakdown
            </h2>
            <div style={{ border: "1px solid #E8E0D8", borderRadius: "10px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead>
                  <tr style={{ background: "#F2EDE8" }}>
                    <th style={{ padding: "8px 16px", textAlign: "left", color: "#9C9088", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Category</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", color: "#9C9088", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Area</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", color: "#9C9088", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Price/m²</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", color: "#9C9088", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Livable area (CAT1)", sqm: bd.cat1_sqm, price: bd.cat1_price_per_sqm, cost: bd.cat1_cost },
                    { label: "Enclosed non-livable (CAT2)", sqm: bd.cat2_sqm, price: bd.cat2_price_per_sqm, cost: bd.cat2_cost },
                    { label: "Outdoor built (CAT3)", sqm: bd.cat3_sqm, price: bd.cat3_price_per_sqm, cost: bd.cat3_cost },
                  ].map((row, i) => (
                    <tr key={row.label} style={{ borderTop: i === 0 ? "none" : "1px solid #F0EAE3" }}>
                      <td style={{ padding: "10px 16px", color: "#524840" }}>{row.label}</td>
                      <td style={{ padding: "10px 16px", textAlign: "right", color: "#9C9088", fontFamily: "monospace", fontSize: "0.875rem" }}>{fmtSqm(row.sqm)}</td>
                      <td style={{ padding: "10px 16px", textAlign: "right", color: "#9C9088", fontFamily: "monospace", fontSize: "0.875rem" }}>{fmtEur(row.price)}/m²</td>
                      <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 500, color: "#1A1714" }}>{fmtEur(row.cost)}</td>
                    </tr>
                  ))}
                  {/* Subtotal */}
                  <tr style={{ borderTop: "2px solid #E8E0D8", background: "#FAF7F4" }}>
                    <td colSpan={3} style={{ padding: "10px 16px", color: "#524840", fontWeight: 500 }}>Subtotal</td>
                    <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#1A1714" }}>{fmtEur(subtotal)}</td>
                  </tr>
                  {/* Adjustments */}
                  {bd.regional_factor != null && bd.regional_factor !== 1 && (
                    <tr style={{ borderTop: "1px solid #F0EAE3", background: "#FAF7F4" }}>
                      <td colSpan={3} style={{ padding: "8px 16px", color: "#9C9088", fontSize: "0.875rem" }}>
                        × Regional adjustment ({Number(bd.regional_factor).toFixed(3)})
                      </td>
                      <td style={{ padding: "8px 16px", textAlign: "right", color: "#9C9088", fontSize: "0.875rem" }}>
                        {fmtEur(subtotal * Number(bd.regional_factor))}
                      </td>
                    </tr>
                  )}
                  {bd.abex_factor != null && (
                    <tr style={{ borderTop: "1px solid #F0EAE3", background: "#FAF7F4" }}>
                      <td colSpan={3} style={{ padding: "8px 16px", color: "#9C9088", fontSize: "0.875rem" }}>
                        × ABEX index ({Number(bd.abex_factor).toFixed(3)})
                      </td>
                      <td style={{ padding: "8px 16px", textAlign: "right", color: "#9C9088", fontSize: "0.875rem" }}>—</td>
                    </tr>
                  )}
                  {/* Total */}
                  <tr style={{ borderTop: "2px solid #C85A2A", background: "#FFF8F5" }}>
                    <td colSpan={3} style={{ padding: "12px 16px", fontWeight: 700, color: "#1A1714", fontSize: "1rem" }}>Total</td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#C85A2A", fontSize: "1.1rem" }}>{fmtEur(totalCost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Room breakdown ── */}
        {allRooms.length > 0 && (
          <section style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontFamily: "var(--font-bricolage), Georgia, serif", fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.875rem", color: "#1A1714" }}>
              Room Breakdown
            </h2>
            <div style={{ border: "1px solid #E8E0D8", borderRadius: "10px", overflow: "hidden" }}>
              {floors.map((floor, fi) => {
                const rooms = floor.rooms ?? [];
                if (rooms.length === 0) return null;
                const floorLabel = floor.label_en ?? floor.label ?? `Floor ${fi}`;
                const floorTotal = rooms.reduce((s, r) => s + (r.area_sqm ?? 0), 0);
                return (
                  <div key={fi}>
                    {/* Floor header */}
                    <div style={{ background: "#F2EDE8", padding: "6px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: fi > 0 ? "1px solid #E8E0D8" : "none" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#524840", textTransform: "uppercase", letterSpacing: "0.05em" }}>{floorLabel}</span>
                      <span style={{ fontSize: "0.8rem", color: "#9C9088" }}>{floorTotal.toFixed(1)} m²</span>
                    </div>
                    {/* Rooms */}
                    {rooms.map((room, ri) => (
                      <div key={ri} style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "8px 16px",
                        borderTop: "1px solid #F5F0EB",
                        fontSize: "0.875rem",
                      }}>
                        <span style={{ color: "#524840" }}>{room.label_en ?? room.label ?? "Room"}</span>
                        <span style={{ color: "#1A1714", fontWeight: 500, fontFamily: "monospace" }}>{fmtSqm(room.area_sqm)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── PDF Download ── */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <a
            href={`/api/report/${row.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "10px 20px",
              border: "1px solid #C85A2A",
              borderRadius: "8px",
              color: "#C85A2A",
              fontSize: "0.875rem",
              fontWeight: 500,
              textDecoration: "none",
              transition: "background 0.15s",
            }}
          >
            ↓ Download PDF
          </a>
        </div>

        {/* ── Disclaimer ── */}
        <div style={{ background: "#F2EDE8", borderRadius: "8px", padding: "1rem 1.25rem", fontSize: "0.8125rem", color: "#524840", lineHeight: 1.6 }}>
          <strong style={{ color: "#1A1714" }}>About this estimate:</strong> This is an AI-generated reconstruction cost estimate based solely on the uploaded building plan.
          Costs are expressed in Belgian construction prices (ABEX-indexed) and reflect the full rebuild cost, not market value or land value.
          For official insurance valuations, consult a certified expert.
        </div>
      </div>

      <PublicReportFooter />
    </div>
  );
}

// ── Header & Footer ───────────────────────────────────────────────────────────

function PublicReportHeader() {
  return (
    <header className="public-report-header">
      <div className="prh-inner">
        <div className="prh-brand">
          <Link href="/">
            Plan Based<span className="prh-dot" />
          </Link>
        </div>
        <div className="prh-tag">Reconstruction Estimate</div>
      </div>
    </header>
  );
}

function PublicReportFooter() {
  return (
    <footer className="public-report-footer">
      <div className="prf-cta">
        <h3>Integrate Plan Based into your workflow</h3>
        <p>For insurance teams handling reconstruction claims at scale.</p>
        <a href="mailto:hello@planbased.xyz?subject=Plan%20Based%20enterprise" className="prf-btn">
          Contact us →
        </a>
      </div>
      <div className="prf-meta">
        Plan Based · AI-powered reconstruction cost estimation for Belgian insurance.
      </div>
    </footer>
  );
}
