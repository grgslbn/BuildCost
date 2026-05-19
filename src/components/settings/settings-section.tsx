import { Separator } from "@/components/ui/separator";
import { SettingRow, type SettingRowData } from "./setting-row";

type Props = {
  title: string;
  description?: string;
  settings: SettingRowData[];
};

export function SettingsSection({ title, description, settings }: Props) {
  if (settings.length === 0) return null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="rounded-lg border bg-card">
        {settings.map((s, i) => (
          <div key={s.key}>
            <SettingRow setting={s} className="p-4" />
            {i < settings.length - 1 && <Separator />}
          </div>
        ))}
      </div>
    </section>
  );
}
