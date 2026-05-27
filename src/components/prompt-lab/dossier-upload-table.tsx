"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Dossier = {
  id: string;
  plan_file_name: string | null;
  calculation_file_name: string | null;
  address: string | null;
  postcode: string | null;
};

export function DossierUploadTable({ dossiers: initial }: { dossiers: Dossier[] }) {
  const [dossiers, setDossiers] = useState(initial);
  const [uploading, setUploading] = useState<Record<string, "plan" | "calculation" | null>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const planRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const calcRefs = useRef<Record<string, HTMLInputElement | null>>({});

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
    if (name) return <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3 w-3" />{name}</span>;
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><XCircle className="h-3 w-3" />Missing</span>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Dossier</th>
            <th className="px-4 py-3 text-left font-medium">Address</th>
            <th className="px-4 py-3 text-left font-medium">Postcode</th>
            <th className="px-4 py-3 text-left font-medium">Plan</th>
            <th className="px-4 py-3 text-left font-medium">Calculation</th>
            <th className="px-4 py-3 text-center font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {dossiers.map((d) => (
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
      {dossiers.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No dossiers found. Upload dossiers first via the bulk upload script.
        </div>
      )}
    </div>
  );
}
