import { CheckCircle2, AlertTriangle, XCircle, Minus } from "lucide-react";
import type { StatusLevel } from "@/lib/prompt-lab/compare";

export function StatusIcon({ status }: { status: StatusLevel }) {
  switch (status) {
    case "match":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "close":
      return <CheckCircle2 className="h-4 w-4 text-amber-500" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "na":
      return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
}
