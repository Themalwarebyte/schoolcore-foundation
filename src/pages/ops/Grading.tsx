import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";

type Band = {
  label: string;
  minPercent: number;
  maxPercent: number;
  descriptor?: string;
  points?: number;
  isPass?: boolean;
};

type Scheme = {
  _id: string;
  name: string;
  description?: string;
  bands: Band[];
};

const DEFAULT_BANDS: Band[] = [
  { label: "Exceeding Expectations", minPercent: 90, maxPercent: 100, isPass: true },
  { label: "Meeting Expectations", minPercent: 75, maxPercent: 89, isPass: true },
  { label: "Approaching Expectations", minPercent: 58, maxPercent: 74, isPass: true },
  { label: "Below Expectations", minPercent: 40, maxPercent: 57, isPass: false },
  { label: "Intervention Required", minPercent: 0, maxPercent: 39, isPass: false },
];

export default function Grading() {
  const schemes = useQuery(api.grading.listSchemes, {});
  const archive = useMutation(api.grading.archiveScheme);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <div className="page-shell">
      <PageHeader
        title="Grading Schemes"
        description="Performance bands used to convert percentages into grades."
        actions={
          <Can permission="grading.manage">
            <Button onClick={() => { setEditId(null); setOpen(true); }}>
              <Plus className="size-4" /> New scheme
            </Button>
          </Can>
        }
      />

      {schemes === undefined ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : schemes.length === 0 ? (
        <Card className="card-soft">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No grading schemes yet. Create one so results can display grade labels.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(schemes as Scheme[]).map((s) => (
            <Card key={s._id} className="card-soft">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  {s.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
                  )}
                </div>
                <Can permission="grading.manage">
                  <div className="flex gap-1">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => { setEditId(s._id); setOpen(true); }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="text-destructive"
                      onClick={async () => {
                        try {
                          await archive({ schemeId: s._id as never });
                          toast.success("Scheme archived");
                        } catch (err) {
                          toast.error("Unable to archive.", { description: err instanceof Error ? err.message : undefined });
                        }
                      }}
                    >
                      Archive
                    </Button>
                  </div>
                </Can>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {s.bands.map((b, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: bandColor(i, s.bands.length) }}
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{b.label}</p>
                        {b.descriptor && (
                          <p className="text-xs text-muted-foreground">{b.descriptor}</p>
                        )}
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {b.minPercent}–{b.maxPercent}%
                      </span>
                      <span className={b.isPass ? "text-xs text-emerald-600" : "text-xs text-red-600"}>
                        {b.isPass ? "Pass" : "Fail"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SchemeDialog
        open={open}
        onOpenChange={setOpen}
        editId={editId}
        schemes={schemes as Scheme[] | undefined}
      />
    </div>
  );
}

function bandColor(i: number, total: number): string {
  const palette = ["#16a34a", "#65a30d", "#ca8a04", "#ea580c", "#dc2626", "#7c3aed", "#2563eb"];
  const scale = Math.round((i / Math.max(total - 1, 1)) * (palette.length - 1));
  return palette[scale];
}

function SchemeDialog({
  open, onOpenChange, editId, schemes,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  editId: string | null; schemes?: Scheme[];
}) {
  const save = useMutation(api.grading.saveScheme);
  const existing = editId ? schemes?.find((s) => s._id === editId) : null;

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [bands, setBands] = useState<Band[]>(existing?.bands ?? DEFAULT_BANDS);
  const [loadedFor, setLoadedFor] = useState<string | null>(existing?._id ?? null);
  const [saving, setSaving] = useState(false);

  if (open && editId !== loadedFor) {
    setLoadedFor(editId);
    setName(existing?.name ?? "");
    setDescription(existing?.description ?? "");
    setBands(existing?.bands ?? DEFAULT_BANDS);
  }

  const updateBand = (i: number, patch: Partial<Band>) =>
    setBands((b) => b.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit scheme" : "New grading scheme"}</DialogTitle>
          <DialogDescription>
            Bands are validated for full 0–100 coverage without overlaps.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Scheme name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CBC Performance Bands" />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Performance bands</Label>
              <Button
                variant="outline" size="sm"
                onClick={() => setBands((b) => [...b, { label: "", minPercent: 0, maxPercent: 0, isPass: false }])}
              >
                <Plus className="size-3.5" /> Add band
              </Button>
            </div>
            {bands.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <Input
                  className="w-52" placeholder="Label" value={b.label}
                  onChange={(e) => updateBand(i, { label: e.target.value })}
                />
                <Input
                  type="number" className="w-20" min={0} max={100} placeholder="Min"
                  value={b.minPercent}
                  onChange={(e) => updateBand(i, { minPercent: Number(e.target.value) })}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="number" className="w-20" min={0} max={100} placeholder="Max"
                  value={b.maxPercent}
                  onChange={(e) => updateBand(i, { maxPercent: Number(e.target.value) })}
                />
                <Input
                  className="flex-1" placeholder="Descriptor (optional)" value={b.descriptor ?? ""}
                  onChange={(e) => updateBand(i, { descriptor: e.target.value })}
                />
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={b.isPass ?? false}
                    onCheckedChange={(v) => updateBand(i, { isPass: v === true })}
                  />
                  Pass
                </label>
                <Button
                  variant="ghost" size="icon" className="size-8 text-destructive"
                  onClick={() => setBands((arr) => arr.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!name.trim() || bands.length === 0 || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await save({
                  schemeId: (editId || undefined) as never,
                  name: name.trim(),
                  description: description.trim() || undefined,
                  bands: bands.map((b) => ({
                    label: b.label,
                    minPercent: b.minPercent,
                    maxPercent: b.maxPercent,
                    descriptor: b.descriptor || undefined,
                    isPass: b.isPass,
                  })),
                });
                toast.success("Scheme saved");
                onOpenChange(false);
              } catch (err) {
                toast.error("Unable to save scheme.", { description: err instanceof Error ? err.message : undefined });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save scheme"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
