import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/lib/status";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClassSelect, ScopeBar, SubjectSelect, TermSelect, YearSelect } from "@/components/ops/Controls";
import { ArrowLeft, CheckCircle2, RotateCcw, Send } from "lucide-react";

type OverviewRow = {
  classSectionId: string;
  classLabel: string;
  subjectId: string;
  subjectName: string;
  students: number;
  average: number;
  status: string;
};

export default function Results() {
  const [yearId, setYearId] = useState("");
  const [termId, setTermId] = useState("");
  const [classSectionId, setClassSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [sheet, setSheet] = useState<{ classSectionId: string; subjectId: string } | null>(null);

  // Default the term selector to the school's current term.
  const actx = useQuery(api.academics.academicContext, {});
  const effectiveTermId = termId || actx?.currentTerm?._id || "";

  const rows = useQuery(api.results.overview, { termId: (effectiveTermId || undefined) as never });

  if (sheet) {
    return (
      <SubjectSheet
        termId={termId}
        classSectionId={sheet.classSectionId}
        subjectId={sheet.subjectId}
        onBack={() => setSheet(null)}
      />
    );
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Results"
        description="Submission → approval → publication workflow for each class and subject."
      />

      <ScopeBar>
        <YearSelect yearId={yearId} onChange={(v) => { setYearId(v); setTermId(""); }} />
        <TermSelect yearId={yearId} termId={effectiveTermId} onChange={setTermId} />
        <ClassSelect yearId={yearId} classSectionId={classSectionId} onChange={setClassSectionId} allowAll />
        <SubjectSelect
          yearId={yearId}
          classSectionId={classSectionId}
          subjectId={subjectId}
          onChange={setSubjectId}
          allowAll
        />
      </ScopeBar>

      <Card className="card-soft">
        <CardHeader>
          <CardTitle className="text-base">Class × subject status</CardTitle>
        </CardHeader>
        <CardContent>
          {rows === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : (rows as OverviewRow[]).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No results submitted for this term yet. Submit marks from the Assessments page first.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Students</TableHead>
                  <TableHead>Average</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-64">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows as OverviewRow[])
                  .filter((r) => !classSectionId || classSectionId === "all" || r.classSectionId === classSectionId)
                  .filter((r) => !subjectId || subjectId === "all" || r.subjectId === subjectId)
                  .map((r) => (
                    <TableRow key={`${r.classSectionId}:${r.subjectId}`}>
                      <TableCell className="font-medium">{r.classLabel}</TableCell>
                      <TableCell>{r.subjectName}</TableCell>
                      <TableCell>{r.students}</TableCell>
                      <TableCell className="font-semibold">{r.average}%</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell>
                        <RowActions row={r} onOpenSheet={() => setSheet({ classSectionId: r.classSectionId, subjectId: r.subjectId })} />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RowActions({ row, onOpenSheet }: { row: OverviewRow; onOpenSheet: () => void }) {
  const approve = useMutation(api.results.approve);
  const publish = useMutation(api.results.publish);
  const reopen = useMutation(api.results.reopen);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      const res = (await fn()) as { count?: number };
      toast.success(ok + (res?.count ? ` (${res.count} students)` : ""));
    } catch (err) {
      toast.error("Action failed.", { description: friendlyError(err) });
    }
  };

  return (
    <div className="flex flex-wrap gap-1">
      <Button variant="outline" size="sm" onClick={onOpenSheet}>
        Sheet
      </Button>
      {(row.status === "submitted" || row.status === "reopened") && (
        <Button
          size="sm"
          onClick={() => run(
            () => approve({ termId: undefined as never, classSectionId: row.classSectionId as never, subjectId: row.subjectId as never }),
            "Results approved",
          )}
        >
          <CheckCircle2 className="size-3.5" /> Approve
        </Button>
      )}
      {row.status === "approved" && (
        <Button
          size="sm"
          onClick={() => run(
            () => publish({ termId: undefined as never, classSectionId: row.classSectionId as never }),
            "Results published",
          )}
        >
          <Send className="size-3.5" /> Publish
        </Button>
      )}
      {(row.status === "approved" || row.status === "published") && (
        <Button variant="outline" size="sm" onClick={() => setReopenOpen(true)}>
          <RotateCcw className="size-3.5" /> Reopen
        </Button>
      )}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reopen results</DialogTitle>
            <DialogDescription>
              Marks become editable again; a reason is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label>Reason *</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Marks for two students were keyed incorrectly." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)}>Cancel</Button>
            <Button
              disabled={!reason.trim()}
              onClick={async () => {
                await run(
                  () => reopen({
                    termId: undefined as never,
                    classSectionId: row.classSectionId as never,
                    subjectId: row.subjectId as never,
                    reason: reason.trim(),
                  }),
                  "Results reopened",
                );
                setReopenOpen(false);
              }}
            >
              Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* --------------------------- Subject sheet ---------------------------- */

type SheetRow = {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  totalScore: number;
  percentage: number;
  gradeLabel: string | null;
  status: string;
};

function SubjectSheet({
  termId, classSectionId, subjectId, onBack,
}: {
  termId: string; classSectionId: string; subjectId: string; onBack: () => void;
}) {
  const sheet = useQuery(
    api.results.sheet,
    termId
      ? { termId: termId as never, classSectionId: classSectionId as never, subjectId: subjectId as never }
      : "skip",
  );
  void termId;

  return (
    <div className="page-shell">
      <div className="mb-4 flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> All results
        </Button>
        <h2 className="font-semibold">Result sheet</h2>
      </div>

      <Card className="card-soft">
        <CardHeader>
          <CardTitle className="text-base">Students</CardTitle>
        </CardHeader>
        <CardContent>
          {sheet === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : (sheet?.rows ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No results for this selection.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Adm. no.</TableHead>
                  <TableHead>Score /100</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sheet!.rows as SheetRow[]).map((r) => (
                  <TableRow key={r.studentId}>
                    <TableCell className="font-medium">{r.fullName}</TableCell>
                    <TableCell>{r.admissionNumber}</TableCell>
                    <TableCell className="font-semibold tabular-nums">{r.percentage}</TableCell>
                    <TableCell>{r.gradeLabel ?? "—"}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {sheet && sheet.assessments.length > 0 && (
        <Card className="card-soft mt-4">
          <CardHeader>
            <CardTitle className="text-base">Contributing assessments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {sheet.assessments.map((a) => (
                <span key={a._id} className="rounded-full border px-3 py-1 text-xs">
                  {a.title} · max {a.maxMarks} · {a.weight}%
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
