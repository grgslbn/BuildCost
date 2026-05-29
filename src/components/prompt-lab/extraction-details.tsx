"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Building2, AlertCircle } from "lucide-react";

export type SqmExtraction = {
  project?: {
    scale?: string;
    postcode?: string;
    architect?: string;
    description?: string;
    scale_confidence?: number;
  };
  buildings?: Array<{
    id: string;
    name: string;
    type?: string;
    unit_count?: number;
    floors?: Array<{
      label: string;
      level: number;
      cat1_sqm: number;
      cat2_sqm: number;
      cat3_sqm: number;
      contents?: string;
      measurement?: string;
    }>;
    building_totals?: {
      cat1_sqm: number;
      cat2_sqm: number;
      cat3_sqm: number;
    };
  }>;
  extraction_warnings?: string[];
};

/**
 * Collapsible per-building / per-floor breakdown of an SQM extraction,
 * plus project metadata and extraction warnings.
 *
 * @param defaultOpen - render expanded by default (used inside the pipeline walkthrough)
 */
export function ExtractionDetails({
  extraction,
  defaultOpen = false,
}: {
  extraction: SqmExtraction;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const buildings = extraction.buildings ?? [];
  const warnings = extraction.extraction_warnings ?? [];
  const project = extraction.project;

  if (buildings.length === 0 && warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Extractie details ({buildings.length} gebouw{buildings.length !== 1 ? "en" : ""}{warnings.length > 0 ? `, ${warnings.length} waarschuwing${warnings.length !== 1 ? "en" : ""}` : ""})
      </button>

      {open && (
        <div className="space-y-3 pl-1">
          {/* Project info */}
          {project && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
              {project.description && <p className="font-medium text-sm">{project.description}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {project.scale && <span>Schaal: {project.scale}</span>}
                {project.postcode && <span>Postcode: {project.postcode}</span>}
                {project.architect && <span>Architect: {project.architect}</span>}
                {project.scale_confidence != null && (
                  <span className={cn(
                    project.scale_confidence >= 0.7 ? "text-green-600" :
                    project.scale_confidence >= 0.5 ? "text-amber-600" : "text-red-600"
                  )}>
                    Schaal confidence: {(project.scale_confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Building breakdown */}
          {buildings.map((b) => (
            <div key={b.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{b.name || b.id}</span>
                {b.type && <span className="text-xs text-muted-foreground">({b.type})</span>}
              </div>

              {/* Per-floor table */}
              {b.floors && b.floors.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 text-left font-medium">Verdieping</th>
                      <th className="py-1 text-right font-medium">Cat1</th>
                      <th className="py-1 text-right font-medium">Cat2</th>
                      <th className="py-1 text-right font-medium">Cat3</th>
                      <th className="py-1 text-left pl-3 font-medium">Inhoud</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.floors.map((f, fi) => (
                      <tr key={fi} className="border-b last:border-0">
                        <td className="py-1.5">{f.label}</td>
                        <td className="py-1.5 text-right tabular-nums">{f.cat1_sqm > 0 ? `${f.cat1_sqm.toFixed(0)} m²` : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{f.cat2_sqm > 0 ? `${f.cat2_sqm.toFixed(0)} m²` : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{f.cat3_sqm > 0 ? `${f.cat3_sqm.toFixed(0)} m²` : "—"}</td>
                        <td className="py-1.5 pl-3 text-muted-foreground max-w-xs truncate">{f.contents || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Building measurement method */}
              {b.floors?.some((f) => f.measurement) && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {b.floors?.filter((f) => f.measurement).map((f, fi) => (
                    <p key={fi} className="font-mono">{f.measurement}</p>
                  ))}
                </div>
              )}

              {/* Building totals */}
              {b.building_totals && (
                <div className="flex gap-3 text-xs font-medium border-t pt-1.5">
                  <span>Totaal: Cat1 {b.building_totals.cat1_sqm} m²</span>
                  {b.building_totals.cat2_sqm > 0 && <span>Cat2 {b.building_totals.cat2_sqm} m²</span>}
                  {b.building_totals.cat3_sqm > 0 && <span>Cat3 {b.building_totals.cat3_sqm} m²</span>}
                </div>
              )}
            </div>
          ))}

          {/* Extraction warnings */}
          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" />
                Extractie waarschuwingen
              </div>
              <ul className="text-xs text-amber-700/80 dark:text-amber-400/80 space-y-0.5 list-disc pl-4">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
