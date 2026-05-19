"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { saveSetting } from "@/app/actions/save-setting";
import type { SettingRowData } from "./setting-row";
import { cn } from "@/lib/utils";

type Props = {
  basePrice: SettingRowData;
  abexYear: SettingRowData;
  abexSemester: SettingRowData;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

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

export function FeaturedSettings({ basePrice, abexYear, abexSemester }: Props) {
  const price = useSaveField(basePrice, "number");
  const year = useSaveField(abexYear, "number");
  const semester = useSaveField(abexSemester, "number");

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
          <p className="text-sm text-muted-foreground">
            {basePrice.description}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
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
              Last updated:{" "}
              {new Date(price.updatedAt).toLocaleDateString("fr-BE")}
            </div>
          </div>
          <p className="mt-2 text-xs font-medium text-primary/80">
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
