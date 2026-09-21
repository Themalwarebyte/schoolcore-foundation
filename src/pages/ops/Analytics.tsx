import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClassSelect, ScopeBar, SubjectSelect, TermSelect, YearSelect } from "@/components/ops/Controls";
import { cn } from "@/lib/utils";

type Analytics = {
  overallAverage: number | null;
  resultCount: number;
  classAverages: { id: string; label: string; average: number | null; students: number }[];
  subjectAverages: { id: string; name: string; average: number | null }[];
  gradeDistribution: { grade: string; count: number }[];
  assessmentStats: { id: string; title: string; average: number | null; completion: number }[];
};

export default function Analytics() {
  const [yearId, setYearId] = useState("");
  const [termId, setTermId] = useState("");
  const [classSectionId, setClassSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  // Default the term selector to the school's current term.
  const actx = useQuery(api.academics.academicContext, {});
  const effectiveTermId = termId || actx?.currentTerm?._id || "";

  const data = useQuery(api.academicOps.analytics, {
    termId: (effectiveTermId || undefined) as never,
    classSectionId: (classSectionId && classSectionId !== "all" ? classSectionId : undefined) as never,
    subjectId: (subjectId && subjectId !== "all" ? subjectId : undefined) as never,
  }) as Analytics | null | undefined;

  return (
    <div className="page-shell">
      <PageHeader
        title="Academic Analytics"
        description="Performance across classes, subjects and assessments for the selected term."
      />

      <ScopeBar>
        <YearSelect yearId={yearId} onChange={(v) => { setYearId(v); setTermId(""); }} />
        <TermSelect yearId={yearId} termId={effectiveTermId} onChange={setTermId} />
        <ClassSelect yearId={yearId} classSectionId={classSectionId} onChange={setClassSectionId} allowAll />
        <SubjectSelect
          yearId={yearId}
          classSectionId={classSectionId !== "all" ? classSectionId : ""}
          subjectId={subjectId}
          onChange={setSubjectId}
          allowAll
        />
      </ScopeBar>

      {data === undefined ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : data === null ? (
        <Card className="card-soft">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No term is configured for this school yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Overall average" value={data.overallAverage != null ? `${data.overallAverage}%` : "—"} />
            <Stat label="Results included" value={String(data.resultCount)} />
            <Stat
              label="Classes covered"
              value={String(data.classAverages.length)}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card className="card-soft">
              <CardHeader>
                <CardTitle className="text-base">Class averages</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.classAverages.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No results yet.</p>
                ) : (
                  data.classAverages.map((c) => (
                    <div key={c.id}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{c.label}</span>
                        <span className={cn(
                          "tabular-nums",
                          c.average != null && c.average < 50 ? "text-red-600" : "",
                        )}>
                          {c.average != null ? `${c.average}%` : "—"}
                          <span className="ml-2 text-xs text-muted-foreground">{c.students} students</span>
                        </span>
                      </div>
                      <Progress value={c.average ?? 0} className="h-2" />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="card-soft">
              <CardHeader>
                <CardTitle className="text-base">Subject averages</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.subjectAverages.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No results yet.</p>
                ) : (
                  data.subjectAverages.map((s) => (
                    <div key={s.id}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium">{s.name}</span>
                        <span className={cn(
                          "tabular-nums",
                          s.average != null && s.average < 50 ? "text-red-600" : "",
                        )}>
                          {s.average != null ? `${s.average}%` : "—"}
                        </span>
                      </div>
                      <Progress value={s.average ?? 0} className="h-2" />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {data.gradeDistribution.length > 0 && (
            <Card className="card-soft mt-4">
              <CardHeader>
                <CardTitle className="text-base">Grade distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {data.gradeDistribution.map((g) => (
                    <span key={g.grade} className="rounded-full border px-3 py-1.5 text-sm">
                      {g.grade} <span className="ml-1 font-semibold tabular-nums">{g.count}</span>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data.assessmentStats.length > 0 && (
            <Card className="card-soft mt-4">
              <CardHeader>
                <CardTitle className="text-base">Assessment statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Assessment</TableHead>
                      <TableHead>Average %</TableHead>
                      <TableHead>Mark entry completion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.assessmentStats.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.title}</TableCell>
                        <TableCell className="tabular-nums">{a.average != null ? `${a.average}%` : "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={a.completion} className="h-1.5 w-28" />
                            <span className="text-xs text-muted-foreground">{a.completion}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
