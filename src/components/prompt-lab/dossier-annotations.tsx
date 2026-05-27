"use client";

import { useState } from "react";
import { AnnotationForm } from "./annotation-form";
import { AnnotationList } from "./annotation-list";
import type { BenchmarkAnnotation } from "@/lib/prompt-lab/types";

export function DossierAnnotations({
  dossierId,
  initial,
}: {
  dossierId: string;
  initial: BenchmarkAnnotation[];
}) {
  const [annotations, setAnnotations] = useState(initial);

  return (
    <div className="space-y-6">
      <AnnotationForm
        dossierId={dossierId}
        onCreated={(a) => setAnnotations((prev) => [a, ...prev])}
      />
      <AnnotationList
        annotations={annotations}
        onDeleted={(id) => setAnnotations((prev) => prev.filter((a) => a.id !== id))}
      />
    </div>
  );
}
