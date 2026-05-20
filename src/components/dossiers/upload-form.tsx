"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { saveDossier } from "@/app/actions/save-dossier";
import type { PageClassification } from "@/lib/pdf/classify-pages";
import type { ExtractedDossierMetadata } from "@/lib/pdf/extract-metadata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Loader2, FileText, CheckCircle } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

type Phase =
  | "select"
  | "uploading"
  | "analyzing"
  | "review"
  | "saving"
  | "success";

type AnalysisResult = {
  totalPageCount: number;
  processedPageCount: number;
  classifications: PageClassification[];
  floorPlanPages: number[];
  extractedMetadata: ExtractedDossierMetadata;
};

type UploadedFile = {
  dossierId: string;
  storagePath: string;
  fileName: string;
  fileType: string;
};

type FormValues = {
  address: string;
  postcode: string;
  building_type: string;
  known_total_price: string;
  known_total_sqm: string;
  finishing_level: string;
  abex_year: string;
  abex_semester: string;
  expert_notes: string;
};

const EMPTY_FORM: FormValues = {
  address: "",
  postcode: "",
  building_type: "",
  known_total_price: "",
  known_total_sqm: "",
  finishing_level: "",
  abex_year: "",
  abex_semester: "",
  expert_notes: "",
};

// ── Constants ────────────────────────────────────────────────────────────────

const BUILDING_TYPES = [
  { value: "house", label: "House" },
  { value: "apartment", label: "Apartment" },
  { value: "villa", label: "Villa" },
  { value: "duplex", label: "Duplex" },
  { value: "studio", label: "Studio" },
  { value: "commercial", label: "Commercial" },
];

const FINISHING_LEVELS = [
  { value: "basic", label: "Basic" },
  { value: "standard", label: "Standard" },
  { value: "comfort", label: "Comfort" },
  { value: "luxury", label: "Luxury" },
  { value: "premium", label: "Premium" },
];

const CURRENT_YEAR = new Date().getFullYear();
const ABEX_YEARS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - i);
const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const ACCEPTED_EXT = ".pdf,.png,.jpg,.jpeg";

// ── Helpers ──────────────────────────────────────────────────────────────────

function metaToForm(meta: ExtractedDossierMetadata): Partial<FormValues> {
  return {
    address: meta.address ?? "",
    postcode: meta.postcode ?? "",
    building_type: meta.building_type ?? "",
    known_total_price: meta.known_total_price != null ? String(meta.known_total_price) : "",
    known_total_sqm: meta.known_total_sqm != null ? String(meta.known_total_sqm) : "",
    finishing_level: meta.expert_finishing_level ?? "",
    expert_notes: meta.expert_notes ?? "",
  };
}

