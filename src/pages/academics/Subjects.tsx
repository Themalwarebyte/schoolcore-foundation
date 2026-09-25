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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";

interface Subject {
  _id: string;
  name: string;
  code: string;
  shortName?: string;
  subjectType?: string;
  status: string;
}

export default function Subjects() {
  const subjects = useQuery(api.academics.listSubjects);
  const create = useMutation(api.academics.createSubject);
  const update = useMutation(api.academics.updateSubject);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", shortName: "", subjectType: "core" });
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", code: "", shortName: "", subjectType: "core" });
    setOpen(true);
  };
  const openEdit = (s: Subject) => {
    setEditing(s);
    setForm({ name: s.name, code: s.code, shortName: s.shortName ?? "", subjectType: s.subjectType ?? "core" });
    setOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await update({
          subjectId: editing._id as never,
          name: form.name,
          code: form.code,
          shortName: form.shortName || undefined,
          subjectType: form.subjectType || undefined,
          status: editing.status,
        });
        toast.success("Subject updated");
      } else {
        await create({
          name: form.name,
          code: form.code,
          shortName: form.shortName || undefined,
          subjectType: form.subjectType || undefined,
        });
        toast.success("Subject created");
      }
      setOpen(false);
    } catch (err) {
      toast.error("Unable to save the subject.", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Subjects"
        description="Curriculum subjects offered at your school."
        actions={
          <Can permission="subjects.manage">
            <Button onClick={openCreate}><Plus className="size-4" /> New subject</Button>
          </Can>
        }
      />
      <Card className="card-soft">
        <CardHeader><CardTitle className="text-base">All subjects</CardTitle></CardHeader>
        <CardContent>
          {subjects === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : subjects.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No subjects yet. Add the subjects your curriculum requires.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjects.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell>
                      <p className="font-medium">{s.name}</p>
                      {s.shortName && <p className="text-xs text-muted-foreground">{s.shortName}</p>}
                    </TableCell>
                    <TableCell>{s.code}</TableCell>
                    <TableCell className="capitalize">{s.subjectType ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell>
                      <Can permission="subjects.manage">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(s)} aria-label="Edit">
                            <Pencil className="size-4" />
                          </Button>
                          {s.status === "active" ? (
                            <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setArchiveId(s._id)} aria-label="Archive">
                              <Archive className="size-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost" size="icon" className="size-8" aria-label="Restore"
                              onClick={async () => {
                                try {
                                  await update({
                                    subjectId: s._id as never,
                                    name: s.name, code: s.code,
                                    shortName: s.shortName, subjectType: s.subjectType,
                                    status: "active",
                                  });
                                  toast.success("Subject restored");
                                } catch (err) {
                                  toast.error("Unable to restore.", { description: friendlyError(err) });
                                }
                              }}
                            >
                              <ArchiveRestore className="size-4" />
                            </Button>
                          )}
                        </div>
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
            <DialogTitle>{editing ? "Edit subject" : "New subject"}</DialogTitle>
            <DialogDescription>Codes must be unique at your school (e.g. MAT).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Mathematics" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Code *</Label>
                <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="MAT" />
              </div>
              <div className="grid gap-1.5">
                <Label>Short name</Label>
                <Input value={form.shortName} onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select2 value={form.subjectType} onValueChange={(v) => setForm((f) => ({ ...f, subjectType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="core">Core</SelectItem>
                  <SelectItem value="elective">Elective</SelectItem>
                  <SelectItem value="practical">Practical</SelectItem>
                </SelectContent>
              </Select2>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.code}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create subject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveId} onOpenChange={(v) => !v && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this subject?</AlertDialogTitle>
            <AlertDialogDescription>Existing allocations and future results keep their references.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!archiveId) return;
                try {
                  const s = subjects?.find((x) => x._id === archiveId);
                  await update({
                    subjectId: archiveId as never,
                    name: s?.name ?? "Subject",
                    code: s?.code ?? "N/A",
                    shortName: s?.shortName,
                    subjectType: s?.subjectType,
                    status: "archived",
                  });
                  toast.success("Subject archived");
                } catch (err) {
                  toast.error("Unable to archive.", { description: friendlyError(err) });
                }
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Local alias to keep the import list tidy in this file.
import {
  Select as Select2, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
