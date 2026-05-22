"use client";

import { useEffect, useState } from "react";

type SubAreas = {
  cat1_sqm: number; cat1_price_per_sqm: number; cat1_cost: number;
  cat2_sqm: number; cat2_price_per_sqm: number; cat2_cost: number;
  cat3_sqm: number; cat3_price_per_sqm: number; cat3_cost: number;
  regional_factor: number; abex_factor: number;
  total_cost: number; finishing_label: string;
};

type ResultsData = {
  estimated_total_cost: number | null;
  finishing_level: string | null;
  finishing_coefficient: number | null;
  total_livable_sqm: number | null;
  total_gross_sqm: number | null;
  building_type: string | null;
  postcode: string | null;
  sub_areas: SubAreas | null;
  extracted_qqps: Record<string, { value: unknown }> | null;
};

const LEVELS = ["Basic", "Standard", "Comfort", "Comfort+", "Luxury"];

function fmtEur(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

function levelIndex(label?: string | null): number {
  if (!label) return 1;
  const i = LEVELS.findIndex((l) => l.toLowerCase() === label.toLowerCase());
  return i >= 0 ? i : 1;
}

export default function TeaserResults({ data, unlocked }: { data: ResultsData; unlocked: boolean }) {
  const [meter, setMeter] = useState(0);
  const targetIdx = levelIndex(data.finishing_level);

  useEffect(() => {
    const id = setTimeout(() => setMeter(targetIdx), 200);
    return () => clearTimeout(id);
  }, [targetIdx]);

  const total = data.estimated_total_cost ?? 0;
  const livable = data.total_livable_sqm ?? 0;
  const gross = data.total_gross_sqm ?? livable;
  const sub = data.sub_areas;
  const qqps = data.extracted_qqps ?? {};
  const qqpCount = Object.keys(qqps).length;

  return (
    <div className="tr-root">
      <div className="tr-hero">
        <div className="tr-hero-label">Estimated rebuild cost</div>
        <div className="tr-hero-num">{fmtEur(total)}</div>
        <div className="tr-hero-meta">
          <span>{(data.finishing_level ?? "Standard")} finishing</span>
          <span className="tr-dot">·</span>
          <span>{gross.toFixed(0)} m² total</span>
          {data.building_type && (
            <>
              <span className="tr-dot">·</span>
              <span className="tr-badge">{data.building_type.replace(/_/g, " ")}</span>
            </>
          )}
        </div>

        <div className="tr-meter">
          {LEVELS.map((l, i) => (
            <div key={l} className={`tr-meter-seg ${i <= meter ? "lit" : ""} ${i === targetIdx ? "active" : ""}`}>
              <span>{l}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="tr-grid">
        <div className={`tr-card ${unlocked ? "" : "tr-locked"}`}>
          <div className="tr-card-head">
            <h4>Detailed cost breakdown</h4>
            {!unlocked && <span className="tr-lock">🔒</span>}
          </div>
          <div className="tr-rows">
            <div className="tr-row">
              <span>Livable area</span>
              <span>{sub?.cat1_sqm.toFixed(1) ?? "—"} m² × {fmtEur(sub?.cat1_price_per_sqm)}</span>
              <span className="tr-row-val">{fmtEur(sub?.cat1_cost)}</span>
            </div>
            <div className="tr-row">
              <span>Garage / Storage</span>
              <span>{sub?.cat2_sqm.toFixed(1) ?? "—"} m² × {fmtEur(sub?.cat2_price_per_sqm)}</span>
              <span className="tr-row-val">{fmtEur(sub?.cat2_cost)}</span>
            </div>
            <div className="tr-row">
              <span>Outdoor built</span>
              <span>{sub?.cat3_sqm.toFixed(1) ?? "—"} m² × {fmtEur(sub?.cat3_price_per_sqm)}</span>
              <span className="tr-row-val">{fmtEur(sub?.cat3_cost)}</span>
            </div>
            <div className="tr-row tr-row-adj">
              <span>Regional factor</span>
              <span/>
              <span className="tr-row-val">× {sub?.regional_factor?.toFixed(3) ?? "—"}</span>
            </div>
            <div className="tr-row tr-row-adj">
              <span>ABEX factor</span>
              <span/>
              <span className="tr-row-val">× {sub?.abex_factor?.toFixed(3) ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className={`tr-card ${unlocked ? "" : "tr-locked"}`}>
          <div className="tr-card-head">
            <h4>Quality parameters ({qqpCount} indicators)</h4>
            {!unlocked && <span className="tr-lock">🔒</span>}
          </div>
          <div className="tr-qqp-grid">
            {Object.entries(qqps).slice(0, 12).map(([key, v]) => (
              <div key={key} className="tr-qqp">
                <span className="tr-qqp-key">{key.replace(/_/g, " ")}</span>
                <span className="tr-qqp-val">{String(v?.value ?? "—")}</span>
              </div>
            ))}
            {qqpCount === 0 && <div className="tr-qqp-empty">Awaiting parameters…</div>}
          </div>
        </div>
      </div>

      {!unlocked && (
        <div className="tr-overlay">
          <div className="tr-overlay-icon">🔒</div>
          <div className="tr-overlay-text">Unlock the full report below</div>
        </div>
      )}
    </div>
  );
}
