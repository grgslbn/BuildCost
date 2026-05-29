"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BenchmarkAnnotation, AnnotationCategory } from "@/lib/prompt-lab/types";

const CATEGORY_COLORS: Record<AnnotationCategory, string> = {
  general: "bg-gray-100 text-gray-700",
  vision_limit: "bg-purple-100 text-purple-700",
  prompt_issue: "bg-blue-100 text-blue-700",
  classifier_error: "bg-orange-100 text-orange-700",
  scale_error: "bg-red-100 text-red-700",
  room_missing: "bg-amber-100 text-amber-700",
  room_extra: "bg-yellow-100 text-yellow-700",
  qqp_error: "bg-pink-100 text-pink-700",
  ground_truth_error: "bg-emerald-100 text-emerald-700",
};

const CATEGORY_LABELS: Record<AnnotationCategory, string> = {
  general: "General",
  vision_limit: "Vision limit",
  prompt_issue: "Prompt issue",
  classifier_error: "Classifier error",
  scale_error: "Scale error",
  room_missing: "Room missing",
  room_extra: "Room extra",
  qqp_error: "QQP error",
  ground_truth_error: "Expert error",
};

export function AnnotationList({
  annotations: initial,
  onDeleted,
}: {
  annotations: BenchmarkAnnotation[];
  onDeleted?: (id: string) => void;
}) {
  const [annotations, setAnnotations] = useState(initial);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/prompt-lab/annotations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setAnnotations((prev) => prev.filter((a) => a.id !== id));
        onDeleted?.(id);
      }
    } finally {
      setDeleting(null);
    }
  }

  if (annotations.length === 0) {
    return <p className="text-sm text-muted-foreground">No annotations yet.</p>;
  }

  return (
    <div className="space-y-3">
      {annotations.map((a) => (
        <div key={a.id} className="rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[a.category]}`}>
                {CATEGORY_LABELS[a.category]}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(a.created_at).toLocaleString("nl-BE", { dateStyle: "short", timeStyle: "short" })}
              </span>
              {a.created_by && (
                <span className="text-xs text-muted-foreground">· {a.created_by}</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(a.id)}
              disabled={deleting === a.id}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-sm whitespace-pre-wrap">{a.body}</p>
        </div>
      ))}
    </div>
  );
}