function PageTypeBadge({ type, count }: { type: string; count: number }) {
  if (count === 0) return null;
  const variant =
    type === "floor_plan"
      ? "default"
      : type === "expert_report"
      ? "secondary"
      : "outline";
  return (
    <Badge variant={variant} className="text-xs">
      {count} {type.replace("_", " ")}
    </Badge>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function DossierUploadForm({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("select");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const pricePerSqm =
    form.known_total_price && form.known_total_sqm && Number(form.known_total_sqm) > 0
      ? (Number(form.known_total_price) / Number(form.known_total_sqm)).toFixed(2)
      : "";

  const setField = (key: keyof FormValues) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  // ── File selection ───────────────────────────────────────────────────────

  const pickFile = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const f = list[0];
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError("Invalid file type — please upload a PDF, PNG, or JPG.");
      return;
    }
    setFile(f);
    setError(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      pickFile(e.dataTransfer.files);
    },
    [pickFile]
  );

  // ── Upload + analyze ─────────────────────────────────────────────────────

  async function handleUploadAndAnalyze() {
    if (!file) return;
    setError(null);

    // Step 1: get a signed upload URL from the server (tiny request — no file bytes through Vercel)
    setPhase("uploading");
    const urlRes = await fetch("/api/upload-signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, checkDuplicate: true }),
    });
    const urlData = (await urlRes.json()) as {
      status: string; id?: string; path?: string; token?: string;
      existingId?: string; error?: string;
    };

    if (urlData.status === "duplicate") {
      setDuplicateId(urlData.existingId ?? null);
      setError("This file has already been uploaded.");
      setPhase("select");
      return;
    }
    if (!urlRes.ok || !urlData.path || !urlData.token) {
      setError(urlData.error ?? "Failed to prepare upload.");
      setPhase("select");
      return;
    }

    // Step 2: upload file directly from browser to Supabase Storage (bypasses Vercel size limit)
    const supabase = createSupabaseBrowserClient();
    const { error: uploadError } = await supabase.storage
      .from("plans")
      .uploadToSignedUrl(urlData.path, urlData.token, file);
    if (uploadError) {
      setError(uploadError.message);
      setPhase("select");
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
    setUploadedFile({
      dossierId: urlData.id!,
      storagePath: urlData.path,
      fileName: file.name,
      fileType: ext === "pdf" ? "pdf" : "image",
    });

    // For PDFs, run analysis
    if (file.type === "application/pdf") {
      setPhase("analyzing");
      try {
        const res = await fetch("/api/analyze-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath: urlData.path }),
        });
        if (res.ok) {
          const data = (await res.json()) as AnalysisResult;
          setAnalysis(data);
          setForm({ ...EMPTY_FORM, ...metaToForm(data.extractedMetadata) });
        }
      } catch {
        // Analysis failed — still let user fill form manually
      }
    }

    setPhase("review");
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!uploadedFile) return;
    setPhase("saving");
    setError(null);

    const result = await saveDossier({
      dossierId: uploadedFile.dossierId,
      storagePath: uploadedFile.storagePath,
      fileName: uploadedFile.fileName,
      fileType: uploadedFile.fileType,
      pageClassifications: analysis?.classifications ?? null,
      ...form,
    });

    if (result.status === "duplicate") {
      setDuplicateId(result.id);
      setError("A dossier with this filename already exists.");
      setPhase("review");
      return;
    }

    if (result.status === "error") {
      setError(result.message);
      setPhase("review");
      return;
    }

    setPhase("success");
    router.refresh();
    onSuccess?.();

    // Auto-trigger processing
    fetch("/api/process-dossier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dossierId: uploadedFile.dossierId }),
    }).catch(() => {
      // Fire-and-forget — errors show in dossier status
    });
  }

  // ── Render: select ───────────────────────────────────────────────────────

  if (phase === "select") {
    return (
      <div className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="space-y-2">
          <Label>Plan file <span className="text-destructive">*</span></Label>
          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 cursor-pointer transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            )}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? (
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4 text-muted-foreground" />
                {file.name}
                <span className="text-xs text-muted-foreground">
                  ({(file.size / 1024 / 1024).toFixed(1)} MB)
                </span>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Drag & drop or <span className="font-medium text-foreground">click to browse</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">PDF (VerzamelPDF), PNG, JPG</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXT}
            className="hidden"
            onChange={(e) => pickFile(e.target.files)}
          />
        </div>
        <Button onClick={handleUploadAndAnalyze} disabled={!file} className="w-full sm:w-auto">
          {file?.type === "application/pdf" ? "Upload & Analyze PDF" : "Upload"}
        </Button>
      </div>
    );
  }

  // ── Render: uploading / analyzing ────────────────────────────────────────

  if (phase === "uploading" || phase === "analyzing") {
    const label =
      phase === "uploading"
        ? "Uploading to storage…"
        : "Analyzing PDF — classifying pages and extracting metadata…";
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{label}</p>
        {phase === "analyzing" && (
          <p className="text-xs text-muted-foreground">
            This may take up to 60 seconds for large PDFs.
          </p>
        )}
      </div>
    );
  }

  // ── Render: success ──────────────────────────────────────────────────────

  if (phase === "success") {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <CheckCircle className="h-8 w-8 text-green-500" />
        <p className="text-sm font-medium">Dossier saved successfully.</p>
        <Button variant="outline" size="sm" onClick={() => {
          setPhase("select");
          setFile(null);
          setUploadedFile(null);
          setAnalysis(null);
          setForm(EMPTY_FORM);
          setError(null);
          setDuplicateId(null);
        }}>
          Upload another
        </Button>
      </div>
    );
  }

  // ── Render: saving ───────────────────────────────────────────────────────

  if (phase === "saving") {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Saving dossier…</p>
      </div>
    );
  }

  // ── Render: review ───────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* PDF analysis summary */}
      {analysis && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <p className="text-sm font-medium">
            PDF analysis complete —{" "}
            {analysis.totalPageCount} pages total
            {analysis.totalPageCount > analysis.processedPageCount &&
              ` (first ${analysis.processedPageCount} classified)`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(["floor_plan", "expert_report", "photo", "pricing_table", "cover", "other"] as const).map(
              (t) => (
                <PageTypeBadge
                  key={t}
                  type={t}
                  count={analysis.classifications.filter((c) => c.type === t).length}
                />
              )
            )}
          </div>
          {analysis.floorPlanPages.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Floor plans on page{analysis.floorPlanPages.length > 1 ? "s" : ""}{" "}
              {analysis.floorPlanPages.join(", ")}
            </p>
          )}
          {analysis.floorPlanPages.length === 0 && (
            <p className="text-xs text-destructive">
              No floor plan pages detected — you can still save and process manually.
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive">
          {error}
          {duplicateId && (
            <a
              href={`/admin/dossiers/${duplicateId}`}
              className="ml-2 underline underline-offset-4"
            >
              View existing dossier →
            </a>
          )}
        </div>
      )}

      {/* File info */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileText className="h-4 w-4" />
        <span className="font-medium text-foreground">{uploadedFile?.fileName}</span>
        {analysis && (
          <span className="text-xs">
            — review extracted data below, edit as needed
          </span>
        )}
      </div>

      {/* Address + postcode */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
          <Input
            id="address"
            placeholder="Stationsstraat 12, Antwerpen"
            value={form.address}
            onChange={(e) => setField("address")(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postcode">Postcode</Label>
          <Input
            id="postcode"
            placeholder="2000"
            maxLength={8}
            value={form.postcode}
            onChange={(e) => setField("postcode")(e.target.value)}
          />
        </div>
      </div>

      {/* Building type + finishing level */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Building type</Label>
          <Select value={form.building_type} onValueChange={setField("building_type")}>
            <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
            <SelectContent>
              {BUILDING_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Known finishing level</Label>
          <Select value={form.finishing_level} onValueChange={setField("finishing_level")}>
            <SelectTrigger><SelectValue placeholder="Select level…" /></SelectTrigger>
            <SelectContent>
              {FINISHING_LEVELS.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Price fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="total_price">Total price (€)</Label>
          <Input
            id="total_price"
            type="number"
            min={0}
            step={0.01}
            placeholder="250000"
            value={form.known_total_price}
            onChange={(e) => setField("known_total_price")(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="total_sqm">Total m²</Label>
          <Input
            id="total_sqm"
            type="number"
            min={0}
            step={0.01}
            placeholder="150"
            value={form.known_total_sqm}
            onChange={(e) => setField("known_total_sqm")(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Price / m² (auto)</Label>
          <Input
            type="text"
            readOnly
            value={pricePerSqm ? `€ ${pricePerSqm}` : ""}
            placeholder="Calculated"
            className="bg-muted text-muted-foreground cursor-default"
          />
        </div>
      </div>

      {/* ABEX reference */}
      <div className="space-y-2">
        <Label>ABEX reference period</Label>
        <div className="flex gap-3">
          <Select value={form.abex_year} onValueChange={setField("abex_year")}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>
              {ABEX_YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={form.abex_semester} onValueChange={setField("abex_semester")}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Semester" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">S1 (Jan–Jun)</SelectItem>
              <SelectItem value="2">S2 (Jul–Dec)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Expert notes */}
      <div className="space-y-2">
        <Label htmlFor="expert_notes">Expert notes</Label>
        <Textarea
          id="expert_notes"
          rows={4}
          placeholder="Original expert description, observations, special features…"
          value={form.expert_notes}
          onChange={(e) => setField("expert_notes")(e.target.value)}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave}>Save Dossier</Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setPhase("select");
            setFile(null);
            setUploadedFile(null);
            setAnalysis(null);
            setForm(EMPTY_FORM);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
