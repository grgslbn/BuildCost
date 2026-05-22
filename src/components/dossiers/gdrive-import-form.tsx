"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, FolderOpen, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { GDriveFile } from "@/app/api/gdrive-scan/route";

function formatBytes(bytes: number) {
  if (bytes === 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ImportState = { current: number; total: number; imported: number; skipped: number; failed: number };

export function GDriveImportForm() {
  const router = useRouter();
  const { toast } = useToast();
  const checkboxId = useId();

  const [folderUrl, setFolderUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [files, setFiles] = useState<GDriveFile[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [summary, setSummary] = useState<{ imported: number; skipped: number; failed: number } | null>(null);

  async function handleScan() {
    if (!folderUrl.trim()) return;
    setScanning(true);
    setScanError(null);
    setFiles(null);
    setSelected(new Set());
    setSummary(null);

    try {
      const res = await fetch("/api/gdrive-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");

      const fileList: GDriveFile[] = data.files ?? [];
      setFiles(fileList);
      setSelected(new Set(fileList.map((f) => f.id)));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setScanning(false);
    }
  }

  function toggleAll(checked: boolean) {
    if (!files) return;
    setSelected(checked ? new Set(files.map((f) => f.id)) : new Set());
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleImport() {
    if (!files || selected.size === 0 || importing) return;
    setImporting(true);
    setSummary(null);

    const toImport = files.filter((f) => selected.has(f.id));
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < toImport.length; i++) {
      setImportState({ current: i + 1, total: toImport.length, imported, skipped, failed });
      const f = toImport[i];
      try {
        const res = await fetch("/api/gdrive-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: f.id, fileName: f.name }),
        });
        const result = await res.json();
        if (result.status === "imported") imported++;
        else if (result.status === "skipped") skipped++;
        else failed++;
      } catch {
        failed++;
      }
    }

    setSummary({ imported, skipped, failed });
    setImportState(null);
    setImporting(false);
    router.refresh();
    toast({ title: `Import complete: ${imported} imported, ${skipped} skipped, ${failed} failed` });
  }

  const allSelected = files != null && files.length > 0 && selected.size === files.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="space-y-5">
      {/* Folder input */}
      <div className="flex gap-2">
        <Input
          placeholder="Paste Google Drive folder URL or ID"
          value={folderUrl}
          onChange={(e) => setFolderUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleScan()}
          disabled={scanning || importing}
          className="flex-1"
        />
        <Button variant="outline" onClick={handleScan} disabled={scanning || importing || !folderUrl.trim()}>
          {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
          Scan Folder
        </Button>
      </div>

      {scanError && <p className="text-sm text-destructive">{scanError}</p>}

      {/* File list */}
      {files !== null && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Found <span className="text-primary">{files.length} PDF{files.length !== 1 ? "s" : ""}</span>
              {files.length > 0 && ` · ${selected.size} selected`}
            </p>
            {files.length > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${checkboxId}-all`}
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(v) => toggleAll(v === true)}
                />
                <Label htmlFor={`${checkboxId}-all`} className="text-xs cursor-pointer">
                  Select all
                </Label>
              </div>
            )}
          </div>

          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No PDF files found in this folder.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border divide-y text-sm">
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40">
                  <Checkbox
                    id={`${checkboxId}-${f.id}`}
                    checked={selected.has(f.id)}
                    onCheckedChange={(v) => toggleOne(f.id, v === true)}
                    disabled={importing}
                  />
                  <Label
                    htmlFor={`${checkboxId}-${f.id}`}
                    className="flex-1 cursor-pointer truncate font-normal"
                    title={f.name}
                  >
                    {f.name}
                  </Label>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Import button + progress */}
      {files !== null && files.length > 0 && (
        <div className="space-y-2">
          <Button onClick={handleImport} disabled={importing || selected.size === 0}>
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {importing ? "Importing…" : `Import Selected (${selected.size})`}
          </Button>

          {importing && importState && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-1.5 rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.round((importState.current / importState.total) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Importing {importState.current}/{importState.total}…
                ({importState.imported} imported, {importState.skipped} skipped, {importState.failed} failed)
              </p>
            </div>
          )}

          {summary && (
            <p className="text-sm text-muted-foreground rounded-md border border-green-200 bg-green-50 px-3 py-2 text-green-800">
              Imported {summary.imported} file{summary.imported !== 1 ? "s" : ""}
              {summary.skipped > 0 ? `, ${summary.skipped} skipped as duplicate${summary.skipped !== 1 ? "s" : ""}` : ""}
              {summary.failed > 0 ? `, ${summary.failed} failed` : ""}.
              {summary.imported > 0 && " Click Process All Pending to analyze."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
