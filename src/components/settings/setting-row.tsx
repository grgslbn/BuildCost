"use client";

import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { saveSetting } from "@/app/actions/save-setting";
import { cn } from "@/lib/utils";

export type SettingRowData = {
  key: string;
  value: unknown;
  display_name: string;
  description: string | null;
  category: string;
  updated_at: string;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

function inferType(value: unknown): "number" | "text" | "boolean" {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (value === "true" || value === "false") return "boolean";
  return "text";
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SettingRow({
  setting,
  className,
}: {
  setting: SettingRowData;
  className?: string;
}) {
  const valueType = inferType(setting.value);
  const [localValue, setLocalValue] = useState(String(setting.value));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [updatedAt, setUpdatedAt] = useState(setting.updated_at);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const originalRef = useRef(String(setting.value));

  async function handleSave(val: string) {
    if (val === originalRef.current) return;
    setStatus("saving");
    setErrorMsg(null);
    const result = await saveSetting(setting.key, val, valueType);
    if (result.success) {
      originalRef.current = val;
      setUpdatedAt(result.updatedAt);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2500);
    } else {
      setErrorMsg(result.error);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 4000);
    }
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-0.5">
          <Label className="text-sm font-medium">{setting.display_name}</Label>
          {setting.description && (
            <p className="text-xs text-muted-foreground">{setting.description}</p>
          )}
          <p className="text-[10px] font-mono text-muted-foreground/60">{setting.key}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {valueType === "boolean" ? (
            <Switch
              checked={localValue === "true"}
              onCheckedChange={(checked) => {
                const v = String(checked);
                setLocalValue(v);
                handleSave(v);
              }}
              disabled={status === "saving"}
            />
          ) : (
            <Input
              type={valueType === "number" ? "number" : "text"}
              value={localValue}
              step={valueType === "number" ? "any" : undefined}
              className="w-44 text-right"
              onChange={(e) => setLocalValue(e.target.value)}
              onBlur={(e) => handleSave(e.target.value)}
              disabled={status === "saving"}
            />
          )}

          <span
            className={cn(
              "w-14 text-right text-xs transition-all",
              status === "saving" && "text-muted-foreground",
              status === "saved" && "text-green-600 dark:text-green-400",
              status === "error" && "text-destructive",
              status === "idle" && "invisible"
            )}
          >
            {status === "saving" && "Saving…"}
            {status === "saved" && "Saved ✓"}
            {status === "error" && (errorMsg ?? "Error")}
          </span>
        </div>
      </div>

      <p className="text-right text-[10px] text-muted-foreground/50">
        Last updated: {formatTimestamp(updatedAt)}
      </p>
    </div>
  );
}
