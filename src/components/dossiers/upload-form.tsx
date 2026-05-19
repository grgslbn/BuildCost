"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { uploadDossier, type UploadDossierState } from "@/app/actions/upload-dossier";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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

const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg"];
const ACCEPTED_EXT = ".pdf,.png,.jpg,.jpeg";

const initialState: UploadDossierState = { status: "idle" };

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} className="w-full sm:w-auto">
      {pending ? "Uploading…" : "Upload dossier"}
    </Button>
  );
}

export function DossierUploadForm({ onSuccess }: { onSuccess?: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [state, formAction] = useFormState(uploadDossier, initialState);

  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [totalPrice, setTotalPrice] = useState("");
  const [totalSqm, setTotalSqm] = useState("");

  const pricePerSqm =
    totalPrice && totalSqm && Number(totalSqm) > 0
      ? (Number(totalPrice) / Number(totalSqm)).toFixed(2)
      : "";

  const setFileFromList = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const f = list[0];
    if (!ACCEPTED_TYPES.includes(f.type)) {
      toast({ variant: "destructive", title: "Invalid file type", description: "Please upload a PDF, PNG, or JPG." });
      return;
    }
    setFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setFileFromList(e.dataTransfer.files);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state.status === "success") {
      toast({ title: "Dossier uploaded", description: "The reference dossier has been saved with status 'pending'." });
      formRef.current?.reset();
      setFile(null);
      setTotalPrice("");
      setTotalSqm("");
      router.refresh();
      onSuccess?.();
    } else if (state.status === "error") {
      toast({ variant: "destructive", title: "Upload failed", description: state.message });
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      {/* Drop zone */}
      <div className="space-y-2">
        <Label>Plan file <span className="text-destructive">*</span></Label>
        <div
          className={cn(
            "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 cursor-pointer transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {file ? (
            <p className="text-sm font-medium text-foreground">{file.name}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Drag & drop or <span className="font-medium text-foreground">click to browse</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">PDF, PNG, JPG</p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          name="plan_file"
          accept={ACCEPTED_EXT}
          className="hidden"
          onChange={(e) => setFileFromList(e.target.files)}
          required
        />
      </div>

      {/* Address + postcode */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="address">Address</Label>
          <Input id="address" name="address" placeholder="Stationsstraat 12, Antwerpen" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postcode">Postcode</Label>
          <Input id="postcode" name="postcode" placeholder="2000" maxLength={8} />
        </div>
      </div>

      {/* Building type + finishing level */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Building type</Label>
          <Select name="building_type">
            <SelectTrigger>
              <SelectValue placeholder="Select type…" />
            </SelectTrigger>
            <SelectContent>
              {BUILDING_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Known finishing level</Label>
          <Select name="finishing_level">
            <SelectTrigger>
              <SelectValue placeholder="Select level…" />
            </SelectTrigger>
            <SelectContent>
              {FINISHING_LEVELS.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Price fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="known_total_price">Total price (€)</Label>
          <Input
            id="known_total_price"
            name="known_total_price"
            type="number"
            min={0}
            step={0.01}
            placeholder="250000"
            value={totalPrice}
            onChange={(e) => setTotalPrice(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="known_total_sqm">Total m²</Label>
          <Input
            id="known_total_sqm"
            name="known_total_sqm"
            type="number"
            min={0}
            step={0.01}
            placeholder="150"
            value={totalSqm}
            onChange={(e) => setTotalSqm(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="price_per_sqm">Price / m² (auto)</Label>
          <Input
            id="price_per_sqm"
            name="price_per_sqm_display"
            type="text"
            readOnly
            value={pricePerSqm ? `€ ${pricePerSqm}` : ""}
            placeholder="Calculated"
            className="bg-muted text-muted-foreground cursor-default"
          />
        </div>
      </div>

      {/* ABEX reference period */}
      <div className="space-y-2">
        <Label>ABEX reference period</Label>
        <div className="flex gap-3">
          <Select name="abex_year">
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              {ABEX_YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select name="abex_semester">
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Semester" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">S1 (Jan–Jun)</SelectItem>
              <SelectItem value="2">S2 (Jul–Dec)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          The ABEX period when the expert price was established.
        </p>
      </div>

      {/* Expert notes */}
      <div className="space-y-2">
        <Label htmlFor="expert_notes">Expert notes</Label>
        <Textarea
          id="expert_notes"
          name="expert_notes"
          rows={4}
          placeholder="Original expert description, observations, special features…"
        />
      </div>

      <SubmitButton disabled={!file} />
    </form>
  );
}
