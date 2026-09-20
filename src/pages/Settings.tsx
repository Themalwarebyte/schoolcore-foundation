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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Save } from "lucide-react";

const COUNTRIES = ["Kenya", "Uganda", "Tanzania", "Rwanda", "Nigeria", "United States", "United Kingdom"];
const TIMEZONES = ["Africa/Nairobi", "Africa/Kampala", "Africa/Dar_es_Salaam", "Africa/Lagos", "UTC", "America/New_York"];
const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
const LANGUAGES = ["English", "Kiswahili"];

export default function Settings() {
  const school = useQuery(api.schools.getMySchool);
  const years = useQuery(api.academics.listYears);
  const context = useQuery(api.academics.academicContext);

  const updateSchool = useMutation(api.schools.updateMySchool);
  const setCurrentYear = useMutation(api.academics.setCurrentYear);
  const setCurrentTerm = useMutation(api.academics.setCurrentTerm);

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", email: "", website: "", postalAddress: "", physicalAddress: "",
    county: "", country: "", timezone: "", dateFormat: "", language: "English",
    currency: "KES", curriculum: "",
  });

  useEffect(() => {
    if (school && !dirty) {
      setForm({
        name: school.name ?? "",
        phone: school.phone ?? "",
        email: school.email ?? "",
        website: school.website ?? "",
        postalAddress: school.postalAddress ?? "",
        physicalAddress: school.physicalAddress ?? "",
        county: school.county ?? "",
        country: school.country ?? "",
        timezone: school.timezone ?? "Africa/Nairobi",
        dateFormat: school.dateFormat ?? "DD/MM/YYYY",
        language: school.language ?? "English",
        currency: school.currency ?? "KES",
        curriculum: school.curriculum ?? "",
      });
    }
  }, [school, dirty]);

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSchool({ ...form });
      toast.success("Settings saved");
      setDirty(false);
    } catch (e) {
      toast.error("Unable to save settings.", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const terms = useQuery(
    api.academics.listTerms,
    context?.currentYear ? { academicYearId: context.currentYear._id } : "skip",
  );

  if (!school) {
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
            <Save className="size-4" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>General</CardTitle><CardDescription>School identity and contact details.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>School name</Label>
              <Input className={inputCls} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Website</Label>
              <Input className={inputCls} value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Address</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Postal address</Label>
                <Input value={form.postalAddress} onChange={(e) => set("postalAddress", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Physical address</Label>
                <Input value={form.physicalAddress} onChange={(e) => set("physicalAddress", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>County / Region</Label>
                <Input value={form.county} onChange={(e) => set("county", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Country</Label>
                <Select value={form.country} onValueChange={(v) => set("country", v)}>
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
          <CardHeader>
            <CardTitle>Academic</CardTitle>
            <CardDescription>
              Curriculum and the active academic context. Changing these updates the whole school.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Curriculum</Label>
              <Input className={inputCls} value={form.curriculum} onChange={(e) => set("curriculum", e.target.value)} placeholder="e.g. CBC, IGCSE, IB" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Current academic year</Label>
                <Select
                  value={context?.currentYear?._id ?? ""}
                  onValueChange={(v) =>
                    setCurrentYear({ yearId: v as never })
                      .then(() => toast.success("Current academic year updated"))
                      .catch((e) => toast.error("Unable to change year.", { description: e instanceof Error ? e.message : undefined }))
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>
                    {(years ?? []).filter((y) => y.status !== "archived").map((y) => (
                      <SelectItem key={y._id} value={y._id}>{y.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Current term</Label>
                <Select
                  value={context?.currentTerm?._id ?? ""}
                  onValueChange={(v) =>
                    setCurrentTerm({ termId: v as never })
                      .then(() => toast.success("Current term updated"))
                      .catch((e) => toast.error("Unable to change term.", { description: e instanceof Error ? e.message : undefined }))
                  }
                >
                  <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>
                    {(terms ?? []).map((t) => (
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
                <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Date format</Label>
                <Select value={form.dateFormat} onValueChange={(v) => set("dateFormat", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DATE_FORMATS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Default language</Label>
                <Select value={form.language} onValueChange={(v) => set("language", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Currency</Label>
                <Input value={form.currency} onChange={(e) => set("currency", e.target.value)} placeholder="KES" />
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Changes to settings and the academic context are recorded in the audit log.
        </p>
      </div>
    </div>
  );
}
