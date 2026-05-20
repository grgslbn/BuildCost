"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { saveSetting } from "@/app/actions/save-setting";
import type { SettingRowData } from "./setting-row";
import { cn } from "@/lib/utils";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { F_MIN, F_MAX, FINISHING_THRESHOLDS } from "@/lib/cost/calculate-cost";

type Props = {
  cat1Min: SettingRowData;
  cat1Max: SettingRowData;
  cat2Min: SettingRowData;
  cat2Max: SettingRowData;
  cat3Min: SettingRowData;
  cat3Max: SettingRowData;
  abexYear: SettingRowData;
  abexSemester: SettingRowData;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

type RecalcResult = {
  cat1_min: number;
  cat1_max: number;
  cat2_min: number;
  cat2_max: number;
  cat3_min: number;
  cat3_max: number;
  dossier_count: number;
  outliers_removed: number;
};

function useSaveField(setting: SettingRowData, valueType: "number" | "text") {
  const [value, setValue] = useState(String(setting.value));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [updatedAt, setUpdatedAt] = useState(setting.updated_at);

  async function save(val: string) {
    setStatus("saving");
    const result = await saveSetting(setting.key, val, valueType);
    if (result.success) {
      setUpdatedAt(result.updatedAt);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } else {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  }

  return { value, setValue, status, updatedAt, save };
}

function fmt(n: number) {
  return new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 0 }).format(n);
}

