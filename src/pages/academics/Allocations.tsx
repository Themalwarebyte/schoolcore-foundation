import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/lib/status";
import { usePermissions } from "@/hooks/use-session";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
import { Link } from "react-router";
import { Plus, XCircle } from "lucide-react";

export default function Allocations() {
  const { can } = usePermissions();
  const years = useQuery(api.academics.listYears);
  const [yearId, setYearId] = useState("");
  const effectiveYear = yearId || years?.find((y) => y.isCurrent)?._id || "";
  const allocations = useQuery(
    api.allocations.list,
    effectiveYear ? { academicYearId: effectiveYear as never } : "skip",
  );

  const create = useMutation(api.allocations.create);
  const end = useMutation(api.allocations.end);
  const [open, setOpen] = useState(false);
  const [endId, setEndId] = useState<string | null>(null);

  return (
    <div className="page-shell">
      <PageHeader
        title="Teacher Allocations"
        description="Which teacher teaches which subject in which class."
        actions={
          <Can permission="teacher_allocations.manage">
            <Button onClick={() => setOpen(true)} disabled={!effectiveYear}>
              <Plus className="size-4" /> Assign teacher
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
        <CardHeader><CardTitle className="text-base">Allocations</CardTitle></CardHeader>
        <CardContent>
          {allocations === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : allocations.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No allocations for this year. Assign teachers to subjects and classes.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.map((a) => (
                  <TableRow key={a._id}>
                    <TableCell>
                      <Link to={`/staff/${a.staffId}`} className="font-medium hover:underline">
                        {a.staffName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.employeeNumber}</p>
                    </TableCell>
                    <TableCell>
                      {a.subjectName}
                      <span className="block text-xs text-muted-foreground">{a.subjectCode}</span>
                    </TableCell>
                    <TableCell>{a.classLabel}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell>
                      {a.status === "active" && can("teacher_allocations.manage") && (
                        <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setEndId(a._id)} aria-label="End allocation">
                          <XCircle className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AssignDialog
        open={open}
        onOpenChange={setOpen}
        yearId={effectiveYear}
        onSubmit={async (staffId, subjectId, classSectionId) => {
          await create({
            staffId: staffId as never,
            subjectId: subjectId as never,
            classSectionId: classSectionId as never,
            academicYearId: effectiveYear as never,
          });
        }}
      />

      <AlertDialog open={!!endId} onOpenChange={(v) => !v && setEndId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this allocation?</AlertDialogTitle>
            <AlertDialogDescription>
              The assignment is kept for history but marked archived. You can assign a new teacher afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!endId) return;
                try {
                  await end({ allocationId: endId as never });
                  toast.success("Allocation ended");
                } catch (err) {
                  toast.error("Unable to end allocation.", { description: err instanceof Error ? err.message : undefined });
                }
              }}
            >
              End allocation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AssignDialog({
  open, onOpenChange, yearId, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  yearId: string;
  onSubmit: (staffId: string, subjectId: string, classSectionId: string) => Promise<void>;
}) {
  const options = useQuery(api.allocations.options, open && yearId ? { academicYearId: yearId as never } : "skip");
  const [staffId, setStaffId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [classSectionId, setClassSectionId] = useState("");
  const [saving, setSaving] = useState(false);

  const grades = useQuery(api.academics.listGradeLevels, open ? {} : "skip");
  const gradeById = new Map((grades ?? []).map((g) => [g._id, g.name]));
  const sectionsWithLabels = (options?.classSections ?? []).map((c) => ({
    ...c,
    label: `${gradeById.get(c.gradeLevelId) ?? "?"} · section`,
  }));

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setStaffId(""); setSubjectId(""); setClassSectionId(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign teacher</DialogTitle>
          <DialogDescription>
            One teacher per subject per class per year — duplicates are prevented.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Teacher *</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger><SelectValue placeholder="Select teacher" /></SelectTrigger>
              <SelectContent>
                {options?.staff.map((s) => (
                  <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Subject *</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
              <SelectContent>
                {options?.subjects.map((s) => (
                  <SelectItem key={s._id} value={s._id}>{s.name} ({s.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Class section *</Label>
            <Select value={classSectionId} onValueChange={setClassSectionId}>
              <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>
                {sectionsWithLabels.map((c) => (
                  <SelectItem key={c._id} value={c._id}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!staffId || !subjectId || !classSectionId || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit(staffId, subjectId, classSectionId);
                toast.success("Teacher assigned");
                onOpenChange(false);
              } catch (err) {
                toast.error("Unable to assign teacher.", { description: err instanceof Error ? err.message : undefined });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
