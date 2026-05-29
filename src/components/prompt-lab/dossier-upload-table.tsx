"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Upload, CheckCircle2, XCircle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type Dossier = {
  id: string;
  plan_file_name: string | null;
  calculation_file_name: string | null;
  address: string | null;
  postcode: string | null;
};

type DossierAccuracy = {
  dossier_id: string;
  cost_error_pct: number | null;
  cat1_error_pct: number | null;
  cat2_error_pct: number | null;
  cat3_error_pct: number | null;
  predicted_total_cost: number | null;
  error_message: string | null;
  run_name: string;
  run_date: string;
};

function fmtEur(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${Math.round(n).toLocaleString("nl-BE")}`;
}

/** Colour for the cost deviation vs expert: green ≤10%, amber ≤20%, red beyond. */
function costDeltaColor(pct: number | null): string {
  if (pct == null) return "text-muted-foreground";
  const abs = Math.abs(pct);
  if (abs <= 10) return "text-green-600";
  if (abs <= 20) return "text-amber-600";
  return "text-red-600 font-medium";
}

type GtInfo = { expert_total_price: number | null };
type FilterMode = "all" | "ready" | "tested" | "untested" | "errors";

export function DossierUploadTable({
  dossiers: initial,
  latestResults = {},
  groundTruth = {},
}: {
  dossiers: Dossier[];
  latestResults?: Record<string, DossierAccuracy>;
  groundTruth?: Record<string, GtInfo>;
}) {
  const [dossiers, setDossiers] = useState(initial);
  const [gt, setGt] = useState<Record<string, GtInfo>>(groundTruth);
  const [uploading, setUploading] = useState<Record<string, "plan" | "calculation" | null>>({});
  const [extractingGt, setExtractingGt] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const planRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const calcRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleExtractGt(dossierId: string) {
    setExtractingGt((prev) => ({ ...prev, [dossierId]: true }));
    setErrors((prev) => ({ ...prev, [dossierId]: null }));
    try {
      const res = await fetch("/api/prompt-lab/extract-gt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossierId }),
      });
      const data = await res.json();
      if (data.success) {
        setGt((prev) => ({ ...prev, [dossierId]: { expert_total_price: data.result?.expert_total_price ?? null } }));
      } else {
        setErrors((prev) => ({ ...prev, [dossierId]: data.error?.slice(0, 80) ?? "GT extractie mislukt" }));
      }
    } catch {
      setErrors((prev) => ({ ...prev, [dossierId]: "GT extractie mislukt" }));
    } finally {
      setExtractingGt((prev) => ({ ...prev, [dossierId]: false }));
    }
  }

  // Filter and search
  const filtered = dossiers.filter((d) => {
    // Search filter
    const q = search.toLowerCase();
    if (q && !(
      d.plan_file_name?.toLowerCase().includes(q) ||
      d.address?.toLowerCase().includes(q) ||
      d.postcode?.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q)
    )) return false;

    // Status filter
    if (filter === "ready") return d.plan_file_name && d.calculation_file_name && !latestResults[d.id];
    if (filter === "tested") return latestResults[d.id] && !latestResults[d.id].error_message;
    if (filter === "untested") return !latestResults[d.id];
    if (filter === "errors") return latestResults[d.id]?.error_message != null;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // Stats
  const testedCount = Object.values(latestResults).filter((r) => !r.error_message).length;
  const errorCount = Object.values(latestResults).filter((r) => r.error_message).length;
  const readyCount = dossiers.filter((d) => d.plan_file_name && d.calculation_file_name && !latestResults[d.id]).length;

  async function handleUpload(dossierId: string, fileType: "plan" | "calculation", file: File) {
    setUploading((prev) => ({ ...prev, [dossierId]: fileType }));
    setErrors((prev) => ({ ...prev, [dossierId]: null }));

    const form = new FormData();
    form.append("dossierId", dossierId);
    form.append("fileType", fileType);
    form.append("file", file);

    try {
      const res = await fetch("/api/admin/prompt-lab/upload", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        setErrors((prev) => ({ ...prev, [dossierId]: data.error }));
      } else {
        setDossiers((prev) =>
          prev.map((d) =>
            d.id === dossierId
              ? {
                  ...d,
                  ...(fileType === "plan"
                    ? { plan_file_name: file.name }
                    : { calculation_file_name: file.name }),
                }
              : d,
          ),
        );
      }
    } catch {
      setErrors((prev) => ({ ...prev, [dossierId]: "Upload failed" }));
    } finally {
      setUploading((prev) => ({ ...prev, [dossierId]: null }));
    }
  }

  function FileStatus({ name, uploading: isUploading }: { name: string | null; uploading: boolean }) {
    if (isUploading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (name) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    return <XCircle className="h-4 w-4 text-muted-foreground/40" />;
  }

  return (
    <div>
      {/* Search + filters */}
      <div className="flex items-center gap-3 px-4 py-3 border-b flex-wrap">
        <input
          type="text"
          placeholder="Search dossier, address, postcode..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex gap-1 flex-wrap">
          {(["all", "ready", "tested", "untested", "errors"] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(0); }}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {f === "all" && `All (${dossiers.length})`}
              {f === "ready" && `Ready (${readyCount})`}
              {f === "tested" && `Tested (${testedCount})`}
              {f === "untested" && `Untested (${dossiers.length - testedCount - errorCount})`}
              {f === "errors" && `Errors (${errorCount})`}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Dossier</th>
            <th className="px-4 py-3 text-left font-medium">Address</th>
            <th className="px-4 py-3 text-left font-medium">Postcode</th>
            <th className="px-4 py-3 text-left font-medium">Plan</th>
            <th className="px-4 py-3 text-left font-medium">Calc</th>
            <th className="px-4 py-3 text-right font-medium w-[160px]">Expert (CED)</th>
            <th className="px-4 py-3 text-right font-medium w-[150px]">Kost Δ vs CED</th>
            <th className="px-4 py-3 text-center font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((d) => (
            <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium">
                <Link href={`/admin/prompt-lab/dossier/${d.id}`} className="text-primary hover:underline">
                  {d.plan_file_name || d.id.slice(0, 8)}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{d.address || "—"}</td>
              <td className="px-4 py-3 text-muted-foreground">{d.postcode || "—"}</td>
              <td className="px-4 py-3">
                <FileStatus name={d.plan_file_name} uploading={uploading[d.id] === "plan"} />
              </td>
              <td className="px-4 py-3">
                <FileStatus name={d.calculation_file_name} uploading={uploading[d.id] === "calculation"} />
              </td>
              <td className="px-4 py-3 text-right">
                {gt[d.id] ? (
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    <span className="tabular-nums">{fmtEur(gt[d.id].expert_total_price)}</span>
                  </span>
                ) : d.calculation_file_name ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={extractingGt[d.id]}
                    onClick={() => handleExtractGt(d.id)}
                  >
                    {extractingGt[d.id] ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3 mr-1" />
                    )}
                    Extract Expert
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {latestResults[d.id] ? (
                  (() => {
                    const r = latestResults[d.id];
                    if (r.error_message) return <span className="text-xs text-destructive">Error</span>;
                    if (r.cost_error_pct == null) return <span className="text-xs text-muted-foreground">—</span>;
                    return (
                      <span title={`Voorspeld: ${fmtEur(r.predicted_total_cost)} · run "${r.run_name}"`} className="inline-flex flex-col items-end leading-tight">
                        <span className={`tabular-nums ${costDeltaColor(r.cost_error_pct)}`}>
                          {r.cost_error_pct > 0 ? "+" : ""}{r.cost_error_pct.toFixed(1)}%
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{fmtEur(r.predicted_total_cost)}</span>
                      </span>
                    );
                  })()
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-2">
                  <input
                    ref={(el) => { planRefs.current[d.id] = el; }}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(d.id, "plan", file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploading[d.id] != null}
                    onClick={() => planRefs.current[d.id]?.click()}
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    Plan
                  </Button>
                  <input
                    ref={(el) => { calcRefs.current[d.id] = el; }}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(d.id, "calculation", file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={uploading[d.id] != null}
                    onClick={() => calcRefs.current[d.id]?.click()}
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    Calculation
                  </Button>
                </div>
                {errors[d.id] && (
                  <p className="mt-1 text-xs text-destructive text-center">{errors[d.id]}</p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <span className="text-xs text-muted-foreground">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {dossiers.length === 0
            ? "No dossiers found. Upload dossiers first via the bulk upload script."
            : "No dossiers match your search."}
        </div>
      )}
    </div>
  );
}
