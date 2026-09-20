import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
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
import { Plus, Archive, ArchiveRestore, Pencil } from "lucide-react";

interface Grade {
  _id: string;
  name: string;
  shortName?: string;
  displayOrder: number;
  status: string;
}

export default function Grades() {
  const grades = useQuery(api.academics.listGradeLevels);
  const create = useMutation(api.academics.createGradeLevel);
  const update = useMutation(api.academics.updateGradeLevel);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Grade | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", shortName: "", displayOrder: 1 });
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", shortName: "", displayOrder: (grades?.length ?? 0) + 1 });
    setOpen(true);
  };
  const openEdit = (g: Grade) => {
    setEditing(g);
    setForm({ name: g.name, shortName: g.shortName ?? "", displayOrder: g.displayOrder });
    setOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await update({
          gradeLevelId: editing._id as never,
          name: form.name,
          shortName: form.shortName || undefined,
          displayOrder: Number(form.displayOrder),
          status: editing.status,
        });
        toast.success("Grade level updated");
      } else {
        await create({
          name: form.name,
          shortName: form.shortName || undefined,
          displayOrder: Number(form.displayOrder),
        });
        toast.success("Grade level created");
      }
      setOpen(false);
    } catch (err) {
      toast.error("Unable to save the grade level.", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Grade Levels"
        description="Configurable class levels — Grade 7, Form 1, Year 8… your school decides."
        actions={
          <Can permission="academics.manage">
            <Button onClick={openCreate}><Plus className="size-4" /> New grade level</Button>
          </Can>
        }
      />
      <Card className="card-soft">
        <CardHeader><CardTitle className="text-base">All grade levels</CardTitle></CardHeader>
        <CardContent>
          {grades === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : grades.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No grade levels yet. Add the levels your school uses.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Short name</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {grades.map((g) => (
                  <TableRow key={g._id}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell>{g.shortName ?? "—"}</TableCell>
                    <TableCell>{g.displayOrder}</TableCell>
                    <TableCell><StatusBadge status={g.status} /></TableCell>
                    <TableCell>
                      <Can permission="academics.manage">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(g)} aria-label="Edit">
                            <Pencil className="size-4" />
                          </Button>
                          {g.status === "active" ? (
                            <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setArchiveId(g._id)} aria-label="Archive">
                              <Archive className="size-4" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost" size="icon" className="size-8"
                              aria-label="Restore"
                              onClick={async () => {
                                try {
                                  await update({
                                    gradeLevelId: g._id as never,
                                    name: g.name,
                                    shortName: g.shortName,
                                    displayOrder: g.displayOrder,
                                    status: "active",
                                  });
                                  toast.success("Grade level restored");
                                } catch (err) {
                                  toast.error("Unable to restore.", { description: err instanceof Error ? err.message : undefined });
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
            <DialogTitle>{editing ? "Edit grade level" : "New grade level"}</DialogTitle>
            <DialogDescription>Short name is used in compact views, e.g. G7.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Grade 7" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Short name</Label>
                <Input value={form.shortName} onChange={(e) => setForm((f) => ({ ...f, shortName: e.target.value }))} placeholder="G7" />
              </div>
              <div className="grid gap-1.5">
                <Label>Display order</Label>
                <Input type="number" value={form.displayOrder} onChange={(e) => setForm((f) => ({ ...f, displayOrder: Number(e.target.value) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name}>{saving ? "Saving…" : editing ? "Save changes" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveId} onOpenChange={(v) => !v && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this grade level?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing classes and enrollments keep their references; the level is hidden from new setup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!archiveId) return;
                try {
                  const g = grades?.find((x) => x._id === archiveId);
                  await update({
                    gradeLevelId: archiveId as never,
                    name: g?.name ?? "Grade",
                    shortName: g?.shortName,
                    displayOrder: g?.displayOrder ?? 1,
                    status: "archived",
                  });
                  toast.success("Grade level archived");
                } catch (err) {
                  toast.error("Unable to archive.", { description: err instanceof Error ? err.message : undefined });
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
