import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/lib/status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClassSelect, ScopeBar, TermSelect, YearSelect } from "@/components/ops/Controls";
import { Plus, Send } from "lucide-react";

type AssignmentRow = {
  _id: string;
  title: string;
  status: string;
  issueDate: string;
  dueDate: string;
  maxMarks?: number;
  isGraded: boolean;
  classLabel: string;
  subjectName: string;
  staffName: string;
};

export default function Assignments() {
  const [yearId, setYearId] = useState("");
  const [termId, setTermId] = useState("");
  const [classSectionId, setClassSectionId] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);

  const rows = useQuery(
    api.assignments.list,
    {
      termId: (termId || undefined) as never,
      classSectionId: (classSectionId || undefined) as never,
      status: status !== "all" ? status : undefined,
    },
  );

  return (
    <div className="page-shell">
      <PageHeader
        title="Assignments"
        description="Homework and take-home tasks issued to classes."
        actions={
          <Can permission="assignments.create">
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New assignment
            </Button>
          </Can>
        }
      />

      <ScopeBar>
        <YearSelect yearId={yearId} onChange={(v) => { setYearId(v); setTermId(""); }} />
        <TermSelect yearId={yearId} termId={termId} onChange={setTermId} />
        <ClassSelect yearId={yearId} classSectionId={classSectionId} onChange={setClassSectionId} allowAll />
        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="mt-1 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </ScopeBar>

      <Card className="card-soft">
        <CardHeader>
          <CardTitle className="text-base">Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {rows === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No assignments found for this scope.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Graded</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows as AssignmentRow[]).map((a) => (
                  <TableRow key={a._id}>
                    <TableCell className="font-medium">
                      {a.title}
                      {a.maxMarks ? (
                        <span className="block text-xs text-muted-foreground">max {a.maxMarks}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{a.classLabel}</TableCell>
                    <TableCell>{a.subjectName}</TableCell>
                    <TableCell>{a.staffName}</TableCell>
                    <TableCell>{a.dueDate}</TableCell>
                    <TableCell>{a.isGraded ? "Yes" : "No"}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell>
                      <RowActions id={a._id} status={a.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateDialog open={open} onOpenChange={setOpen} yearId={yearId} termId={termId} />
    </div>
  );
}

function RowActions({ id, status }: { id: string; status: string }) {
  const publish = useMutation(api.assignments.publish);
  const closeOrArchive = useMutation(api.assignments.closeOrArchive);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error("Action failed.", { description: friendlyError(err) });
    }
  };

  if (status === "draft") {
    return (
      <Button variant="outline" size="sm" onClick={() => act(() => publish({ assignmentId: id as never }), "Assignment published")}>
        <Send className="size-3.5" /> Publish
      </Button>
    );
  }
  if (status === "published") {
    return (
      <Button variant="outline" size="sm" onClick={() => act(() => closeOrArchive({ assignmentId: id as never, action: "close" }), "Assignment closed")}>
        Close
      </Button>
    );
  }
  if (status === "closed") {
    return (
      <Button variant="ghost" size="sm" onClick={() => act(() => closeOrArchive({ assignmentId: id as never, action: "archive" }), "Assignment archived")}>
        Archive
      </Button>
    );
  }
  return null;
}

function CreateDialog({
  open, onOpenChange, yearId, termId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; yearId: string; termId: string;
}) {
  const allocations = useQuery(
    api.assignments.myAllocationOptions,
    open ? { academicYearId: (yearId || undefined) as never } : "skip",
  );
  const create = useMutation(api.assignments.create);

  const [allocationId, setAllocationId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [maxMarks, setMaxMarks] = useState("");
  const [isGraded, setIsGraded] = useState(true);
  const [saving, setSaving] = useState(false);

  const chosen = (allocations ?? []).find((a) => a.allocationId === allocationId);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setTitle(""); setInstructions(""); setAllocationId(""); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New assignment</DialogTitle>
          <DialogDescription>
            Created as a draft — publish it when it is ready for the class.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Class &amp; subject (from your allocations) *</Label>
            <Select value={allocationId} onValueChange={setAllocationId}>
              <SelectTrigger><SelectValue placeholder="Select allocation" /></SelectTrigger>
              <SelectContent>
                {(allocations ?? []).map((a) => (
                  <SelectItem key={a.allocationId} value={a.allocationId}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!chosen && (
              <p className="text-xs text-muted-foreground">
                {allocations?.length
                  ? undefined
                  : "No active allocations for the selected year — ask an administrator."}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fractions problem set" />
          </div>
          <div className="grid gap-1.5">
            <Label>Instructions</Label>
            <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Issue date *</Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Due date *</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 items-end gap-3">
            <div className="grid gap-1.5">
              <Label>Max marks</Label>
              <Input type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} placeholder="e.g. 20" />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={isGraded} onCheckedChange={setIsGraded} id="graded" />
              <Label htmlFor="graded">Graded</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!allocationId || !title.trim() || saving}
            onClick={async () => {
              if (!chosen) return;
              setSaving(true);
              try {
                await create({
                  academicYearId: (yearId || undefined) as never,
                  termId: (termId || undefined) as never,
                  classSectionId: chosen.classSectionId as never,
                  subjectId: chosen.subjectId as never,
                  teacherAllocationId: chosen.allocationId as never,
                  title: title.trim(),
                  instructions: instructions.trim() || undefined,
                  issueDate,
                  dueDate,
                  maxMarks: maxMarks ? Number(maxMarks) : undefined,
                  isGraded,
                });
                toast.success("Assignment created as draft");
                onOpenChange(false);
              } catch (err) {
                toast.error("Unable to create assignment.", { description: friendlyError(err) });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
