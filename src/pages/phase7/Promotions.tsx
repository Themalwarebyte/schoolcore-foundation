import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowUpRight, Check } from "lucide-react";

type PreviewLine = {
  studentId: string;
  name: string;
  admissionNumber: string;
  fromEnrollmentId: string;
  fromClassSectionId: string;
  fromClassLabel: string;
  suggestedToClassSectionId: string | null;
  outcome: string;
};

const OUTCOME_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  promoted: "default",
  repeated: "secondary",
  transferred: "outline",
  graduated: "secondary",
};

export default function Promotions() {
  const [fromYearId, setFromYearId] = useState("");
  const [classSectionId, setClassSectionId] = useState("");
  const [toYearId, setToYearId] = useState("");
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const years = useQuery(api.academics.listYears, {});
  const sections = useQuery(api.academics.listClassSections,
    fromYearId ? { academicYearId: fromYearId as never } : "skip");
  const targetSections = useQuery(api.academics.listClassSections,
    toYearId ? { academicYearId: toYearId as never } : "skip");
  const preview = useQuery(api.phase7.promotions.previewPromotion,
    fromYearId && classSectionId ? { fromYearId: fromYearId as never, classSectionId: classSectionId as never } : "skip");
  const runs = useQuery(api.phase7.promotions.listRuns, {});

  const confirmPromotion = useMutation(api.phase7.promotions.confirmPromotion);

  const previewLines: PreviewLine[] = preview?.lines ?? [];

  return (
    <>
      <PageHeader
        title="Promotions"
        description="End-of-year promotion wizard. Confirms create NEW enrollments in the target year — historical enrollments are never modified."
      />

      <div className="p-4 sm:p-6 space-y-4">
        <Card className="card-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">1. Select academic year & class</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">From academic year</p>
              <Select value={fromYearId} onValueChange={(v) => { setFromYearId(v); setClassSectionId(""); setToYearId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {(years ?? []).map((y) => <SelectItem key={y._id} value={y._id}>{y.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Class</p>
              <Select value={classSectionId} onValueChange={setClassSectionId}>
                <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {(sections ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>{c.gradeName} {c.streamName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">To academic year</p>
              <Select value={toYearId} onValueChange={setToYearId}>
                <SelectTrigger><SelectValue placeholder="Select target year" /></SelectTrigger>
                <SelectContent>
                  {(years ?? []).filter((y) => y._id !== fromYearId).map((y) => (
                    <SelectItem key={y._id} value={y._id}>{y.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {preview !== undefined && previewLines.length > 0 && (
          <Card className="card-soft">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                2. Preview — {previewLines.length} student(s)
                {preview.isFinalGrade && (
                  <Badge variant="secondary" className="ml-2">final grade → graduate</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DataTable
                columns={[
                  { key: "student", header: "Student" },
                  { key: "from", header: "From" },
                  { key: "outcome", header: "Outcome" },
                  { key: "to", header: "To class" },
                ]}
                rows={previewLines.map((l, i) => ({
                  _id: `${l.studentId}-${i}`,
                  student: (
                    <div>
                      <p className="font-medium">{l.name}</p>
                      <p className="text-xs text-muted-foreground">{l.admissionNumber}</p>
                    </div>
                  ),
                  from: l.fromClassLabel,
                  outcome: (
                    <Select
                      value={l.outcome}
                      onValueChange={(v) => setLines((prev) => {
                        const base = prev.length ? prev : previewLines;
                        return base.map((p) => p.studentId === l.studentId ? { ...p, outcome: v } : p);
                      })}
                    >
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="promoted">Promoted</SelectItem>
                        <SelectItem value="repeated">Repeated</SelectItem>
                        <SelectItem value="transferred">Transferred</SelectItem>
                        <SelectItem value="graduated">Graduated</SelectItem>
                      </SelectContent>
                    </Select>
                  ),
                  to: <span className="text-muted-foreground text-xs">chosen at confirm</span>,
                }))}
                loading={false}
                empty={null}
                page={0}
                pageSize={100}
                onPageChange={() => undefined}
                hasNextPage={false}
              />
              <div className="flex justify-end">
                <Button onClick={() => setConfirmOpen(true)}>
                  <ArrowUpRight className="size-4" /> Continue to confirm
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="card-soft">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Promotion history</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { key: "run", header: "Run" },
                { key: "period", header: "Period" },
                { key: "students", header: "Students" },
                { key: "breakdown", header: "Outcomes" },
                { key: "status", header: "Status" },
              ]}
              rows={(runs ?? []).map((r) => ({
                _id: r._id,
                run: <span className="font-mono text-xs">{r.runNumber}</span>,
                period: `${r.fromYear} → ${r.toYear}`,
                students: r.totalStudents,
                breakdown: (
                  <span className="text-xs text-muted-foreground">
                    ↑{r.promoted} · ↻{r.repeated} · ⇄{r.transferred} · ∎{r.graduated}
                  </span>
                ),
                status: <Badge variant={r.status === "confirmed" ? "default" : "secondary"}>{r.status}</Badge>,
              }))}
              loading={runs === undefined}
              empty={<><p className="text-sm font-medium">No promotion runs yet</p><p className="text-xs text-muted-foreground">Completed runs appear here with their outcome breakdown.</p></>}
              page={0}
              pageSize={10}
              onPageChange={() => undefined}
              hasNextPage={false}
            />
          </CardContent>
        </Card>
      </div>

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirm promotion</DialogTitle>
            <DialogDescription>
              Pick each student's destination class in the target year, then confirm. New enrollments are created; the old year's enrollment history stays untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Target academic year</p>
              <Select value={toYearId} onValueChange={setToYearId}>
                <SelectTrigger><SelectValue placeholder="Select target year" /></SelectTrigger>
                <SelectContent>
                  {(years ?? []).filter((y) => y._id !== fromYearId).map((y) => (
                    <SelectItem key={y._id} value={y._id}>{y.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(() => {
              const effective = lines.length ? lines : previewLines;
              return effective.map((l) => (
                <div key={l.studentId} className="grid grid-cols-3 items-center gap-2 rounded-md border border-border/60 p-2">
                  <div className="col-span-1">
                    <p className="text-sm font-medium">{l.name}</p>
                    <p className="text-[10px] text-muted-foreground">{l.outcome}</p>
                  </div>
                  <div className="col-span-2">
                    {l.outcome === "promoted" || l.outcome === "transferred" ? (
                      <Select
                        value={l.suggestedToClassSectionId ?? undefined}
                        onValueChange={(v) => setLines((prev) => {
                          const base = prev.length ? prev : previewLines;
                          return base.map((p) => p.studentId === l.studentId ? { ...p, suggestedToClassSectionId: v } : p);
                        })}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder="Destination class" /></SelectTrigger>
                        <SelectContent>
                          {(targetSections ?? []).map((c) => (
                            <SelectItem key={c._id} value={c._id}>{c.gradeName} {c.streamName}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {l.outcome === "graduated" ? "No new enrollment (status → graduated)" : "Repeats in the same class"}
                      </p>
                    )}
                  </div>
                </div>
              ));
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Back</Button>
            <Button
              disabled={!toYearId}
              onClick={async () => {
                const effective = lines.length ? lines : previewLines;
                try {
                  const res = await confirmPromotion({
                    fromYearId: fromYearId as never,
                    toYearId: toYearId as never,
                    lines: effective.map((l) => ({
                      studentId: l.studentId as never,
                      fromEnrollmentId: l.fromEnrollmentId as never,
                      fromClassSectionId: l.fromClassSectionId as never,
                      outcome: l.outcome,
                      toClassSectionId:
                        (l.outcome === "promoted" || l.outcome === "transferred") && l.suggestedToClassSectionId
                          ? l.suggestedToClassSectionId as never
                          : undefined,
                    })),
                  });
                  toast.success(`Promotion confirmed — ${res.appliedCount} new enrollment(s)`);
                  setConfirmOpen(false); setLines([]); setClassSectionId(""); setToYearId("");
                } catch (e) { toast.error(friendlyError(e)); }
              }}
            >
              <Check className="size-4" /> Confirm promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Convert backend failures into user-friendly toast text. */
function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.match(/Uncaught ConvexError: (.+?)(?:\n|$)/);
  const core = (m ? m[1] : raw)
    .replace(/^\[Request ID: [^\]]+\]\s*/, "")
    .replace(/\s+at .*/g, "")
    .trim();
  return core.length > 0 ? core.slice(0, 180) : "Something went wrong. Please try again.";
}
