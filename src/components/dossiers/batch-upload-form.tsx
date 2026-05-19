"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { saveDossier } from "@/app/actions/save-dossier";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FileText, X, CheckCircle, AlertCircle, AlertTriangle, Loader2, Upload, Info } from "lucide-react";

// ── Constants ────────────────────────────────────────────────────────────────

const BUILDING_TYPES = [
  { value: "house", label: "House" },
  { value: "apartment", label: "Apartment" },
  { value: "villa", label: "Villa" },
  { value: "duplex", label: "Duplex" },
  { value: "studio", label: "Studio" },
  { value: "commercial", label: "Commercial" },
];

const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);
const ACCEPTED_EXT = ".pdf,.png,.jpg,.jpeg";
const MAX_FILE_SIZE = 60 * 1024 * 1024; // 60 MB

// ── Types ─────────────────────────────────────────────────────────────────────

type FileEntry = {
  id: string;
  file: File;
  validationError?: string;
};

type UploadPhase = "select" | "uploading" | "done";

type UploadResult = {
  fileName: string;
  ok: boolean;
  duplicate?: boolean;
  reused?: boolean;
  existingId?: string;
  error?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function validateFile(f: File): string | undefined {
  if (!ACCEPTED_TYPES.has(f.type)) return "Invalid file type";
  if (f.size > MAX_FILE_SIZE) return "Exceeds 60 MB limit";
  return undefined;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BatchUploadForm({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<UploadPhase>("select");
  const [isDragging, setIsDragging] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [defaultPostcode, setDefaultPostcode] = useState("");
  const [defaultBuildingType, setDefaultBuildingType] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list).map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      validationError: validateFile(f),
    }));
    setEntries((prev) => {
      // Deduplicate by name+size
      const existing = new Set(prev.map((e) => `${e.file.name}|${e.file.size}`));
      return [...prev, ...incoming.filter((e) => !existing.has(`${e.file.name}|${e.file.size}`))];
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const removeEntry = (id: string) =>
    setEntries((prev) => prev.filter((e) => e.id !== id));

  const validEntries = entries.filter((e) => !e.validationError);
  const invalidEntries = entries.filter((e) => e.validationError);

  async function handleUploadAll() {
    if (validEntries.length === 0) return;
    setPhase("uploading");
    setProgress({ done: 0, total: validEntries.length });
    const uploadResults: UploadResult[] = [];
    const supabase = createSupabaseBrowserClient();

    for (let i = 0; i < validEntries.length; i++) {
      setProgress({ done: i, total: validEntries.length });
      const entry = validEntries[i];
      try {
        // Step 1: get signed URL — no file bytes through Vercel
        const urlRes = await fetch("/api/upload-signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: entry.file.name, checkDuplicate: true }),
        });
        const urlData = (await urlRes.json()) as {
          status: string; id?: string; path?: string; token?: string;
          existingId?: string; error?: string;
        };

        if (urlData.status === "duplicate") {
          uploadResults.push({
            fileName: entry.file.name,
            ok: false,
            duplicate: true,
            existingId: urlData.existingId,
            error: "Already uploaded",
          });
          continue;
        }

        if (!urlRes.ok || !urlData.path || !urlData.token || !urlData.id) {
          uploadResults.push({
            fileName: entry.file.name,
            ok: false,
            error: urlData.error ?? "Failed to prepare upload",
          });
          continue;
        }

        // Step 2: upload directly from browser to Supabase Storage
        const { error: uploadError } = await supabase.storage
          .from("plans")
          .uploadToSignedUrl(urlData.path, urlData.token, entry.file);

        if (uploadError) {
          uploadResults.push({ fileName: entry.file.name, ok: false, error: uploadError.message });
          continue;
        }

        const ext = entry.file.name.split(".").pop()?.toLowerCase() ?? "pdf";
        const saveResult = await saveDossier({
          dossierId: urlData.id,
          storagePath: urlData.path,
          fileName: entry.file.name,
          fileType: ext === "pdf" ? "pdf" : "image",
          pageClassifications: null,
          address: "",
          postcode: defaultPostcode,
          building_type: defaultBuildingType,
          known_total_price: "",
          known_total_sqm: "",
          finishing_level: "",
          abex_year: "",
          abex_semester: "",
          expert_notes: "",
        });

        if (saveResult.status === "duplicate") {
          uploadResults.push({
            fileName: entry.file.name,
            ok: false,
            duplicate: true,
            existingId: saveResult.id,
            error: "Already uploaded",
          });
        } else if (saveResult.status === "error") {
          uploadResults.push({ fileName: entry.file.name, ok: false, error: saveResult.message });
        } else {
          uploadResults.push({ fileName: entry.file.name, ok: true });
        }
      } catch {
        uploadResults.push({ fileName: entry.file.name, ok: false, error: "Unexpected error" });
      }
    }

    setProgress({ done: validEntries.length, total: validEntries.length });
    setResults(uploadResults);
    setPhase("done");
    router.refresh();
    onSuccess?.();
  }

  function handleReset() {
    setPhase("select");
    setEntries([]);
    setResults([]);
    setProgress(null);
    setDefaultPostcode("");
    setDefaultBuildingType("");
  }

  // ── Phase: done ──────────────────────────────────────────────────────────

  if (phase === "done") {
    const successCount = results.filter((r) => r.ok).length;
    const duplicateResults = results.filter((r) => r.duplicate);
    const reusedResults = results.filter((r) => r.reused);
    const errorResults = results.filter((r) => !r.ok && !r.duplicate && !r.reused);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 shrink-0 text-green-500" />
          <p className="text-sm font-medium">
            {successCount} file{successCount !== 1 ? "s" : ""} uploaded successfully
            {reusedResults.length > 0 && `, ${reusedResults.length} already in storage`}
            {duplicateResults.length > 0 && `, ${duplicateResults.length} duplicate${duplicateResults.length !== 1 ? "s" : ""} skipped`}
            {errorResults.length > 0 && `, ${errorResults.length} failed`}.
          </p>
        </div>
        {reusedResults.length > 0 && (
          <ul className="space-y-1">
            {reusedResults.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-blue-600">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {r.fileName} — already in storage.{" "}
                  {r.existingId && (
                    <a
                      href={`/admin/dossiers/${r.existingId}`}
                      className="underline underline-offset-4"
                    >
                      View existing →
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {duplicateResults.length > 0 && (
          <ul className="space-y-1">
            {duplicateResults.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {r.fileName} — already uploaded.{" "}
                  {r.existingId && (
                    <a
                      href={`/admin/dossiers/${r.existingId}`}
                      className="underline underline-offset-4"
                    >
                      View existing →
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {errorResults.length > 0 && (
          <ul className="space-y-1">
            {errorResults.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {r.fileName}: {r.error}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" onClick={handleReset}>
          Upload more files
        </Button>
      </div>
    );
  }

  // ── Phase: uploading ─────────────────────────────────────────────────────

  if (phase === "uploading" && progress) {
    const pct = Math.round((progress.done / progress.total) * 100);
    return (
      <div className="space-y-4 py-4">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Uploading file {progress.done + 1} of {progress.total}…
          </p>
        </div>
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-2 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-right text-xs text-muted-foreground">{pct}%</p>
        </div>
      </div>
    );
  }

  // ── Phase: select ────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drag & drop files or{" "}
          <span className="font-medium text-foreground">click to browse</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          PDF (VerzamelPDF), PNG, JPG · multiple files · up to 60 MB each
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXT}
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {/* File list */}
      {entries.length > 0 && (
        <ul className="divide-y divide-border rounded-md border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
              <FileText
                className={cn(
                  "h-4 w-4 shrink-0",
                  entry.validationError ? "text-destructive" : "text-muted-foreground"
                )}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    entry.validationError && "text-destructive"
                  )}
                >
                  {entry.file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(entry.file.size)}
                  {entry.validationError && (
                    <span className="ml-2 text-destructive">{entry.validationError}</span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${entry.file.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Default metadata */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="batch-postcode">
            Default postcode{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="batch-postcode"
            placeholder="2000"
            maxLength={8}
            value={defaultPostcode}
            onChange={(e) => setDefaultPostcode(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>
            Default building type{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Select value={defaultBuildingType} onValueChange={setDefaultBuildingType}>
            <SelectTrigger>
              <SelectValue placeholder="Select type…" />
            </SelectTrigger>
            <SelectContent>
              {BUILDING_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleUploadAll} disabled={validEntries.length === 0}>
          Upload{" "}
          {validEntries.length > 0
            ? `${validEntries.length} file${validEntries.length !== 1 ? "s" : ""}`
            : "files"}
        </Button>
        {invalidEntries.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {invalidEntries.length} invalid file{invalidEntries.length !== 1 ? "s" : ""} will be
            skipped
          </span>
        )}
      </div>
    </div>
  );
}
