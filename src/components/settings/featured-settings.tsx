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

type Props = {
  basePrice: SettingRowData;
  abexYear: SettingRowData;
  abexSemester: SettingRowData;
  basePriceMin?: SettingRowData | null;
  basePriceMax?: SettingRowData | null;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

type RecalcResult = {
  suggested_base: number;
  suggested_min: number;
  suggested_max: number;
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

export function FeaturedSettings({ basePrice, abexYear, abexSemester, basePriceMin, basePriceMax }: Props) {
  const price = useSaveField(basePrice, "number");
  const year = useSaveField(abexYear, "number");
  const semester = useSaveField(abexSemester, "number");

  const [minValue, setMinValue] = useState(basePriceMin ? String(basePriceMin.value) : "");
  const [maxValue, setMaxValue] = useState(basePriceMax ? String(basePriceMax.value) : "");
  const [rangeStatus, setRangeStatus] = useState<SaveStatus>("idle");

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
      if (!res.ok) throw new Error(data.error ?? "Recalculation failed");
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
        body: JSON.stringify({
          base: recalcResult.suggested_base,
          min: recalcResult.suggested_min,
          max: recalcResult.suggested_max,
        }),
      });
      if (!res.ok) throw new Error("Apply failed");
      price.setValue(String(recalcResult.suggested_base));
      setMinValue(String(recalcResult.suggested_min));
      setMaxValue(String(recalcResult.suggested_max));
      setApplyDone(true);
      setRecalcResult(null);
    } catch (e) {
      setRecalcError((e as Error).message);
    } finally {
      setApplyLoading(false);
    }
  }

  async function saveRange(min: string, max: string) {
    setRangeStatus("saving");
    const [r1, r2] = await Promise.all([
      saveSetting("national_base_price_min", min, "number"),
      saveSetting("national_base_price_max", max, "number"),
    ]);
    if (r1.success && r2.success) {
      setRangeStatus("saved");
      setTimeout(() => setRangeStatus("idle"), 2500);
    } else {
      setRangeStatus("error");
      setTimeout(() => setRangeStatus("idle"), 4000);
    }
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

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* National Base Price — prominent */}
      <Card className="border-primary/30 bg-primary/5 sm:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <CardTitle className="text-base">National Base Price (€/m²)</CardTitle>
            <StatusBadge status={price.status} />
          </div>
          <p className="text-sm text-muted-foreground">{basePrice.description}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold text-primary">€</span>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={price.value}
              onChange={(e) => price.setValue(e.target.value)}
              onBlur={(e) => price.save(e.target.value)}
              disabled={price.status === "saving"}
              className={cn(
                "w-36 text-2xl font-semibold",
                "h-12 border-primary/40 focus-visible:ring-primary"
              )}
            />
            <div className="ml-2 text-xs text-muted-foreground">
              Last updated: {new Date(price.updatedAt).toLocaleDateString("fr-BE")}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecalculate}
              disabled={recalcLoading || applyLoading}
              className="ml-auto gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", recalcLoading && "animate-spin")} />
              {recalcLoading ? "Calculating…" : "Recalculate from dossiers"}
            </Button>
          </div>

          {/* Recalculate result panel */}
          {recalcResult && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
              <p className="font-medium text-primary">
                Suggested: €{fmt(recalcResult.suggested_base)} / m²
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                P10: €{fmt(recalcResult.suggested_min)} · P90: €{fmt(recalcResult.suggested_max)} · based on {recalcResult.dossier_count} dossiers
                {recalcResult.outliers_removed > 0 && ` (${recalcResult.outliers_removed} outliers removed)`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Applying will also update the min/max range below.
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
              Base price and range updated from dossier data.
            </div>
          )}

          {recalcError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {recalcError}
            </div>
          )}

          {/* Min / Max range */}
          <div className="pt-1">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Acceptable range</span>
              <StatusBadge status={rangeStatus} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Min</span>
                <span className="text-xs text-muted-foreground">€</span>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  onBlur={() => saveRange(minValue, maxValue)}
                  disabled={rangeStatus === "saving"}
                  className="w-24 h-8 text-sm"
                  placeholder="e.g. 1100"
                />
              </div>
              <span className="text-muted-foreground/50">–</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Max</span>
                <span className="text-xs text-muted-foreground">€</span>
                <Input
                  type="number"
                  min={0}
                  step="1"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  onBlur={() => saveRange(minValue, maxValue)}
                  disabled={rangeStatus === "saving"}
                  className="w-24 h-8 text-sm"
                  placeholder="e.g. 1900"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                Estimations outside this range trigger a pipeline warning.
              </span>
            </div>
          </div>

          <p className="text-xs font-medium text-primary/80">
            This is the core pricing reference. Adjust based on reference dossier analysis.
          </p>
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
