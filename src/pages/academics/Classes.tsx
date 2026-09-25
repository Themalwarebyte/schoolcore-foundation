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
import { StatusBadge } from "@/lib/status";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil } from "lucide-react";

export default function Classes() {
  const years = useQuery(api.academics.listYears);
  const [yearId, setYearId] = useState("");
  const effectiveYear = yearId || years?.find((y) => y.isCurrent)?._id || "";
  const grades = useQuery(api.academics.listGradeLevels);
  const staff = useQuery(api.staff.list, {
    paginationOpts: { numItems: 200, cursor: null },
  });
  const sections = useQuery(
    api.academics.listClassSections,
    effectiveYear ? { academicYearId: effectiveYear as never } : "skip",
  );

  const create = useMutation(api.academics.createClassSection);
  const update = useMutation(api.academics.updateClassSection);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ _id: string; streamName: string; capacity?: number; classTeacherStaffId?: string | null; status: string } | null>(null);
  const [form, setForm] = useState({ gradeLevelId: "", streamName: "", capacity: "40", classTeacherStaffId: "none" });
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ gradeLevelId: "", streamName: "", capacity: "40", classTeacherStaffId: "none" });
    setOpen(true);
  };
  const openEdit = (s: { _id: string; streamName: string; capacity?: number; classTeacher: string | null; status: string }) => {
    setEditing(s);
    setForm({
      gradeLevelId: "",
      streamName: s.streamName,
      capacity: String(s.capacity ?? ""),
      classTeacherStaffId: "none",
    });
    void s.classTeacher;
    setOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const teacherId = form.classTeacherStaffId === "none" ? undefined : form.classTeacherStaffId;
      if (editing) {
        await update({
          classSectionId: editing._id as never,
          streamName: form.streamName,
          capacity: form.capacity ? Number(form.capacity) : undefined,
          classTeacherStaffId: teacherId as never,
          status: editing.status,
        });
        toast.success("Class updated");
      } else {
        await create({
          academicYearId: effectiveYear as never,
          gradeLevelId: form.gradeLevelId as never,
          streamName: form.streamName,
          capacity: form.capacity ? Number(form.capacity) : undefined,
          classTeacherStaffId: teacherId as never,
        });
        toast.success("Class created");
      }
      setOpen(false);
    } catch (err) {
      toast.error("Unable to save the class.", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Classes & Streams"
        description="Class sections per grade and academic year (e.g. Grade 7 Blue)."
        actions={
          <Can permission="academics.manage">
            <Button onClick={openCreate} disabled={!effectiveYear || (grades?.length ?? 0) === 0}>
              <Plus className="size-4" /> New class
            </Button>
          </Can>
        }
      />

      <div className="mb-4 max-w-xs">
        <Label>Academic year</Label>
        <Select value={effectiveYear} onValueChange={setYearId}>
          <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select year" /></SelectTrigger>
          <SelectContent>
            {years?.map((y) => (
              <SelectItem key={y._id} value={y._id}>{y.name}{y.isCurrent ? " (current)" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="card-soft">
        <CardHeader><CardTitle className="text-base">Sections</CardTitle></CardHeader>
        <CardContent>
          {sections === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : sections.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No classes for this year yet. Create grade levels first, then add sections.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Class teacher</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell>
                      <p className="font-medium">{s.gradeName} {s.streamName}</p>
                      <p className="text-xs text-muted-foreground">{s.yearName}</p>
                    </TableCell>
                    <TableCell>{s.classTeacher ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                    <TableCell className="tabular-nums">{s.enrolledCount}</TableCell>
                    <TableCell className="tabular-nums">{s.capacity ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell>
                      <Can permission="academics.manage">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(s)} aria-label="Edit">
                          <Pencil className="size-4" />
                        </Button>
                      </Can>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit class" : "New class section"}</DialogTitle>
            <DialogDescription>A class is a grade + stream within one academic year.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {!editing && (
              <div className="grid gap-1.5">
                <Label>Grade level *</Label>
                <Select value={form.gradeLevelId} onValueChange={(v) => setForm((f) => ({ ...f, gradeLevelId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select grade" /></SelectTrigger>
                  <SelectContent>
                    {grades?.filter((g) => g.status === "active").map((g) => (
                      <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>Stream name *</Label>
              <Input value={form.streamName} onChange={(e) => setForm((f) => ({ ...f, streamName: e.target.value }))} placeholder="Blue" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Capacity</Label>
                <Input type="number" value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Class teacher</Label>
                <Select value={form.classTeacherStaffId} onValueChange={(v) => setForm((f) => ({ ...f, classTeacherStaffId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {staff?.page.filter((s) => s.employmentStatus === "active").map((s) => (
                      <SelectItem key={s._id} value={s._id}>{s.firstName} {s.lastName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.streamName || (!editing && !form.gradeLevelId)}
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Create class"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
