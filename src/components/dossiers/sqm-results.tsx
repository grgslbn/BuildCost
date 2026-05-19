import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type Room = {
  id: string;
  label: string;
  label_en: string;
  area_sqm: number;
  category: string;
  confidence: number;
};

type Floor = {
  level: number;
  label: string;
  label_en: string;
  rooms: Room[];
  total_sqm: number;
};

type SqmData = {
  building_type?: { primary: string; style?: string };
  floors?: Floor[];
  summary?: {
    total_livable_sqm: number;
    total_gross_sqm: number;
    floor_count: number;
    bedroom_count: number;
    bathroom_count: number;
  };
  extraction_warnings?: string[];
};

const CATEGORY_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  living: "default",
  bedroom: "secondary",
  bathroom: "outline",
  kitchen: "default",
  dining: "secondary",
};

export function SqmResults({ data }: { data: SqmData }) {
  const { floors = [], summary, extraction_warnings = [] } = data;

  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Livable" value={`${summary.total_livable_sqm} m²`} />
          <StatCard label="Gross" value={`${summary.total_gross_sqm} m²`} />
          <StatCard label="Bedrooms" value={String(summary.bedroom_count)} />
          <StatCard label="Bathrooms" value={String(summary.bathroom_count)} />
        </div>
      )}

      {floors.map((floor) => (
        <div key={floor.level} className="space-y-2">
          <h3 className="text-sm font-medium">
            {floor.label_en || floor.label}
            <span className="ml-2 text-muted-foreground font-normal">
              — {floor.total_sqm} m²
            </span>
          </h3>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Area</TableHead>
                  <TableHead className="text-right">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {floor.rooms.map((room) => (
                  <TableRow key={room.id}>
                    <TableCell>
                      <span className="font-medium">{room.label_en}</span>
                      {room.label !== room.label_en && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          ({room.label})
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          CATEGORY_VARIANT[room.category] ?? "secondary"
                        }
                        className="capitalize text-xs"
                      >
                        {room.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {room.area_sqm} m²
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {Math.round(room.confidence * 100)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}

      {extraction_warnings.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
          <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200">
            Extraction warnings
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-yellow-700 dark:text-yellow-300">
            {extraction_warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
