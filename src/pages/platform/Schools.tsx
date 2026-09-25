import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/platform-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, MoreHorizontal, Power } from "lucide-react";
import { roleLabel, type SessionRole } from "@/hooks/use-session";

const PAGE_SIZE = 15;

export default function PlatformSchools() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const schools = useQuery(api.schools.listSchools, { search: search || undefined });

  const setStatus = useMutation(api.schools.updateSchoolStatus);

  const rows = schools?.map((s) => ({
    _id: s._id,
    name: (
      <div>
        <p className="text-sm font-medium">{s.name}</p>
        <p className="text-xs text-muted-foreground">{s.code} · {s.slug}</p>
      </div>
    ),
    county: s.county ?? <span className="text-muted-foreground">—</span>,
    country: s.country ?? <span className="text-muted-foreground">—</span>,
    students: <span className="tabular-nums">{s.studentCount}</span>,
    staff: <span className="tabular-nums">{s.staffCount}</span>,
    users: <span className="tabular-nums">{s.userCount}</span>,
    status: (
      <Badge variant={s.status === "active" ? "default" : "destructive"} className="capitalize">
        {s.status}
      </Badge>
    ),
    actions: (
      <StatusActions schoolId={s._id} name={s.name} current={s.status} />
    ),
  }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Schools"
        description="Every school on the platform. Create schools and their first administrator here."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Create school</Button>}
      />

      <div className="mb-4 max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name or code…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <DataTable
        columns={[
          { key: "name", header: "School" },
          { key: "county", header: "County" },
          { key: "country", header: "Country" },
          { key: "students", header: "Students" },
          { key: "staff", header: "Staff" },
          { key: "users", header: "Users" },
          { key: "status", header: "Status" },
          { key: "actions", header: "", className: "w-10" },
        ]}
        rows={rows}
        loading={schools === undefined}
        empty={<><p className="text-sm font-medium">No schools yet</p><p className="text-xs text-muted-foreground">Create your first school to get started.</p></>}
        page={0}
        pageSize={PAGE_SIZE}
        onPageChange={() => undefined}
        hasNextPage={false}
      />

      <CreateSchoolDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function CreateSchoolDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const createSchool = useMutation(api.schools.createSchool);
  const provision = useAction(api.schools.provisionAdminAccount);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", code: "", phone: "", email: "", county: "", country: "Kenya",
    timezone: "Africa/Nairobi", curriculum: "Competency Based Curriculum (CBC)",
    adminName: "", adminEmail: "", adminPassword: "",
  });

  const handleCreate = async () => {
    setSaving(true);
    try {
      await createSchool({
        name: form.name,
        code: form.code,
        phone: form.phone || undefined,
        email: form.email || undefined,
        county: form.county || undefined,
        country: form.country || undefined,
        timezone: form.timezone || undefined,
        curriculum: form.curriculum || undefined,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
      });
      await provision({ email: form.adminEmail, password: form.adminPassword });
      toast.success("School created", {
        description: `${form.name} is ready. The administrator can sign in with ${form.adminEmail}.`,
      });
      onOpenChange(false);
      setForm({ name: "", code: "", phone: "", email: "", county: "", country: "Kenya", timezone: "Africa/Nairobi", curriculum: "Competency Based Curriculum (CBC)", adminName: "", adminEmail: "", adminPassword: "" });
    } catch (err) {
      toast.error("Unable to create the school.", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create school</DialogTitle>
          <DialogDescription>
            Creates the school plus its first School Admin account with a working password.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>School name *</Label>
            <Input value={form.name} onChange={set("name")} placeholder="Greenfield Academy" />
          </div>
          <div className="grid gap-1.5">
            <Label>School code *</Label>
            <Input value={form.code} onChange={set("code")} placeholder="GRN-001" />
          </div>
          <div className="grid gap-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={set("phone")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={set("email")} />
          </div>
          <div className="grid gap-1.5">
            <Label>County / Region</Label>
            <Input value={form.county} onChange={set("county")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Country</Label>
            <Input value={form.country} onChange={set("country")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Curriculum</Label>
            <Input value={form.curriculum} onChange={set("curriculum")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Timezone</Label>
            <Input value={form.timezone} onChange={set("timezone")} />
          </div>
          <div className="sm:col-span-2 mt-2 rounded-lg border bg-muted/30 p-3">
            <p className="mb-3 text-sm font-medium">First administrator</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Admin name *</Label>
                <Input value={form.adminName} onChange={set("adminName")} />
              </div>
              <div className="grid gap-1.5">
                <Label>Admin email *</Label>
                <Input type="email" value={form.adminEmail} onChange={set("adminEmail")} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Admin password *</Label>
                <Input type="password" value={form.adminPassword} onChange={set("adminPassword")} placeholder="Min 8 characters" />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleCreate}
            disabled={saving || !form.name || !form.code || !form.adminName || !form.adminEmail || form.adminPassword.length < 8}
          >
            {saving ? "Creating…" : "Create school"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Re-exported for potential reuse; keeps the role type import purposeful. */
export type { SessionRole };

function StatusActions({ schoolId, name, current }: { schoolId: string; name: string; current: string }) {
  const setStatus = useMutation(api.schools.updateSchoolStatus);
  const [confirming, setConfirming] = useState(false);
  const next = current === "active" ? "inactive" : "active";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setConfirming(true); }}>
            <Power className="mr-2 size-4" />
            {current === "active" ? "Deactivate school" : "Activate school"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{next === "inactive" ? "Deactivate" : "Activate"} {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {next === "inactive"
                ? "Users at this school can no longer sign in until it is reactivated."
                : "Users at this school regain access immediately."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                setStatus({ schoolId: schoolId as never, status: next as "active" | "inactive" })
                  .then(() => toast.success(next === "inactive" ? "School deactivated" : "School activated"))
                  .catch((e) => toast.error("Unable to change status.", { description: e instanceof Error ? e.message : undefined }))
              }
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
