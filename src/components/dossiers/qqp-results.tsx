import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type QQPValue = {
  value: unknown;
  confidence: number;
  notes?: string;
};

type FinishingAssessment = {
  level: string;
  coefficient: number;
  confidence: number;
  reasoning: string;
  strongest_indicators?: string[];
  weakest_indicators?: string[];
};

type QQPData = {
  qqp_values: Record<string, QQPValue>;
  finishing_assessment: FinishingAssessment;
};

function formatQQPValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function PredictionError({ error }: { error: number }) {
  const pct = Math.abs(error * 100);
  let cls = "text-green-600 dark:text-green-400";
  if (pct > 15) cls = "text-red-600 dark:text-red-400";
  else if (pct > 5) cls = "text-yellow-600 dark:text-yellow-400";
  const sign = error > 0 ? "+" : "";
  return (
    <span className={`font-semibold ${cls}`}>
      {sign}
      {(error * 100).toFixed(1)}%
    </span>
  );
}

export function QqpResults({
  data,
  knownCoefficient,
}: {
  data: QQPData;
  knownCoefficient?: number | null;
}) {
  const { qqp_values, finishing_assessment: fa } = data;
  const predictionError =
    knownCoefficient != null ? fa.coefficient - knownCoefficient : null;

  return (
    <div className="space-y-6">
      {/* Assessment summary */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="text-xs text-muted-foreground">Finishing Level</div>
            <div className="mt-0.5 text-xl font-semibold capitalize">
              {fa.level}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Predicted Coefficient
            </div>
            <div className="mt-0.5 text-xl font-semibold">
              {fa.coefficient.toFixed(3)}
            </div>
          </div>
          {knownCoefficient != null && (
            <div>
              <div className="text-xs text-muted-foreground">
                Known Coefficient
              </div>
              <div className="mt-0.5 text-xl font-semibold">
                {knownCoefficient.toFixed(3)}
              </div>
            </div>
          )}
          {predictionError !== null && (
            <div>
              <div className="text-xs text-muted-foreground">
                Prediction Error
              </div>
              <div className="mt-0.5 text-xl">
                <PredictionError error={predictionError} />
              </div>
            </div>
          )}
          <div>
            <div className="text-xs text-muted-foreground">Confidence</div>
            <div className="mt-0.5 text-xl font-semibold">
              {Math.round(fa.confidence * 100)}%
            </div>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">{fa.reasoning}</p>

        {(fa.strongest_indicators?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-4 text-xs">
            {fa.strongest_indicators && (
              <div>
                <span className="font-medium text-green-700 dark:text-green-400">
                  Strongest:{" "}
                </span>
                {fa.strongest_indicators.join(", ")}
              </div>
            )}
            {fa.weakest_indicators && fa.weakest_indicators.length > 0 && (
              <div>
                <span className="font-medium text-muted-foreground">
                  Weakest:{" "}
                </span>
                {fa.weakest_indicators.join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* QQP values table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Parameter</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Confidence</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(qqp_values).map(([name, v]) => (
              <TableRow key={name}>
                <TableCell className="font-mono text-xs">{name}</TableCell>
                <TableCell className="text-right font-medium">
                  {formatQQPValue(v.value)}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {Math.round(v.confidence * 100)}%
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {v.notes || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
