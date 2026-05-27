"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import { ANNOTATION_CATEGORIES, type AnnotationCategory, type BenchmarkAnnotation } from "@/lib/prompt-lab/types";

const CATEGORY_LABELS: Record<AnnotationCategory, string> = {
  general: "General",
  vision_limit: "Vision limit",
  prompt_issue: "Prompt issue",
  classifier_error: "Classifier error",
  scale_error: "Scale error",
  room_missing: "Room missing",
  room_extra: "Room extra",
  qqp_error: "QQP error",
  ground_truth_error: "GT error",
};

export function AnnotationForm({
  dossierId,
  runId,
  onCreated,
}: {
  dossierId: string;
  runId?: string;
  onCreated: (annotation: BenchmarkAnnotation) => void;
}) {
  const [category, setCategory] = useState<AnnotationCategory>("general");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/admin/prompt-lab/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossierId, category, body: body.trim(), runId }),
      });
      const data = await res.json();
      if (res.ok) {
        onCreated(data);
        setBody("");
        setCategory("general");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as AnnotationCategory)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          {ANNOTATION_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>
      </div>
      <Textarea
        placeholder="Add a note..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
      />
      <Button type="submit" size="sm" disabled={saving || !body.trim()}>
        {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
        Add
      </Button>
    </form>
  );
}
