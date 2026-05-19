"use client";

import { useState } from "react";
import { updateDossier } from "@/app/actions/update-dossier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Pencil, X, Check } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DossierMeta = {
  id: string;
  address: string | null;
  postcode: string | null;
  building_type: string | null;
  known_total_price: number | null;
  known_total_sqm: number | null;
  known_price_per_sqm: number | null;
  expert_finishing_level: string | null;
  expert_notes: string | null;
  price_abex_year: number | null;
  price_abex_semester: number | null;
};

type FormValues = {
  address: string;
  postcode: string;
  building_type: string;
  known_total_price: string;
  known_total_sqm: string;
  finishing_level: string;
  abex_year: string;
  abex_semester: string;
  expert_notes: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const BUILDING_TYPES = [
  { value: "house", label: "House" },
  { value: "apartment", label: "Apartment" },
  { value: "villa", label: "Villa" },
  { value: "duplex", label: "Duplex" },
  { value: "studio", label: "Studio" },
  { value: "commercial", label: "Commercial" },
];

const FINISHING_LEVELS = [
  { value: "basic", label: "Basic" },
  { value: "standard", label: "Standard" },
  { value: "comfort", label: "Comfort" },
  { value: "luxury", label: "Luxury" },
  { value: "premium", label: "Premium" },
];

const CURRENT_YEAR = new Date().getFullYear();
const ABEX_YEARS = Array.from({ length: 8 }, (_, i) => CURRENT_YEAR - i);

// ── Helpers ──────────────────────────────────────────────────────────────────

function metaToForm(d: DossierMeta): FormValues {
  const notesBase = d.expert_notes?.replace(/\n\n\[ABEX ref:[^\]]*\]$/, "").trim() ?? "";
  return {
    address: d.address ?? "",
    postcode: d.postcode ?? "",
    building_type: d.building_type ?? "",
    known_total_price: d.known_total_price != null ? String(d.known_total_price) : "",
    known_total_sqm: d.known_total_sqm != null ? String(d.known_total_sqm) : "",
    finishing_level: d.expert_finishing_level ?? "",
    abex_year: d.price_abex_year != null ? String(d.price_abex_year) : "",
    abex_semester: d.price_abex_semester != null ? String(d.price_abex_semester) : "",
    expert_notes: notesBase,
  };
}

function fmt(n: number | null, options: Intl.NumberFormatOptions) {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-BE", options).format(n);
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DossierMetadataForm({ dossier }: { dossier: DossierMeta }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues>(() => metaToForm(dossier));

  const setField = (key: keyof FormValues) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const pricePerSqm =
    form.known_total_price && form.known_total_sqm && Number(form.known_total_sqm) > 0
      ? (Number(form.known_total_price) / Number(form.known_total_sqm)).toFixed(2)
      : "";

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await updateDossier({ dossierId: dossier.id, ...form });
    setSaving(false);
    if (result.status === "error") {
      setError(result.message);
    } else {
      setEditing(false);
    }
  }

  function handleCancel() {
    setForm(metaToForm(dossier));
    setEditing(false);
    setError(null);
  }

  // ── Display mode ─────────────────────────────────────────────────────────

  if (!editing) {
    return (
      <div className="space-y-2">
        <InfoRow
          label="Known price/m²"
          value={fmt(dossier.known_price_per_sqm, { style: "currency", currency: "EUR" })}
        />
        <InfoRow
          label="Total price"
          value={fmt(dossier.known_total_price, {
            style: "currency",
            currency: "EUR",
            maximumFractionDigits: 0,
          })}
        />
        <InfoRow
          label="Total area"
          value={dossier.known_total_sqm != null ? `${dossier.known_total_sqm} m²` : "—"}
        />
        <InfoRow label="Finishing level" value={dossier.expert_finishing_level ?? "—"} />
        <InfoRow
          label="ABEX reference"
          value={
            dossier.price_abex_year
              ? `${dossier.price_abex_year} S${dossier.price_abex_semester}`
              : "—"
          }
        />
        {dossier.expert_notes && (
          <div className="border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground">Expert notes</p>
            <p className="mt-1 text-xs text-muted-foreground">{dossier.expert_notes}</p>
          </div>
        )}
        <div className="pt-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit metadata
          </Button>
        </div>
      </div>
    );
  }

  // ── Edit mode ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Address + postcode */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="meta-address" className="text-xs">
            Address
          </Label>
          <Input
            id="meta-address"
            placeholder="Stationsstraat 12"
            value={form.address}
            onChange={(e) => setField("address")(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="meta-postcode" className="text-xs">
            Postcode
          </Label>
          <Input
            id="meta-postcode"
            placeholder="2000"
            maxLength={8}
            value={form.postcode}
            onChange={(e) => setField("postcode")(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Building type + finishing level */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Building type</Label>
          <Select value={form.building_type} onValueChange={setField("building_type")}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {BUILDING_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Finishing level</Label>
          <Select value={form.finishing_level} onValueChange={setField("finishing_level")}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {FINISHING_LEVELS.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Price fields */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="meta-price" className="text-xs">
            Total price (€)
          </Label>
          <Input
            id="meta-price"
            type="number"
            min={0}
            placeholder="250000"
            value={form.known_total_price}
            onChange={(e) => setField("known_total_price")(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="meta-sqm" className="text-xs">
            Total m²
          </Label>
          <Input
            id="meta-sqm"
            type="number"
            min={0}
            placeholder="150"
            value={form.known_total_sqm}
            onChange={(e) => setField("known_total_sqm")(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Price / m² (auto)</Label>
          <Input
            type="text"
            readOnly
            value={pricePerSqm ? `€ ${pricePerSqm}` : ""}
            placeholder="Calculated"
            className="h-8 text-sm bg-muted text-muted-foreground cursor-default"
          />
        </div>
      </div>

      {/* ABEX */}
      <div className="space-y-1.5">
        <Label className="text-xs">ABEX reference period</Label>
        <div className="flex gap-2">
          <Select value={form.abex_year} onValueChange={setField("abex_year")}>
            <SelectTrigger className="h-8 w-28 text-sm">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {ABEX_YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={form.abex_semester} onValueChange={setField("abex_semester")}>
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue placeholder="Semester" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">S1 (Jan–Jun)</SelectItem>
              <SelectItem value="2">S2 (Jul–Dec)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="meta-notes" className="text-xs">
          Expert notes
        </Label>
        <Textarea
          id="meta-notes"
          rows={3}
          placeholder="Expert observations, special features…"
          value={form.expert_notes}
          onChange={(e) => setField("expert_notes")(e.target.value)}
          className="text-sm"
        />
      </div>

      {/* Save / Cancel */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCancel} disabled={saving}>
          <X className="mr-2 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
