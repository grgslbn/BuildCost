"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createEstimation } from "@/app/actions/create-estimation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { lookupPostcode, type PostcodeLookupResult } from "@/app/actions/lookup-postcode";
import { ResultsView, type EstimationResult } from "@/components/estimate/results-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Loader2,
  FileText,
  CheckCircle2,
  Circle,
  Upload,
  MapPin,
  AlertCircle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Phase = "upload" | "processing" | "results" | "error";
type StepStatus = "pending" | "active" | "complete";

const STEPS = [
  { key: "uploading",       label: "Uploading plan..." },
  { key: "extracting_sqm", label: "Extracting rooms & areas..." },
  { key: "analyzing_qqp",  label: "Analyzing finishing level..." },
  { key: "calculating",    label: "Calculating rebuild cost..." },
];

const STATUS_ORDER = ["uploading", "extracting_sqm", "analyzing_qqp", "calculating", "complete"];
const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const ACCEPTED_EXT = ".pdf,.png,.jpg,.jpeg";

// ── Helpers ────────────────────────────────────────────────────────────────────

function stepStatus(stepKey: string, currentStatus: string): StepStatus {
  const stepIdx = STATUS_ORDER.indexOf(stepKey);
  const curIdx = STATUS_ORDER.indexOf(currentStatus);
  if (curIdx < 0) return "pending";
  if (curIdx > stepIdx) return "complete";
  if (curIdx === stepIdx) return "active";
  return "pending";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepRow({ label, status }: { label: string; status: StepStatus }) {
  return (
    <div className={cn("flex items-center gap-3 transition-opacity", status === "pending" && "opacity-40")}>
      {status === "complete" ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
      ) : status === "active" ? (
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
      ) : (
        <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <span className={cn("text-sm", status === "active" ? "font-medium text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function EstimatePage() {
  // Upload phase
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [postcode, setPostcode] = useState("");
  const [postcodeMeta, setPostcodeMeta] = useState<PostcodeLookupResult | null>(null);
  const [postcodeLoading, setPostcodeLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Processing
  const [phase, setPhase] = useState<Phase>("upload");
  const [estimationId, setEstimationId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState("uploading");
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Results
  const [result, setResult] = useState<EstimationResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Postcode debounce ────────────────────────────────────────────────────────

  useEffect(() => {
    if (postcode.trim().length < 4) {
      setPostcodeMeta(null);
      return;
    }
    setPostcodeLoading(true);
    const t = setTimeout(async () => {
      const res = await lookupPostcode(postcode.trim());
      setPostcodeMeta(res);
      setPostcodeLoading(false);
    }, 500);
    return () => {
      clearTimeout(t);
      setPostcodeLoading(false);
    };
  }, [postcode]);

  // ── Status polling ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== "processing" || !estimationId) return;

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/estimate-status/${estimationId}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          console.warn("[estimate] poll non-200:", res.status);
          return;
        }
        const data = (await res.json()) as EstimationResult & { error_message?: string; updated_at?: string };
        console.log("[estimate] poll →", {
          id:         data.id,
          status:     data.status,
          sub_areas:  !!data.sub_areas,
          updated_at: data.updated_at,
        });

        // Only advance the status — never regress (e.g. DB "uploading" must not
        // override a client-set "extracting_sqm" before the server catches up).
        setProcessingStatus((prev) => {
          const prevIdx = STATUS_ORDER.indexOf(prev);
          const newIdx  = STATUS_ORDER.indexOf(data.status);
          return newIdx > prevIdx ? data.status : prev;
        });

        if (data.status === "complete") {
          console.log("[estimate] transitioning to results, breakdown:", data.sub_areas);
          clearInterval(poll);
          setResult(data);
          setPhase("results");
        } else if (data.status === "error") {
          clearInterval(poll);
          setProcessingError(data.error_message ?? "Processing failed. Please try again.");
          setPhase("error");
        }
      } catch (pollErr) {
        console.error("[estimate] poll error:", pollErr);
      }
    }, 2000);

    return () => clearInterval(poll);
  }, [phase, estimationId]);

  // ── File picking ─────────────────────────────────────────────────────────────

  const pickFile = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const f = list[0];
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setFileError("Invalid file type — please upload a PDF, PNG, or JPG.");
      return;
    }
    setFile(f);
    setFileError(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      pickFile(e.dataTransfer.files);
    },
    [pickFile]
  );

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!file || !postcode.trim()) return;
    setPhase("processing");
    setProcessingStatus("uploading");
    setProcessingError(null);

    try {
      // Step 1: get a signed upload URL (no file bytes through Vercel)
      console.log("[estimate] step 1 — requesting signed URL for", file.name);
      const urlRes = await fetch("/api/upload-signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name }),
      });
      const urlData = (await urlRes.json()) as {
        status: string; id?: string; path?: string; token?: string; error?: string;
      };
      console.log("[estimate] step 1 result:", urlRes.status, urlData);
      if (!urlRes.ok || !urlData.path || !urlData.token || !urlData.id) {
        throw new Error(urlData.error ?? "Failed to prepare upload.");
      }

      // Step 2: upload file directly from browser → Supabase Storage
      console.log("[estimate] step 2 — uploading to storage path:", urlData.path);
      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("plans")
        .uploadToSignedUrl(urlData.path, urlData.token, file);
      if (uploadError) {
        console.error("[estimate] step 2 upload error:", uploadError);
        throw new Error(uploadError.message);
      }
      console.log("[estimate] step 2 — file in storage ✓");

      // Step 3: create estimation row in DB with plan_storage_path
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
      console.log("[estimate] step 3 — creating estimation row, storagePath:", urlData.path);
      const createResult = await createEstimation({
        storagePath: urlData.path,
        fileName: file.name,
        fileType: ext === "pdf" ? "pdf" : "image",
        postcode: postcode.trim(),
      });
      console.log("[estimate] step 3 result:", createResult);
      if (createResult.status === "error") {
        throw new Error(createResult.message);
      }

      const id = createResult.estimationId;
      console.log("[estimate] step 4 — estimation row created, id:", id);
      setEstimationId(id);
      setProcessingStatus("extracting_sqm");

      // Step 4: POST /api/estimate — awaited so errors surface here, not silently
      console.log("[estimate] step 4 — POSTing /api/estimate with estimationId:", id, "storagePath:", urlData.path);
      const estimateRes = await fetch("/api/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimationId: id }),
      });
      console.log("[estimate] step 4 — /api/estimate responded:", estimateRes.status);
      if (!estimateRes.ok) {
        const errBody = await estimateRes.json().catch(() => null);
        console.error("[estimate] step 4 — /api/estimate error body:", errBody);
        // Don't throw: server may have already written an error status to DB
        // and polling will surface it. Only throw on network-level failure.
      }
    } catch (err) {
      console.error("[estimate] handleSubmit error:", err);
      setProcessingError(
        err instanceof Error ? err.message : "Unexpected error. Please try again."
      );
      setPhase("error");
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────────

  function handleReset() {
    setFile(null);
    setPostcode("");
    setPostcodeMeta(null);
    setPostcodeLoading(false);
    setFileError(null);
    setPhase("upload");
    setEstimationId(null);
    setProcessingStatus("uploading");
    setProcessingError(null);
    setResult(null);
  }

  // ── Render: results ───────────────────────────────────────────────────────────

  if (phase === "results" && result) {
    const rMeta =
      postcodeMeta?.found
        ? {
            municipality: postcodeMeta.municipality,
            region: postcodeMeta.region,
            nationalBase: postcodeMeta.nationalBase,
          }
        : postcodeMeta
        ? { nationalBase: postcodeMeta.nationalBase }
        : undefined;

    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <ResultsView result={result} postcodeMeta={rMeta} onReset={handleReset} />
      </div>
    );
  }

  // ── Render: processing ────────────────────────────────────────────────────────

  if (phase === "processing") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-xl border bg-card p-8 shadow-sm space-y-8">
          <div className="text-center space-y-1">
            <h2 className="text-xl font-semibold">Analyzing building plan</h2>
            <p className="text-sm text-muted-foreground">
              This typically takes 30–90 seconds. Do not close this tab.
            </p>
          </div>
          <div className="space-y-4">
            {STEPS.map((step) => (
              <StepRow
                key={step.key}
                label={step.label}
                status={stepStatus(step.key, processingStatus)}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Render: error ─────────────────────────────────────────────────────────────

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-xl border bg-card p-8 shadow-sm space-y-6 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Estimation failed</h2>
            <p className="text-sm text-muted-foreground">{processingError}</p>
          </div>
          <Button onClick={handleReset} variant="outline">Try again</Button>
        </div>
      </div>
    );
  }

  // ── Render: upload ─────────────────────────────────────────────────────────────

  const canSubmit = !!file && postcode.trim().length >= 4;

  return (
    <div className="mx-auto max-w-xl px-4 py-8 space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">New estimation</h1>
        <p className="text-sm text-muted-foreground">
          Upload a building plan and enter the postcode to get an instant rebuild cost estimate.
        </p>
      </div>

      {/* File drop zone */}
      <div className="space-y-2">
        <Label>
          Building plan <span className="text-destructive">*</span>
        </Label>
        <div
          className={cn(
            "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 cursor-pointer transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : file
              ? "border-primary/40 bg-muted/20"
              : "border-border hover:border-primary/50 hover:bg-muted/30"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {file ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <FileText className="h-8 w-8 text-primary" />
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(1)} MB · click to change
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drag & drop or{" "}
                <span className="font-medium text-foreground">click to browse</span>
              </p>
              <p className="text-xs text-muted-foreground">PDF, PNG, JPG · max 50 MB</p>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXT}
          className="hidden"
          onChange={(e) => pickFile(e.target.files)}
        />
        {fileError && <p className="text-xs text-destructive">{fileError}</p>}
      </div>

      {/* Postcode */}
      <div className="space-y-2">
        <Label htmlFor="postcode">
          Postcode <span className="text-destructive">*</span>
        </Label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="postcode"
            placeholder="e.g. 2000"
            maxLength={8}
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            className="pl-9"
          />
          {postcodeLoading && (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {postcodeMeta?.found && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
            <span>
              {postcodeMeta.municipality}
              {postcodeMeta.region ? ` · ${postcodeMeta.region}` : ""}
              {" · "}
              <span className="font-medium text-foreground">
                €{postcodeMeta.basePrice.toLocaleString("fr-BE")}/m²
              </span>
              {" "}base
            </span>
          </div>
        )}

        {postcodeMeta && !postcodeMeta.found && postcode.trim().length >= 4 && !postcodeLoading && (
          <p className="text-xs text-muted-foreground">
            Postcode not found — national average will be used.
          </p>
        )}
      </div>

      <Button
        size="lg"
        className="w-full"
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        Calculate rebuild cost
      </Button>
    </div>
  );
}
