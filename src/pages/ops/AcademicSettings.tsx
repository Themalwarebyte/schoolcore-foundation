import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const DAY_OPTIONS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

type Settings = {
  attendanceMode: string;
  schoolDays: string[];
  editableWindowDays: number;
  rankingEnabled: boolean;
  reportCardShowAttendance: boolean;
  reportCardShowSubjectComments: boolean;
  reportCardShowRank: boolean;
  reportCardSignatureLabels?: string;
  reportCardFooterText?: string;
  nextTermOpeningDate?: string | null;
};

export default function AcademicSettings() {
  const settings = useQuery(api.academicOps.getSettings, {}) as Settings | undefined;
  const save = useMutation(api.academicOps.saveSettings);

  const [form, setForm] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  // Derive the editable form from the server settings; once the user has edited
  // it (form !== null), server updates no longer overwrite local state.
  const [lastSynced, setLastSynced] = useState<object | null>(null);
  if (settings && form === null) {
    setForm(settings);
    setLastSynced(settings);
  }
  void lastSynced;

  if (!form) {
    return (
      <div className="page-shell">
        <PageHeader title="Academic Settings" description="Attendance, grading and report card behaviour." />
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch });
  const toggleDay = (d: string) =>
    set({
      schoolDays: form.schoolDays.includes(d)
        ? form.schoolDays.filter((x) => x !== d)
        : [...form.schoolDays, d],
    });

  return (
    <div className="page-shell max-w-3xl">
      <PageHeader
        title="Academic Settings"
        description="Attendance, grading and report card behaviour."
        actions={
          <Can permission="settings.manage">
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await save({
                    attendanceMode: form.attendanceMode,
                    schoolDays: form.schoolDays,
                    editableWindowDays: Number(form.editableWindowDays),
                    rankingEnabled: form.rankingEnabled,
                    reportCardShowAttendance: form.reportCardShowAttendance,
                    reportCardShowSubjectComments: form.reportCardShowSubjectComments,
                    reportCardShowRank: form.reportCardShowRank,
                    reportCardSignatureLabels: form.reportCardSignatureLabels || undefined,
                    reportCardFooterText: form.reportCardFooterText || undefined,
                    nextTermOpeningDate: form.nextTermOpeningDate || undefined,
                  });
                  toast.success("Academic settings saved");
                } catch (err) {
                  toast.error("Unable to save settings.", { description: friendlyError(err) });
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </Can>
        }
      />

      <Card className="card-soft">
        <CardHeader>
          <CardTitle className="text-base">Attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-xs gap-1.5">
            <Label>Attendance mode</Label>
            <Select value={form.attendanceMode} onValueChange={(v) => set({ attendanceMode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily (once per class per day)</SelectItem>
                <SelectItem value="lesson">Lesson (per subject lesson)</SelectItem>
                <SelectItem value="both">Both daily and lesson</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">School days</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDay(d.key)}
                  className={
                    form.schoolDays.includes(d.key)
                      ? "rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                      : "rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                  }
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid max-w-xs gap-1.5">
            <Label>Editable window (days after the date)</Label>
            <Input
              type="number" min={0} max={365}
              value={form.editableWindowDays}
              onChange={(e) => set({ editableWindowDays: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              Older sessions are locked; an administrator can reopen them.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="card-soft mt-4">
        <CardHeader>
          <CardTitle className="text-base">Grading &amp; report cards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            label="Class ranking"
            hint="Compute student rank within the class on report cards."
            checked={form.rankingEnabled}
            onChange={(v) => set({ rankingEnabled: v })}
          />
          <Toggle
            label="Show attendance on report cards"
            checked={form.reportCardShowAttendance}
            onChange={(v) => set({ reportCardShowAttendance: v })}
          />
          <Toggle
            label="Show subject comments"
            checked={form.reportCardShowSubjectComments}
            onChange={(v) => set({ reportCardShowSubjectComments: v })}
          />
          <Toggle
            label="Show rank"
            checked={form.reportCardShowRank}
            onChange={(v) => set({ reportCardShowRank: v })}
          />
          <div className="grid gap-1.5">
            <Label>Signature labels (pipe-separated)</Label>
            <Input
              value={form.reportCardSignatureLabels ?? ""}
              placeholder="Class Teacher | Principal"
              onChange={(e) => set({ reportCardSignatureLabels: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Report card footer text</Label>
            <Input
              value={form.reportCardFooterText ?? ""}
              placeholder="e.g. See you next term!"
              onChange={(e) => set({ reportCardFooterText: e.target.value })}
            />
          </div>
          <div className="grid max-w-xs gap-1.5">
            <Label>Next term opening date</Label>
            <Input
              type="date"
              value={form.nextTermOpeningDate ?? ""}
              onChange={(e) => set({ nextTermOpeningDate: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Toggle({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
