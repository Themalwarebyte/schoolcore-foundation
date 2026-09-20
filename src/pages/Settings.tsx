import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/school-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Check, Save } from "lucide-react";

const COUNTRIES = ["Kenya", "Uganda", "Tanzania", "Rwanda", "Nigeria", "United States", "United Kingdom"];
const TIMEZONES = ["Africa/Nairobi", "Africa/Kampala", "Africa/Dar_es_Salaam", "Africa/Lagos", "UTC", "America/New_York"];

export default function Settings() {
  const settings = useQuery(api.schools.getSettings);
  const saveMutation = useMutation(api.schools.updateSettings);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings && !dirty) {
      setForm({
        name: settings.school.name ?? "",
        code: settings.school.code ?? "",
        phone: settings.school.phone ?? "",
        email: settings.school.email ?? "",
        website: settings.school.website ?? "",
        address: settings.school.address ?? "",
        city: settings.school.city ?? "",
        country: settings.school.country ?? "",
        curriculum: settings.school.curriculum ?? "",
        timezone: settings.school.timezone ?? "Africa/Nairobi",
        logoUrl: settings.school.logoUrl ?? "",
        currentAcademicYearId: settings.currentAcademicYearId ?? "",
        currentTermId: settings.currentTermId ?? "",
      });
    }
  }, [settings, dirty]);

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveMutation({ ...form } as never);
      toast.success("Settings saved");
      setDirty(false);
    } catch (e) {
      toast.error("Unable to save settings.", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="page-shell space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const inputCls = "max-w-lg";

  return (
    <div className="page-shell max-w-3xl">
      <PageHeader
        title="School settings"
        description="Configure your school's profile, academic context and localization."
        actions={
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {dirty ? <Save className="size-4" /> : <Check className="size-4" />}
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>General</CardTitle><CardDescription>School identity and contact details.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>School name</Label>
              <Input className={inputCls} value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>School code</Label>
              <Input className={`${inputCls} w-48`} value={form.code ?? ""} onChange={(e) => set("code", e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Phone</Label>
                <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Website</Label>
              <Input className={inputCls} value={form.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Address</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Physical address</Label>
              <Input className={inputCls} value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>City / County</Label>
                <Input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Country</Label>
                <Select value={form.country ?? ""} onValueChange={(v) => set("country", v)}>
                  <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Academic</CardTitle><CardDescription>Curriculum and the active academic context.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Curriculum</Label>
              <Input className={inputCls} value={form.curriculum ?? ""} onChange={(e) => set("curriculum", e.target.value)} placeholder="e.g. CBC, IGCSE, IB" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Current academic year</Label>
                <Select value={form.currentAcademicYearId ?? ""} onValueChange={(v) => set("currentAcademicYearId", v)}>
                  <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>
                    {(settings.academicYears ?? []).map((y) => (
                      <SelectItem key={y._id} value={y._id}>{y.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Current term</Label>
                <Select value={form.currentTermId ?? ""} onValueChange={(v) => set("currentTermId", v)}>
                  <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>
                    {(settings.terms ?? []).map((t) => (
                      <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Localization</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Timezone</Label>
                <Select value={form.timezone ?? ""} onValueChange={(v) => set("timezone", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Default language</Label>
                <Select value="en" onValueChange={() => undefined}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="en">English</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Branding</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Logo URL</Label>
              <Input className={inputCls} value={form.logoUrl ?? ""} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…" />
            </div>
            {form.logoUrl ? (
              <img src={form.logoUrl} alt="School logo preview" className="h-16 w-16 rounded-xl border object-cover" />
            ) : null}
          </CardContent>
        </Card>

        <Separator />
        <p className="text-xs text-muted-foreground">
          Changes to settings, including the current academic year and term, are recorded in the audit log.
        </p>
      </div>
    </div>
  );
}
