"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";

type Props = {
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  processingTimeMs: number | null;
  sqmExtraction: unknown;
  qqpExtraction: unknown;
};

function formatTs(iso: string) {
  return new Date(iso).toLocaleString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMs(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function JsonBlock({ label, data }: { label: string; data: unknown }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
        onClick={() => setOpen((p) => !p)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        {label}
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {open ? "collapse" : "expand"}
        </span>
      </button>
      {open && (
        <div className="border-t bg-muted/30 p-3">
          <pre className="max-h-96 overflow-auto rounded text-xs leading-relaxed text-foreground">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function DebugLog({
  status,
  errorMessage,
  createdAt,
  updatedAt,
  processingTimeMs,
  sqmExtraction,
  qqpExtraction,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Debug log</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Timestamps + status */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <Badge
              variant={status === "error" ? "destructive" : status === "analyzed" || status === "validated" ? "outline" : "secondary"}
              className="mt-1 capitalize"
            >
              {status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="mt-1 font-mono text-xs">{formatTs(createdAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Last updated</p>
            <p className="mt-1 font-mono text-xs">{formatTs(updatedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Processing time</p>
            <p className="mt-1 font-mono text-xs">
              {processingTimeMs != null ? formatMs(processingTimeMs) : "—"}
            </p>
          </div>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">Error</p>
              <p className="mt-0.5 font-mono text-xs text-destructive/80">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Raw JSON */}
        <div className="space-y-2">
          {sqmExtraction ? (
            <JsonBlock label="SQM extraction (raw JSON)" data={sqmExtraction} />
          ) : (
            <p className="text-xs text-muted-foreground">SQM extraction — not yet available.</p>
          )}
          {qqpExtraction ? (
            <JsonBlock label="QQP extraction (raw JSON)" data={qqpExtraction} />
          ) : (
            <p className="text-xs text-muted-foreground">QQP extraction — not yet available.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