function StatusBadge({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  return (
    <Badge
      variant={status === "saved" ? "outline" : status === "error" ? "destructive" : "secondary"}
      className="text-xs"
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Error"}
    </Badge>
  );
}

function FinishingBar() {
  const range = F_MAX - F_MIN;
  return (
    <div className="space-y-1">
      <div className="flex h-5 w-full overflow-hidden rounded-sm text-[9px] font-medium">
        {FINISHING_THRESHOLDS.map((t, i) => {
          const prev = i === 0 ? F_MIN : FINISHING_THRESHOLDS[i - 1].max;
          const curr = Math.min(t.max, F_MAX);
          const width = ((curr - prev) / range) * 100;
          const colors = [
            "bg-blue-100 text-blue-700",
            "bg-green-100 text-green-700",
            "bg-yellow-100 text-yellow-700",
            "bg-orange-100 text-orange-700",
            "bg-red-100 text-red-700",
          ];
          return (
            <div
              key={t.label}
              className={cn("flex items-center justify-center truncate border-r last:border-r-0 border-white/40", colors[i])}
              style={{ width: `${width}%` }}
            >
              {t.label}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>F = {F_MIN}</span>
        <span>F = {F_MAX}</span>
      </div>
    </div>
  );
}

type CatRowProps = {
  label: string;
  description: string;
  minField: ReturnType<typeof useSaveField>;
  maxField: ReturnType<typeof useSaveField>;
};

function CatRow({ label, description, minField, maxField }: CatRowProps) {
  const minNum = parseFloat(minField.value);
  const maxNum = parseFloat(maxField.value);
  const invalid = !isNaN(minNum) && !isNaN(maxNum) && minNum >= maxNum;

  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-x-4 gap-y-0.5 border-b last:border-b-0 py-2.5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{description}</p>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Min €</span>
            <Input
              type="number"
              min={0}
              step="1"
              value={minField.value}
              onChange={(e) => minField.setValue(e.target.value)}
              onBlur={(e) => minField.save(e.target.value)}
              disabled={minField.status === "saving"}
              className={cn("w-24 h-8 text-sm", invalid && "border-destructive ring-destructive")}
            />
            <StatusBadge status={minField.status} />
          </div>
          <span className="text-muted-foreground/50 text-xs">—</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Max €</span>
            <Input
              type="number"
              min={0}
              step="1"
              value={maxField.value}
              onChange={(e) => maxField.setValue(e.target.value)}
              onBlur={(e) => maxField.save(e.target.value)}
              disabled={maxField.status === "saving"}
              className={cn("w-24 h-8 text-sm", invalid && "border-destructive ring-destructive")}
            />
            <StatusBadge status={maxField.status} />
          </div>
        </div>
        {invalid && (
          <p className="text-xs text-destructive">Min must be less than Max</p>
        )}
      </div>
    </div>
  );
}

export function FeaturedSettings({
  cat1Min, cat1Max,
  cat2Min, cat2Max,
  cat3Min, cat3Max,
  abexYear, abexSemester,
}: Props) {
  const c1min = useSaveField(cat1Min, "number");
  const c1max = useSaveField(cat1Max, "number");
  const c2min = useSaveField(cat2Min, "number");
  const c2max = useSaveField(cat2Max, "number");
  const c3min = useSaveField(cat3Min, "number");
  const c3max = useSaveField(cat3Max, "number");
  const year = useSaveField(abexYear, "number");
  const semester = useSaveField(abexSemester, "number");

  const [recalcLoading, setRecalcLoading] = useState(false);
  const [recalcResult, setRecalcResult] = useState<RecalcResult | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyDone, setApplyDone] = useState(false);

  async function handleRecalculate() {
    setRecalcLoading(true);
    setRecalcError(null);
    setRecalcResult(null);
    setApplyDone(false);
    try {
      const res = await fetch("/api/recalculate-base-price");
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Recalculation failed");
      setRecalcResult(data as RecalcResult);
    } catch (e) {
      setRecalcError((e as Error).message);
    } finally {
      setRecalcLoading(false);
    }
  }

  async function handleApply() {
    if (!recalcResult) return;
    setApplyLoading(true);
    try {
      const res = await fetch("/api/recalculate-base-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recalcResult),
      });
      if (!res.ok) throw new Error("Apply failed");
      c1min.setValue(String(recalcResult.cat1_min));
      c1max.setValue(String(recalcResult.cat1_max));
      c2min.setValue(String(recalcResult.cat2_min));
      c2max.setValue(String(recalcResult.cat2_max));
      c3min.setValue(String(recalcResult.cat3_min));
      c3max.setValue(String(recalcResult.cat3_max));
      setApplyDone(true);
      setRecalcResult(null);
    } catch (e) {
      setRecalcError((e as Error).message);
    } finally {
      setApplyLoading(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Area pricing — spans full width */}
      <Card className="border-primary/30 bg-primary/5 sm:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base">Area Category Pricing (€/m²)</CardTitle>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Price per m² interpolated linearly between Min (F={F_MIN}) and Max (F={F_MAX}).
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecalculate}
              disabled={recalcLoading || applyLoading}
              className="ml-4 shrink-0 gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", recalcLoading && "animate-spin")} />
              {recalcLoading ? "Calculating…" : "Recalculate from dossiers"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <FinishingBar />

          <CatRow
            label="CAT1 — Livable"
            description="Living, bedroom, kitchen, bathroom, office…"
            minField={c1min}
            maxField={c1max}
          />
          <CatRow
            label="CAT2 — Enclosed"
            description="Garage, storage, utility room"
            minField={c2min}
            maxField={c2max}
          />
          <CatRow
            label="CAT3 — Outdoor built"
            description="Terrace, balcony"
            minField={c3min}
            maxField={c3max}
          />

          {/* Recalculate result panel */}
          {recalcResult && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
              <p className="font-medium text-primary">Suggested prices from dossier analysis</p>
              <div className="mt-1.5 grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span>CAT1: €{fmt(recalcResult.cat1_min)} – €{fmt(recalcResult.cat1_max)}</span>
                <span>CAT2: €{fmt(recalcResult.cat2_min)} – €{fmt(recalcResult.cat2_max)}</span>
                <span>CAT3: €{fmt(recalcResult.cat3_min)} – €{fmt(recalcResult.cat3_max)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Based on {recalcResult.dossier_count} dossiers
                {recalcResult.outliers_removed > 0 && ` (${recalcResult.outliers_removed} outliers removed)`}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={handleApply} disabled={applyLoading}>
                  {applyLoading ? "Applying…" : "Apply suggestion"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRecalcResult(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {applyDone && (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              All category prices updated from dossier data.
            </div>
          )}

          {recalcError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {recalcError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ABEX Year */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <CardTitle className="text-base">ABEX Reference Year</CardTitle>
            <StatusBadge status={year.status} />
          </div>
          <p className="text-xs text-muted-foreground">{abexYear.description}</p>
        </CardHeader>
        <CardContent>
          <Input
            type="number"
            min={2000}
            max={2100}
            step={1}
            value={year.value}
            onChange={(e) => year.setValue(e.target.value)}
            onBlur={(e) => year.save(e.target.value)}
            disabled={year.status === "saving"}
            className="w-28 text-lg font-medium"
          />
          <p className="mt-1 text-[10px] text-muted-foreground/50">
            Last updated: {new Date(year.updatedAt).toLocaleDateString("fr-BE")}
          </p>
        </CardContent>
      </Card>

      {/* ABEX Semester */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <CardTitle className="text-base">ABEX Reference Semester</CardTitle>
            <StatusBadge status={semester.status} />
          </div>
          <p className="text-xs text-muted-foreground">{abexSemester.description}</p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {[1, 2].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  semester.setValue(String(s));
                  semester.save(String(s));
                }}
                disabled={semester.status === "saving"}
                className={cn(
                  "flex h-10 w-16 items-center justify-center rounded-md border text-sm font-medium transition-colors",
                  semester.value === String(s)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted"
                )}
              >
                S{s}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            S1 = Jan–Jun · S2 = Jul–Dec
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground/50">
            Last updated: {new Date(semester.updatedAt).toLocaleDateString("fr-BE")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
