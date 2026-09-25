import { useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
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
import { cn } from "@/lib/utils";
import { ArrowLeft, ClipboardList, Plus } from "lucide-react";

type AssessmentRow = {
  _id: string;
  title: string;
  status: string;
  assessmentDate: string;
  maxMarks: number;
  weight: number;
  countsTowardFinal: boolean;
  typeName: string;
  classLabel: string;
  classSectionId: string;
  subjectId: string;
  subjectName: string;
  marksEntered: number;
  absent: number;
  exempt: number;
  enrolledCount: number;
};

export default function Assessments() {
  const [yearId, setYearId] = useState("");
  const [termId, setTermId] = useState("");
  const [classSectionId, setClassSectionId] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [marksTarget, setMarksTarget] = useState<{ id: string; termId: string; classSectionId: string; subjectId: string } | null>(null);

  // Default the term selector to the school's current term.
  const ctx = useQuery(api.academics.academicContext, {});
  const effectiveTermId = termId || ctx?.currentTerm?._id || "";

  const rows = useQuery(
    api.assessments.list,
    {
      termId: (effectiveTermId || undefined) as never,
      classSectionId: (classSectionId || undefined) as never,
      status: status !== "all" ? status : undefined,
    },
  );

  if (marksTarget) {
    return (
      <MarksGrid
        assessmentId={marksTarget.id}
        termId={marksTarget.termId}
        classSectionId={marksTarget.classSectionId}
        subjectId={marksTarget.subjectId}
        onBack={() => setMarksTarget(null)}
      />
    );
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Assessments & Marks"
        description="Configure assessments, enter marks and submit for approval."
        actions={
          <Can permission="assessments.create">
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> New assessment
            </Button>
          </Can>
        }
      />

      <ScopeBar>
        <YearSelect yearId={yearId} onChange={(v) => { setYearId(v); setTermId(""); }} />
        <TermSelect yearId={yearId} termId={effectiveTermId} onChange={setTermId} />
        <ClassSelect yearId={yearId} classSectionId={classSectionId} onChange={setClassSectionId} allowAll />
        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="mt-1 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="marking">Marking</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="locked">Locked</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </ScopeBar>

      <Card className="card-soft">
        <CardHeader>
          <CardTitle className="text-base">Assessments</CardTitle>
        </CardHeader>
        <CardContent>
          {rows === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : (rows as AssessmentRow[]).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No assessments found for this scope.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assessment</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Marks</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead>Entry progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows as AssessmentRow[]).map((a) => {
                  const expected = Math.max(a.enrolledCount, a.marksEntered + a.absent + a.exempt);
                  const pct = expected > 0 ? Math.round(((a.marksEntered + a.absent + a.exempt) / expected) * 100) : 0;
                  return (
                    <TableRow key={a._id}>
                      <TableCell className="font-medium">
                        {a.title}
                        <span className="block text-xs text-muted-foreground">{a.typeName}</span>
                      </TableCell>
                      <TableCell>{a.classLabel}</TableCell>
                      <TableCell>{a.subjectName}</TableCell>
                      <TableCell>{a.assessmentDate}</TableCell>
                      <TableCell>/ {a.maxMarks}</TableCell>
                      <TableCell>{a.weight}%{a.countsTowardFinal ? "" : " (excl.)"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-1.5 w-20" />
                          <span className="text-xs text-muted-foreground">
                            {a.marksEntered + a.absent + a.exempt}/{a.enrolledCount}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell><StatusBadge status={a.status} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" onClick={() => setMarksTarget({ id: a._id, termId: effectiveTermId, classSectionId: a.classSectionId, subjectId: a.subjectId })}>
                            Marks
                          </Button>
                          <StatusActions id={a._id} status={a.status} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateDialog
        open={open}
        onOpenChange={setOpen}
        yearId={yearId}
        termId={termId}
      />
    </div>
  );
}

function StatusActions({ id, status }: { id: string; status: string }) {
  const setStatus = useMutation(api.assessments.setStatus);
  const act = async (next: string, ok: string) => {
    try {
      await setStatus({ assessmentId: id as never, status: next });
      toast.success(ok);
    } catch (err) {
      toast.error("Action failed.", { description: friendlyError(err) });
    }
  };
  if (status === "draft") {
    return (
      <Button variant="ghost" size="sm" title="Open for marking" onClick={() => act("open", "Assessment opened")}>
        Open
      </Button>
    );
  }
  if (status === "open") {
    return (
      <Button variant="ghost" size="sm" onClick={() => act("marking", "Marking in progress")}>
        Start marking
      </Button>
    );
  }
  return null;
}

/* ------------------------- Create dialog ----------------------------- */

function CreateDialog({
  open, onOpenChange, yearId, termId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  yearId: string; termId: string;
}) {
  const allocations = useQuery(
    api.assignments.myAllocationOptions,
    open ? { academicYearId: (yearId || undefined) as never } : "skip",
  );
  const types = useQuery(api.assessments.listTypes, open ? {} : "skip");
  const create = useMutation(api.assessments.create);

  const [allocationId, setAllocationId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [maxMarks, setMaxMarks] = useState("100");
  const [weight, setWeight] = useState("40");
  const [counts, setCounts] = useState(true);
  const [saving, setSaving] = useState(false);

  const chosen = (allocations ?? []).find((a) => a.allocationId === allocationId);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setTitle(""); setAllocationId(""); setTypeId(""); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New assessment</DialogTitle>
          <DialogDescription>
            Created in draft — open it when marking begins.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Class &amp; subject *</Label>
            <Select value={allocationId} onValueChange={setAllocationId}>
              <SelectTrigger><SelectValue placeholder="Select allocation" /></SelectTrigger>
              <SelectContent>
                {(allocations ?? []).map((a) => (
                  <SelectItem key={a.allocationId} value={a.allocationId}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Assessment type *</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {(types ?? []).map((t) => (
                    <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Date *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Opener Exam" />
          </div>
          <div className="grid grid-cols-3 items-end gap-3">
            <div className="grid gap-1.5">
              <Label>Max marks *</Label>
              <Input type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Weight % *</Label>
              <Input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Checkbox id="counts" checked={counts} onCheckedChange={(v) => setCounts(v === true)} />
              <Label htmlFor="counts">Counts toward final</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!allocationId || !typeId || !title.trim() || saving}
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
                  assessmentTypeId: typeId as never,
                  title: title.trim(),
                  assessmentDate: date,
                  maxMarks: Number(maxMarks),
                  weight: Number(weight),
                  countsTowardFinal: counts,
                });
                toast.success("Assessment created");
                onOpenChange(false);
              } catch (err) {
                toast.error("Unable to create assessment.", { description: friendlyError(err) });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Creating…" : "Create assessment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Marks grid ------------------------------ */

type GridRow = {
  studentId: string;
  enrollmentId: string;
  admissionNumber: string;
  fullName: string;
  score: number | null;
  markStatus: "entered" | "absent" | "exempt" | "missing";
  comment: string | null;
};

function MarksGrid({
  assessmentId, termId, classSectionId, subjectId, onBack,
}: {
  assessmentId: string; termId: string; classSectionId: string; subjectId: string; onBack: () => void;
}) {
  const grid = useQuery(api.marks.grid, { assessmentId: assessmentId as never });
  const saveGrid = useMutation(api.marks.saveGrid);
  const submit = useMutation(api.results.submit);

  const [scores, setScores] = useState<Record<string, string>>({});
  const [absents, setAbsents] = useState<Record<string, "absent" | "exempt">>({});
  const [seeded, setSeeded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editable = grid?.editable ?? false;

  const rows: GridRow[] = useMemo(() => grid?.rows ?? [], [grid]);
  const key = `${assessmentId}`;

  // Seed the local editing state once per assessment when the grid loads.
  // Derive-and-spread (instead of setState-in-useEffect) to avoid cascading renders.
  const [lastSeededKey, setLastSeededKey] = useState<string | null>(null);
  if (grid && lastSeededKey !== key) {
    const nextScores: Record<string, string> = {};
    const nextAbsents: Record<string, "absent" | "exempt"> = {};
    for (const r of rows) {
      if (r.markStatus === "entered" && r.score != null) nextScores[r.studentId] = String(r.score);
      if (r.markStatus === "absent" || r.markStatus === "exempt") nextAbsents[r.studentId] = r.markStatus;
    }
    setScores(nextScores);
    setAbsents(nextAbsents);
    setLastSeededKey(key);
    setSeeded(key);
  }

  const buildMarks = () =>
    rows
      .map((r) => {
        const isAbsent = absents[r.studentId];
        const raw = scores[r.studentId]?.trim();
        if (isAbsent) {
          return {
            studentId: r.studentId as never,
            enrollmentId: r.enrollmentId as never,
            status: isAbsent,
          };
        }
        if (raw !== undefined && raw !== "") {
          return {
            studentId: r.studentId as never,
            enrollmentId: r.enrollmentId as never,
            status: "entered",
            score: Number(raw),
          };
        }
        return null; // not yet filled — leave untouched
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

  const completeCount = rows.filter(
    (r) => absents[r.studentId] || (scores[r.studentId] ?? "") !== "",
  ).length;

  const doSave = async (asDraft: boolean) => {
    setSaving(true);
    try {
      const res = await saveGrid({ assessmentId: assessmentId as never, marks: buildMarks(), asDraft });
      toast.success(`Saved (${res.changed} changed)`);
      setSeeded(null);
    } catch (err) {
      toast.error("Unable to save marks.", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const doSubmit = async () => {
    const g = grid;
    if (!g) return;
    setSaving(true);
    try {
      await saveGrid({ assessmentId: assessmentId as never, marks: buildMarks(), asDraft: false });
      const r = await submit({
        termId: termId as never,
        classSectionId: classSectionId as never,
        subjectId: subjectId as never,
      });
      toast.success(`Results submitted for approval (${r.count} students)`);
      setSeeded(null);
    } catch (err) {
      toast.error("Unable to submit results.", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="mb-4 flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> All assessments
        </Button>
        {grid?.assessment && (
          <div>
            <h2 className="font-semibold leading-tight">{grid.assessment.title}</h2>
            <p className="text-xs text-muted-foreground">
              {grid.assessment.subjectName} · {grid.assessment.assessmentDate} · max {grid.assessment.maxMarks} · weight {grid.assessment.weight}%
            </p>
          </div>
        )}
        {grid && <StatusBadge status={grid.assessment.status} />}
      </div>

      <Card className="card-soft">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            Marks entry — {completeCount}/{rows.length} complete
          </CardTitle>
          {editable && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={saving} onClick={() => doSave(true)}>
                Save draft
              </Button>
              <Button size="sm" disabled={saving || completeCount !== rows.length || rows.length === 0} onClick={doSubmit}>
                <ClipboardList className="size-4" /> Save &amp; submit for approval
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {grid === undefined ? (
            <div className="h-64 animate-pulse rounded-lg bg-muted" />
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No students enrolled on the assessment date.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="w-28">Score</TableHead>
                  <TableHead className="w-40">Non-submission</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isAbsent = absents[r.studentId];
                  const raw = scores[r.studentId] ?? "";
                  const invalid =
                    !isAbsent && raw !== "" &&
                    (Number.isNaN(Number(raw)) || Number(raw) < 0 || Number(raw) > (grid?.assessment.maxMarks ?? 0));
                  return (
                    <TableRow key={r.studentId}>
                      <TableCell>
                        <p className="text-sm font-medium">{r.fullName}</p>
                        <p className="text-xs text-muted-foreground">{r.admissionNumber}</p>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={grid?.assessment.maxMarks}
                          className={cn("h-8", invalid && "border-destructive")}
                          value={isAbsent ? "" : raw}
                          disabled={!editable || !!isAbsent}
                          onChange={(e) =>
                            setScores((s) => ({ ...s, [r.studentId]: e.target.value }))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {(["absent", "exempt"] as const).map((k) => (
                            <button
                              key={k}
                              type="button"
                              disabled={!editable}
                              onClick={() =>
                                setAbsents((a) => {
                                  const next = { ...a };
                                  if (next[r.studentId] === k) delete next[r.studentId];
                                  else next[r.studentId] = k;
                                  return next;
                                })
                              }
                              className={cn(
                                "rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50",
                                isAbsent === k
                                  ? k === "absent"
                                    ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                                    : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                                  : "bg-muted/60 text-muted-foreground hover:bg-muted",
                              )}
                            >
                              {k}
                            </button>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          "text-xs capitalize",
                          isAbsent ? "text-muted-foreground" : invalid ? "text-destructive" : raw !== "" ? "text-emerald-600" : "text-muted-foreground",
                        )}>
                          {isAbsent ?? (invalid ? "invalid" : raw !== "" ? "entered" : r.markStatus)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {grid?.summary && (
            <p className="mt-3 text-xs text-muted-foreground">
              Completeness: {grid.summary.entered} entered ·{" "}
              {rows.length - completeCount} still missing. Submitting locks marks and creates submitted results for approval.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
