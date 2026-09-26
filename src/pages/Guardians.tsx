import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "react-router";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
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

const RELATIONSHIPS = ["mother", "father", "guardian", "sibling", "grandparent", "aunt_uncle", "other"];

export default function Guardians() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // Debounce search without hooks-in-callback pitfalls.
  if (search !== debounced) {
    // Sets state during render only when input changed; schedules debounce.
    setTimeout(() => setDebounced(search), 300);
  }

  const guardians = useQuery(api.guardians.list, {
    search: debounced || undefined,
    paginationOpts: { numItems: PAGE_SIZE, cursor: page === 0 ? null : String(page) },
  });

  const createGuardian = useMutation(api.guardians.create);
  const [form, setForm] = useState({
    firstName: "", middleName: "", lastName: "", relationship: "guardian",
    phone: "", altPhone: "", email: "", occupation: "", address: "", nationalId: "",
  });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await createGuardian({
        firstName: form.firstName,
        middleName: form.middleName || undefined,
        lastName: form.lastName,
        relationship: form.relationship,
        phone: form.phone || undefined,
        altPhone: form.altPhone || undefined,
        email: form.email || undefined,
        occupation: form.occupation || undefined,
        address: form.address || undefined,
        nationalId: form.nationalId || undefined,
      });
      toast.success("Guardian added", { description: `${form.firstName} ${form.lastName} was created.` });
      setAddOpen(false);
      setForm({ firstName: "", middleName: "", lastName: "", relationship: "guardian", phone: "", altPhone: "", email: "", occupation: "", address: "", nationalId: "" });
    } catch (err) {
      toast.error("Unable to save the guardian.", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const rows = guardians?.page.map((g) => ({
    _id: g._id,
    name: (
      <div>
        <Link to={`/guardians/${g._id}`} className="text-sm font-medium hover:underline">
          {[g.firstName, g.middleName, g.lastName].filter(Boolean).join(" ")}
        </Link>
        <p className="text-xs text-muted-foreground">{g.relationship ?? "Guardian"}</p>
      </div>
    ),
    phone: g.phone ?? <span className="text-muted-foreground">—</span>,
    email: g.email ?? <span className="text-muted-foreground">—</span>,
    occupation: g.occupation ?? <span className="text-muted-foreground">—</span>,
    childrenCount: <span className="tabular-nums">{g.childrenCount}</span>,
    actions: null,
  }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Guardians"
        description="Parents and caregivers, shared safely between siblings."
        actions={
          <Can permission="guardians.create">
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add guardian
            </Button>
        </Can>
        }
      />

      <div className="mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <DataTable
        columns={[
          { key: "name", header: "Guardian" },
          { key: "phone", header: "Phone" },
          { key: "email", header: "Email" },
          { key: "occupation", header: "Occupation" },
          { key: "childrenCount", header: "Children" },
        ]}
        rows={rows}
        loading={guardians === undefined}
        empty={
          <>
            <p className="text-sm font-medium">No guardians found</p>
            <p className="text-xs text-muted-foreground">
              {search ? "Try a different search." : "Add a guardian, then link them to students."}
            </p>
          </>
        }
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        hasNextPage={(guardians?.page.length ?? 0) === PAGE_SIZE}
      />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add guardian</DialogTitle>
            <DialogDescription>
              If this person already exists (e.g. a sibling's guardian), search for them on the student page instead of creating a duplicate.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>First name *</Label>
              <Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Last name *</Label>
              <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Middle name</Label>
              <Input value={form.middleName} onChange={(e) => setForm((f) => ({ ...f, middleName: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Relationship</Label>
              <Select value={form.relationship} onValueChange={(v) => setForm((f) => ({ ...f, relationship: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIPS.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r.replace("_", " / ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+254…" />
            </div>
            <div className="grid gap-1.5">
              <Label>Alternative phone</Label>
              <Input value={form.altPhone} onChange={(e) => setForm((f) => ({ ...f, altPhone: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Occupation</Label>
              <Input value={form.occupation} onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Address</Label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>National ID / Passport</Label>
              <Input value={form.nationalId} onChange={(e) => setForm((f) => ({ ...f, nationalId: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.firstName || !form.lastName}>
              {saving ? "Saving…" : "Save guardian"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
