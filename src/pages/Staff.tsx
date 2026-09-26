import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "react-router";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Search } from "lucide-react";

const PAGE_SIZE = 15;

export default function Staff() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [addOpen, setAddOpen] = useState(false);

  const staff = useQuery(api.staff.list, {
    search: search || undefined,
    status,
    paginationOpts: { numItems: PAGE_SIZE, cursor: page === 0 ? null : String(page) },
  });

  const rows = staff?.page.map((s) => ({
    _id: s._id,
    name: (
      <div>
        <Link to={`/staff/${s._id}`} className="text-sm font-medium hover:underline">
          {[s.firstName, s.lastName].filter(Boolean).join(" ")}
        </Link>
        <p className="text-xs text-muted-foreground">{s.employeeNumber}</p>
      </div>
    ),
    jobTitle: s.jobTitle ?? <span className="text-muted-foreground">—</span>,
    department: s.department ?? <span className="text-muted-foreground">—</span>,
    email: s.email ?? <span className="text-muted-foreground">—</span>,
    phone: s.phone ?? <span className="text-muted-foreground">—</span>,
    employmentStatus: <StatusBadge status={s.employmentStatus} />,
    actions: null,
  }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Staff & Teachers"
        description="Employee records, teaching assignments and account links."
        actions={
          <Can permission="staff.create">
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add staff
            </Button>
          </Can>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, number or email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["active", "on_leave", "suspended", "terminated", "retired", "archived"].map((s) => (
              <SelectItem key={s} value={s}>{StatusBadgeLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={[
          { key: "name", header: "Name" },
          { key: "jobTitle", header: "Position" },
          { key: "department", header: "Department" },
          { key: "email", header: "Email" },
          { key: "phone", header: "Phone" },
          { key: "employmentStatus", header: "Status" },
        ]}
        rows={rows}
        loading={staff === undefined}
        empty={
          <>
            <p className="text-sm font-medium">No staff found</p>
            <p className="text-xs text-muted-foreground">
              {search ? "Try a different search." : "Add your first staff member to get started."}
            </p>
          </>
        }
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        hasNextPage={(staff?.page.length ?? 0) === PAGE_SIZE}
      />

      <AddStaffDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function StatusBadgeLabel(s: string): string {
  return {
    active: "Active", on_leave: "On Leave", suspended: "Suspended",
    terminated: "Terminated", retired: "Retired", archived: "Archived",
  }[s] ?? s;
}

function AddStaffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useMutation(api.staff.create);
  const provisionAccount = useAction(api.team.createUser);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employeeNumber: "", firstName: "", lastName: "", gender: "female",
    phone: "", email: "", jobTitle: "Teacher", department: "", employmentType: "permanent",
    employmentStatus: "active", hireDate: "", notes: "",
    createAccount: false, accountPassword: "",
  });

  const handleCreate = async () => {
    setSaving(true);
    try {
      const staffId = await create({
        employeeNumber: form.employeeNumber,
        firstName: form.firstName,
        lastName: form.lastName,
        gender: form.gender,
        phone: form.phone || undefined,
        email: form.email || undefined,
        jobTitle: form.jobTitle || undefined,
        department: form.department || undefined,
        employmentType: form.employmentType,
        employmentStatus: form.employmentStatus,
        hireDate: form.hireDate || undefined,
        notes: form.notes || undefined,
        createAccount: form.createAccount,
        accountPassword: form.accountPassword || undefined,
      });
      // Provision the password account via the action-based flow so the
      // linked login actually works.
      if (form.createAccount && form.email && form.accountPassword) {
        await provisionAccount({
          email: form.email,
          name: `${form.firstName} ${form.lastName}`.trim(),
          role: "teacher",
          password: form.accountPassword,
        });
      }
      toast.success("Staff member added");
      onOpenChange(false);
      void staffId;
    } catch (err) {
      toast.error("Unable to save the staff member.", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add staff member</DialogTitle>
          <DialogDescription>Employee details are central to academics and payroll later.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Employee number *</Label>
            <Input value={form.employeeNumber} onChange={set("employeeNumber")} placeholder="GF-101" />
          </div>
          <div className="grid gap-1.5">
            <Label>Hire date</Label>
            <Input type="date" value={form.hireDate} onChange={set("hireDate")} />
          </div>
          <div className="grid gap-1.5">
            <Label>First name *</Label>
            <Input value={form.firstName} onChange={set("firstName")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Last name *</Label>
            <Input value={form.lastName} onChange={set("lastName")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Gender</Label>
            <Select value={form.gender} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Job title</Label>
            <Input value={form.jobTitle} onChange={set("jobTitle")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Department</Label>
            <Input value={form.department} onChange={set("department")} placeholder="Mathematics" />
          </div>
          <div className="grid gap-1.5">
            <Label>Employment type</Label>
            <Select value={form.employmentType} onValueChange={(v) => setForm((f) => ({ ...f, employmentType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="permanent">Permanent</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
                <SelectItem value="part_time">Part-time</SelectItem>
                <SelectItem value="temporary">Temporary</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={set("phone")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={set("email")} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={form.createAccount}
                onChange={(e) => setForm((f) => ({ ...f, createAccount: e.target.checked }))}
              />
              Create a login account (Teacher role)
            </label>
            {form.createAccount && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Account password</Label>
                  <Input type="password" value={form.accountPassword} onChange={set("accountPassword")} placeholder="Min 8 characters" />
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !form.firstName || !form.lastName || !form.employeeNumber}>
            {saving ? "Saving…" : "Save staff member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
