"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { activateModelVersion } from "@/app/actions/activate-model-version";

export function ActivateModelVersionButton({ modelVersionId }: { modelVersionId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleActivate() {
    setError(null);
    startTransition(async () => {
      try {
        await activateModelVersion(modelVersionId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to activate");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={handleActivate} disabled={isPending}>
        {isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
        Activate
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
