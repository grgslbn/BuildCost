"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type Room = { name: string; area: number; category: "cat1" | "cat2" | "cat3" };

type LiveData = {
  status: string;
  total_livable_sqm?: number | null;
  total_gross_sqm?: number | null;
  finishing_level?: string | null;
  finishing_coefficient?: number | null;
  base_price_per_sqm?: number | null;
  abex_factor?: number | null;
  estimated_total_cost?: number | null;
  sqm_extraction?: Record<string, unknown> | null;
  extracted_qqps?: Record<string, { value: unknown }> | null;
  sub_areas?: {
    cat1_sqm?: number; cat1_price_per_sqm?: number; cat1_cost?: number;
    cat2_sqm?: number; cat2_price_per_sqm?: number; cat2_cost?: number;
    cat3_sqm?: number; cat3_price_per_sqm?: number; cat3_cost?: number;
    regional_factor?: number; abex_factor?: number;
    total_cost?: number; finishing_label?: string;
  } | null;
  building_type?: string | null;
  postcode?: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtEur(v: number): string {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
}

function classifyRoom(label: string): "cat1" | "cat2" | "cat3" {
  const l = label.toLowerCase();
  if (/(terrace|terras|terrasse|balcony|balkon)/.test(l)) return "cat3";
  if (/(garage|cellar|cave|kelder|berging|storage|utility|technique|stockage)/.test(l)) return "cat2";
  return "cat1";
}

type LiveFloor = { rooms?: Array<{ label?: string; type?: string; area_m2?: number; area_sqm?: number; sqm?: number }> };

function extractRoomsFromLive(live: LiveData | null): Room[] {
  if (!live?.sqm_extraction) return [];
  const floors = (live.sqm_extraction as { floors?: LiveFloor[] }).floors ?? [];
  const rooms: Room[] = [];
  for (const f of floors) {
    for (const r of f.rooms ?? []) {
      const area = r.area_m2 ?? r.area_sqm ?? r.sqm ?? 0;
      const name = r.label || r.type || "Room";
      if (area > 0) rooms.push({ name, area: Number(area), category: classifyRoom(name) });
    }
  }
  return rooms;
}

const PLACEHOLDER_ROOMS: Room[] = [
  { name: "Living room", area: 42, category: "cat1" },
  { name: "Kitchen", area: 18, category: "cat1" },
  { name: "Bedroom 1", area: 16, category: "cat1" },
  { name: "Bedroom 2", area: 12, category: "cat1" },
  { name: "Bathroom", area: 9, category: "cat1" },
  { name: "Entry hall", area: 6, category: "cat1" },
  { name: "Garage", area: 22, category: "cat2" },
  { name: "Storage", area: 8, category: "cat2" },
  { name: "Terrace", area: 15, category: "cat3" },
];

const QUALITY_CHECKS = [
  { label: "Open kitchen layout", positive: true },
  { label: "Multiple bathrooms", positive: true },
  { label: "Dressing room", positive: true },
  { label: "Wellness / pool area", positive: false },
  { label: "Generous bedroom sizes", positive: true },
];

const FINISHING_LEVELS = ["Basic", "Standard", "Comfort", "Comfort+", "Luxury"];

// ── Sub-components ───────────────────────────────────────────────────────────

function Counter({ value, duration = 1200, prefix = "", suffix = "", decimals = 0 }: {
  value: number; duration?: number; prefix?: string; suffix?: string; decimals?: number;
}) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    let raf = 0;
    const tick = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(fromRef.current + (value - fromRef.current) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const formatted = decimals > 0
    ? display.toFixed(decimals)
    : Math.round(display).toLocaleString("fr-BE");

  return <span>{prefix}{formatted}{suffix}</span>;
}

// ── Main component ───────────────────────────────────────────────────────────

const ACT_DURATIONS = [20000, 30000, 25000, 15000];
const TOTAL = ACT_DURATIONS.reduce((a, b) => a + b, 0);

export default function ProcessShow({
  liveData,
  fileName,
  onAnimationComplete,
}: {
  liveData: LiveData | null;
  fileName: string;
  onAnimationComplete: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(performance.now());
  const speedRef = useRef(1);
  const finishingTriggeredRef = useRef(false);

  // Minimum show duration: even if results arrive instantly, the user sees
  // at least 40 seconds of animation so they understand what happened.
  const MIN_DURATION_MS = 40_000;

  // Sync speed: if real data is ready and we've passed the minimum show duration,
  // speed up remaining time. Otherwise keep playing at normal speed.
  useEffect(() => {
    if (liveData?.status !== "complete" || finishingTriggeredRef.current) return;
    const sinceStart = performance.now() - startRef.current;
    const trigger = () => {
      if (finishingTriggeredRef.current) return;
      finishingTriggeredRef.current = true;
      speedRef.current = 4;
    };
    if (sinceStart >= MIN_DURATION_MS) {
      trigger();
    } else {
      const delay = MIN_DURATION_MS - sinceStart;
      const id = setTimeout(trigger, delay);
      return () => clearTimeout(id);
    }
  }, [liveData?.status]);

  // Drive elapsed
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = (t - last) * speedRef.current;
      last = t;
      setElapsed((e) => {
        const next = Math.min(TOTAL, e + dt);
        if (next >= TOTAL && e < TOTAL) {
          setTimeout(onAnimationComplete, 50);
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine current act (0-3) and act progress (0-1)
  let cumulative = 0;
  let actIdx = 0;
  let actProgress = 0;
  for (let i = 0; i < ACT_DURATIONS.length; i++) {
    const next = cumulative + ACT_DURATIONS[i];
    if (elapsed < next) {
      actIdx = i;
      actProgress = (elapsed - cumulative) / ACT_DURATIONS[i];
      break;
    }
    cumulative = next;
    actIdx = i;
    actProgress = 1;
  }
  if (elapsed >= TOTAL) { actIdx = 3; actProgress = 1; }

  const overallPct = Math.round((elapsed / TOTAL) * 100);
  const realRooms = useMemo(() => extractRoomsFromLive(liveData), [liveData]);
  const rooms = realRooms.length > 0 ? realRooms : PLACEHOLDER_ROOMS;

  return (
    <div className="ps-root">
      <div className="ps-header">
        <div className="ps-file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span>{fileName}</span>
        </div>
        <div className="ps-progress-wrap">
          <div className="ps-progress">
            <div className="ps-progress-fill" style={{ width: overallPct + "%" }} />
          </div>
          <span className="ps-progress-num">{overallPct}%</span>
        </div>
      </div>

      <div className="ps-acts">
        <div className={`ps-act ${actIdx === 0 ? "active" : actIdx > 0 ? "done" : ""}`}>1 · Reading plan</div>
        <div className={`ps-act ${actIdx === 1 ? "active" : actIdx > 1 ? "done" : ""}`}>2 · Discovering rooms</div>
        <div className={`ps-act ${actIdx === 2 ? "active" : actIdx > 2 ? "done" : ""}`}>3 · Assessing quality</div>
        <div className={`ps-act ${actIdx === 3 ? "active" : ""}`}>4 · Calculating cost</div>
      </div>

      <div className="ps-stage">
        {actIdx === 0 && <Act1 progress={actProgress} fileName={fileName}/>}
        {actIdx === 1 && <Act2 progress={actProgress} rooms={rooms}/>}
        {actIdx === 2 && <Act3 progress={actProgress} liveLevel={liveData?.finishing_level ?? liveData?.sub_areas?.finishing_label ?? null}/>}
        {actIdx === 3 && <Act4 progress={actProgress} liveData={liveData}/>}
      </div>

      {elapsed >= TOTAL && liveData?.status !== "complete" && liveData?.status !== "error" && (
        <div className="ps-finalizing">
          <div className="ps-spinner" />
          <span>Finalizing your report…</span>
        </div>
      )}
    </div>
  );
}

// ── Act 1: Reading plan ──────────────────────────────────────────────────────

function Act1({ progress, fileName }: { progress: number; fileName: string }) {
  const pageCount = Math.max(2, Math.min(8, Math.round(progress * 8) + 1));
  const showCategories = progress > 0.5;

  return (
    <div className="ps-act1">
      <div className="ps-pages-stack">
        {Array.from({ length: pageCount }).map((_, i) => (
          <div key={i} className="ps-page" style={{
            left: `${(i - pageCount / 2) * 14}px`,
            top: `${i * 4}px`,
            transform: `rotate(${(i - pageCount / 2) * 3}deg)`,
            animationDelay: `${i * 80}ms`,
          }}>
            <div className="ps-page-lines">
              <i style={{ width: "60%" }}/>
              <i style={{ width: "85%" }}/>
              <i style={{ width: "40%" }}/>
              <i style={{ width: "70%" }}/>
            </div>
          </div>
        ))}
        <div className="ps-scan-line" style={{ animationDuration: "2.5s" }}/>
      </div>

      <div className="ps-act1-text">
        <div className="ps-act1-title">Reading <em>{fileName}</em></div>
        <div className="ps-act1-meta">Found <strong>{pageCount}</strong> pages</div>
        {showCategories && (
          <div className="ps-act1-tags">
            <span className="ps-tag" style={{ animationDelay: "0ms" }}>Floor plan</span>
            <span className="ps-tag" style={{ animationDelay: "180ms" }}>Elevation</span>
            <span className="ps-tag" style={{ animationDelay: "360ms" }}>Site plan</span>
          </div>
        )}
        <div className="ps-fun-fact">
          Did you know? Our AI reads plans in Dutch, French, and German — just like a Belgian expert.
        </div>
      </div>
    </div>
  );
}

// ── Act 2: Discovering rooms ─────────────────────────────────────────────────

function Act2({ progress, rooms }: { progress: number; rooms: Room[] }) {
  const visibleCount = Math.min(rooms.length, Math.ceil(progress * (rooms.length + 1)));
  const visible = rooms.slice(0, visibleCount);
  const totalArea = visible.reduce((s, r) => s + r.area, 0);

  return (
    <div className="ps-act2">
      <div className="ps-act2-header">
        <div className="ps-act2-counter">
          <span className="ps-act2-label">Total area</span>
          <span className="ps-act2-value">
            <Counter value={totalArea} duration={600}/> m²
          </span>
        </div>
        <div className="ps-cat-legend">
          <span><i className="ps-dot cat1"/> Livable</span>
          <span><i className="ps-dot cat2"/> Garage / Storage</span>
          <span><i className="ps-dot cat3"/> Outdoor</span>
        </div>
      </div>

      <div className="ps-room-grid">
        {visible.map((r, i) => (
          <div
            key={`${r.name}-${i}`}
            className={`ps-room ${r.category}`}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <span className="ps-room-name">{r.name}</span>
            <span className="ps-room-area">{r.area.toFixed(1)} m²</span>
          </div>
        ))}
      </div>

      <div className="ps-fun-fact">
        A garage costs about half per m² to rebuild compared to a living room.
      </div>
    </div>
  );
}

// ── Act 3: Assessing finishing quality ───────────────────────────────────────

function Act3({ progress, liveLevel }: { progress: number; liveLevel: string | null }) {
  const visibleCount = Math.min(QUALITY_CHECKS.length, Math.ceil(progress * (QUALITY_CHECKS.length + 1)));
  const meterTarget = liveLevel
    ? Math.max(0, FINISHING_LEVELS.findIndex((l) => l.toLowerCase() === liveLevel.toLowerCase()))
    : 3;
  const settledLevel = progress > 0.7;
  const meterPos = settledLevel ? meterTarget : Math.min(4, progress * 6);

  return (
    <div className="ps-act3">
      <div className="ps-checks">
        {QUALITY_CHECKS.slice(0, visibleCount).map((c, i) => (
          <div key={i} className={`ps-check ${c.positive ? "yes" : "no"}`} style={{ animationDelay: `${i * 120}ms` }}>
            <span className="ps-check-icon">{c.positive ? "✓" : "✗"}</span>
            <span>{c.label}</span>
          </div>
        ))}
      </div>

      <div className="ps-meter">
        <div className="ps-meter-label">Finishing level</div>
        <div className="ps-meter-track">
          {FINISHING_LEVELS.map((lvl, i) => (
            <div key={lvl} className={`ps-meter-seg ${i <= meterPos ? "lit" : ""}`}>
              <span>{lvl}</span>
            </div>
          ))}
          <div
            className="ps-meter-needle"
            style={{
              left: `${(meterPos / (FINISHING_LEVELS.length - 1)) * 100}%`,
              transition: settledLevel ? "left 800ms cubic-bezier(.34,1.56,.64,1)" : "left 200ms",
            }}
          />
        </div>
        {settledLevel && (
          <div className="ps-meter-detected">
            Detected: <strong>{FINISHING_LEVELS[meterTarget] ?? liveLevel ?? "Standard"}</strong>
          </div>
        )}
      </div>

      <div className="ps-fun-fact">
        Finishing level can account for up to 2× difference between a basic and luxury build.
      </div>
    </div>
  );
}

// ── Act 4: Calculating cost ──────────────────────────────────────────────────

function Act4({ progress, liveData }: { progress: number; liveData: LiveData | null }) {
  const sub = liveData?.sub_areas;
  const cat1 = sub?.cat1_cost ?? 285_000;
  const cat2 = sub?.cat2_cost ?? 24_000;
  const cat3 = sub?.cat3_cost ?? 8_500;
  const cat1Sqm = sub?.cat1_sqm ?? 180;
  const cat2Sqm = sub?.cat2_sqm ?? 30;
  const cat3Sqm = sub?.cat3_sqm ?? 15;
  const cat1Price = sub?.cat1_price_per_sqm ?? 1500;
  const cat2Price = sub?.cat2_price_per_sqm ?? 800;
  const cat3Price = sub?.cat3_price_per_sqm ?? 500;
  const regional = sub?.regional_factor ?? 0.96;
  const abex = sub?.abex_factor ?? liveData?.abex_factor ?? 1.056;
  const total = liveData?.estimated_total_cost ?? sub?.total_cost ?? (cat1 + cat2 + cat3) * regional * abex;

  const showCat1 = progress > 0.10;
  const showCat2 = progress > 0.30;
  const showCat3 = progress > 0.45;
  const showAdj = progress > 0.60;
  const showTotal = progress > 0.78;

  return (
    <div className="ps-act4">
      <div className="ps-cost-cards">
        <div className={`ps-cost-card ${showCat1 ? "in" : ""}`}>
          <div className="ps-cost-cat">Livable</div>
          {showCat1 && (
            <>
              <div className="ps-cost-formula">
                <Counter value={cat1Sqm} duration={500} decimals={1} suffix=" m²"/>
                <span>×</span>
                <Counter value={cat1Price} duration={500} prefix="€" suffix="/m²"/>
              </div>
              <div className="ps-cost-num"><Counter value={cat1} duration={900} prefix="€"/></div>
            </>
          )}
        </div>
        <div className={`ps-cost-card ${showCat2 ? "in" : ""}`}>
          <div className="ps-cost-cat">Garage / Storage</div>
          {showCat2 && (
            <>
              <div className="ps-cost-formula">
                <Counter value={cat2Sqm} duration={500} decimals={1} suffix=" m²"/>
                <span>×</span>
                <Counter value={cat2Price} duration={500} prefix="€" suffix="/m²"/>
              </div>
              <div className="ps-cost-num"><Counter value={cat2} duration={900} prefix="€"/></div>
            </>
          )}
        </div>
        <div className={`ps-cost-card ${showCat3 ? "in" : ""}`}>
          <div className="ps-cost-cat">Outdoor</div>
          {showCat3 && (
            <>
              <div className="ps-cost-formula">
                <Counter value={cat3Sqm} duration={500} decimals={1} suffix=" m²"/>
                <span>×</span>
                <Counter value={cat3Price} duration={500} prefix="€" suffix="/m²"/>
              </div>
              <div className="ps-cost-num"><Counter value={cat3} duration={900} prefix="€"/></div>
            </>
          )}
        </div>
      </div>

      {showAdj && (
        <div className="ps-adj">
          <span>× {regional.toFixed(3)} <em>(regional)</em></span>
          <span>× {abex.toFixed(3)} <em>(ABEX 2026)</em></span>
        </div>
      )}

      {showTotal && (
        <div className="ps-total">
          <div className="ps-total-label">Reconstruction cost</div>
          <div className="ps-total-num"><Counter value={total} duration={1400} prefix="€"/></div>
          {progress > 0.95 && <div className="ps-confetti"/>}
        </div>
      )}

      {!showTotal && <div className="ps-fun-fact">Applying regional and ABEX adjustments…</div>}
    </div>
  );
}
