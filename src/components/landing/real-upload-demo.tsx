"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { lookupPostcode, type PostcodeLookupResult } from "@/app/actions/lookup-postcode";
import ProcessShow from "./process-show";
import TeaserResults from "./teaser-results";
import LeadCapture from "./lead-capture";

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "processing" | "results" | "error";

type LiveData = {
  id?: string;
  status: string;
  error_message?: string | null;
  estimated_total_cost?: number | null;
  finishing_level?: string | null;
  finishing_coefficient?: number | null;
  total_livable_sqm?: number | null;
  total_gross_sqm?: number | null;
  building_type?: string | null;
  postcode?: string | null;
  base_price_per_sqm?: number | null;
  abex_factor?: number | null;
  sqm_extraction?: Record<string, unknown> | null;
  extracted_qqps?: Record<string, { value: unknown }> | null;
  sub_areas?: {
    cat1_sqm: number; cat1_price_per_sqm: number; cat1_cost: number;
    cat2_sqm: number; cat2_price_per_sqm: number; cat2_cost: number;
    cat3_sqm: number; cat3_price_per_sqm: number; cat3_cost: number;
    regional_factor: number; abex_factor: number;
    total_cost: number; finishing_label: string;
  } | null;
  updated_at?: string;
};

const ACCEPTED = ".pdf,.png,.jpg,.jpeg";
const PENDING_KEY = "buildcost.publicEstimationId";

// ── Main ─────────────────────────────────────────────────────────────────────

