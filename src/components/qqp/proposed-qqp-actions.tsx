"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Check, X } from "lucide-react";

export function ProposedQQPActions({ proposedName }: { proposedName: string }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  async function callManage(action: "accept" | "reject") {
    if (action === "accept") setAccepting(true);
    else setRejecting(true);

    try {
      await fetch("/api/manage-qqp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, proposedName }),
      });
      router.refresh();
    } finally {
      setAccepting(false);
      setRejecting(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs text-green-600 hover:bg-green-50 hover:text-green-700"
        disabled={accepting || rejecting}
        onClick={() => callManage("accept")}
      >
        {accepting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        <span className="ml-1">Accept</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
        disabled={accepting || rejecting}
        onClick={() => callManage("reject")}
      >
        {rejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        <span className="ml-1">Reject</span>
      </Button>
    </div>
  );
}
