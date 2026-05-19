import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DossierDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link href="/admin/dossiers">← Back to dossiers</Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Dossier detail</CardTitle>
          <CardDescription>
            ID: <code className="rounded bg-muted px-1 py-0.5 text-xs">{params.id}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Detail view coming soon — will show extracted SQM data, QQP values, and cost estimation results.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
