import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export type PostcodePrice = {
  postcode: string;
  municipality: string | null;
  province: string | null;
  region: string | null;
  base_price_per_sqm: number;
  year: number;
};

const REGION_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  flanders: "default",
  wallonia: "secondary",
  brussels: "outline",
};

export function RegionalCoefficientsTable({
  rows,
}: {
  rows: PostcodePrice[];
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Regional Coefficients</h2>
        <p className="text-sm text-muted-foreground">
          Base price per m² by postcode. Read-only — update via CSV import or Supabase Studio.
        </p>
      </div>

      <div className="rounded-lg border">
        <ScrollArea className="h-80">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Postcode</TableHead>
                <TableHead>Municipality</TableHead>
                <TableHead>Province</TableHead>
                <TableHead>Region</TableHead>
                <TableHead className="text-right">Base €/m²</TableHead>
                <TableHead className="text-right">Year</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No postcode prices loaded yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.postcode}>
                    <TableCell className="font-mono">{r.postcode}</TableCell>
                    <TableCell>{r.municipality ?? "—"}</TableCell>
                    <TableCell>{r.province ?? "—"}</TableCell>
                    <TableCell>
                      {r.region ? (
                        <Badge
                          variant={REGION_VARIANT[r.region] ?? "secondary"}
                          className="capitalize"
                        >
                          {r.region}
                        </Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {new Intl.NumberFormat("fr-BE", {
                        style: "currency",
                        currency: "EUR",
                        maximumFractionDigits: 2,
                      }).format(r.base_price_per_sqm)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {r.year}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </section>
  );
}