export default function RealUploadDemo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [postcode, setPostcode] = useState("");
  const [postcodeMeta, setPostcodeMeta] = useState<PostcodeLookupResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [estimationId, setEstimationId] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<LiveData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [animationDone, setAnimationDone] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Postcode lookup
  useEffect(() => {
    if (postcode.trim().length < 4) { setPostcodeMeta(null); return; }
    const t = setTimeout(async () => {
      try {
        const res = await lookupPostcode(postcode.trim());
        setPostcodeMeta(res);
      } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(t);
  }, [postcode]);

  // Resume from localStorage if processing was interrupted
  useEffect(() => {
    const pending = localStorage.getItem(PENDING_KEY);
    if (pending) {
      setEstimationId(pending);
      setPhase("processing");
    }
  }, []);

  // Polling
  useEffect(() => {
    if (phase !== "processing" || !estimationId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/public/estimate-status/${estimationId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as LiveData;
        if (cancelled) return;
        setLiveData(data);
        if (data.status === "complete") {
          localStorage.removeItem(PENDING_KEY);
        } else if (data.status === "error") {
          localStorage.removeItem(PENDING_KEY);
          setErrorMsg(data.error_message ?? "We couldn't fully analyze this plan. Try uploading detailed architectural floor plans with room dimensions.");
          setPhase("error");
        }
      } catch { /* ignore */ }
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [phase, estimationId]);

  // Switch to results once animation is done AND data is ready
  useEffect(() => {
    if (animationDone && liveData?.status === "complete") {
      setPhase("results");
    }
  }, [animationDone, liveData?.status]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function pickFile(list: FileList | null) {
    if (!list || list.length === 0) return;
    const f = list[0];
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "png", "jpg", "jpeg"].includes(ext)) {
      setFileError("Please upload a PDF, PNG, or JPG.");
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      setFileError("File too large (max 50 MB).");
      return;
    }
    setFile(f);
    setFileError(null);
  }

  async function handleAnalyze() {
    if (!file) { setFileError("Please choose a plan file first."); return; }
    if (postcode.trim().length < 4) { setFileError("Please enter a valid Belgian postcode."); return; }

    setPhase("processing");
    setLiveData(null);
    setAnimationDone(false);
    setUnlocked(false);
    setErrorMsg(null);

    try {
      const urlRes = await fetch("/api/public/upload-signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      const urlData = (await urlRes.json()) as { path?: string; token?: string; error?: string };
      if (!urlRes.ok || !urlData.path || !urlData.token) {
        throw new Error(urlData.error ?? "Failed to prepare upload.");
      }

      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase.storage
        .from("plans")
        .uploadToSignedUrl(urlData.path, urlData.token, file);
      if (upErr) throw new Error(upErr.message);

      const createRes = await fetch("/api/public/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: urlData.path,
          fileName: file.name,
          postcode: postcode.trim(),
        }),
      });
      const createData = (await createRes.json()) as { estimationId?: string; error?: string; message?: string };
      if (!createRes.ok || !createData.estimationId) {
        throw new Error(createData.message ?? createData.error ?? "Failed to create estimation.");
      }

      const id = createData.estimationId;
      setEstimationId(id);
      localStorage.setItem(PENDING_KEY, id);

      // Fire-and-forget the processing route — it runs server-side for up to 5 min.
      fetch("/api/estimate-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimationId: id }),
      }).catch(() => { /* polling will surface errors */ });

    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error.");
      setPhase("error");
      localStorage.removeItem(PENDING_KEY);
    }
  }

  function reset() {
    setPhase("idle");
    setFile(null);
    setPostcode("");
    setPostcodeMeta(null);
    setDragOver(false);
    setFileError(null);
    setEstimationId(null);
    setLiveData(null);
    setErrorMsg(null);
    setAnimationDone(false);
    setUnlocked(false);
    localStorage.removeItem(PENDING_KEY);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (phase === "processing") {
    return (
      <div className="real-upload-zone real-upload-processing">
        <ProcessShow
          liveData={liveData}
          fileName={file?.name ?? liveData?.postcode ?? "your-plan.pdf"}
          onAnimationComplete={() => setAnimationDone(true)}
        />
      </div>
    );
  }

  if (phase === "results" && liveData) {
    const teaserData = {
      estimated_total_cost: liveData.estimated_total_cost ?? null,
      finishing_level: liveData.finishing_level ?? null,
      finishing_coefficient: liveData.finishing_coefficient ?? null,
      total_livable_sqm: liveData.total_livable_sqm ?? null,
      total_gross_sqm: liveData.total_gross_sqm ?? null,
      building_type: liveData.building_type ?? null,
      postcode: liveData.postcode ?? null,
      sub_areas: liveData.sub_areas ?? null,
      extracted_qqps: liveData.extracted_qqps ?? null,
    };
    return (
      <div className="real-upload-zone real-upload-results">
        <TeaserResults data={teaserData} unlocked={unlocked}/>
        {!unlocked ? (
          <LeadCapture estimationId={estimationId} onUnlock={() => setUnlocked(true)}/>
        ) : (
          <div className="reset-row">
            <button className="btn btn-secondary" onClick={reset}>↺ Try another plan</button>
          </div>
        )}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="real-upload-zone real-upload-error">
        <div className="re-icon">⚠</div>
        <h3>We couldn't fully analyze this plan</h3>
        <p>{errorMsg ?? "This might happen with façade drawings or renovation plans — try uploading detailed architectural floor plans with room dimensions."}</p>
        <button className="btn btn-primary" onClick={reset}>↺ Try again</button>
      </div>
    );
  }

  return (
    <div
      className={`real-upload-zone real-upload-idle${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        style={{ display: "none" }}
        onChange={(e) => pickFile(e.target.files)}
      />

      <div className="rud-upload-area" onClick={() => !file && inputRef.current?.click()}>
        {!file ? (
          <>
            <div className="rud-upload-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <div className="rud-upload-title">Drop your PDF here or click to upload</div>
            <div className="rud-upload-sub">PDF, PNG, or JPG · up to 50 MB</div>
          </>
        ) : (
          <div className="rud-file">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <div className="rud-file-meta">
              <div className="rud-file-name">{file.name}</div>
              <div className="rud-file-size">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
            </div>
            <button className="rud-file-remove" onClick={(e) => { e.stopPropagation(); setFile(null); }}>×</button>
          </div>
        )}
      </div>

      <div className="rud-form">
        <label className="rud-field">
          <span>Postcode</span>
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="1000"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value.replace(/\D/g, ""))}
          />
          {postcodeMeta?.found && (
            <small className="rud-postcode-hint">
              {postcodeMeta.municipality}{postcodeMeta.region ? ` · ${postcodeMeta.region}` : ""}
            </small>
          )}
        </label>

        <button className="btn btn-primary btn-lg rud-cta" onClick={handleAnalyze}>
          Analyze my plan
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>

      {fileError && <div className="rud-error">{fileError}</div>}

      <div className="rud-trust">
        <span>· Free</span>
        <span>· No signup required</span>
        <span>· Belgian market · ABEX 2026 indexed</span>
      </div>
    </div>
  );
}
