import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/lib/status";
import { usePermissions } from "@/hooks/use-session";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { downloadReportCardPdf, type ReportCardPdfData } from "@/lib/reportCardPdf";
import { ArrowLeft, Download, Printer } from "lucide-react";

type Card = {
  _id: string;
  status: string;
  attendance?: {
    present: number; absent: number; late: number; excused: number; percentage: number;
  } | null;
  overallAverage?: number;
  overallGrade?: string;
  rank?: number;
  classSize?: number;
  subjects: {
    subjectId: string;
    subjectName: string;
    totalScore: number;
    percentage: number;
    gradeLabel?: string;
    teacherComment?: string;
    components: { title: string; score?: number; maxMarks: number; weight: number; status: string }[];
  }[];
  classTeacherComment?: string;
  principalComment?: string;
  snapshotVersion: number;
};

export default function ReportCardView() {
  const { reportCardId } = useParams<{ reportCardId: string }>();
  const { can } = usePermissions();
  const data = useQuery(
    api.reportCards.get,
    reportCardId ? { reportCardId: reportCardId as never } : "skip",
  );
  const saveComments = useMutation(api.reportCards.saveComments);

  const [classComment, setClassComment] = useState<string | null>(null);
  const [principalComment, setPrincipalComment] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <div className="page-shell">
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  if (!data || !data.card) {
    return (
      <div className="page-shell">
        <p className="py-16 text-center text-sm text-muted-foreground">Report card not found.</p>
      </div>
    );
  }

  const card = data.card as Card;
  const canEditClass = can("report_cards.generate");
  const canEditPrincipal = can("report_cards.generate");
  const classCommentValue = classComment ?? card.classTeacherComment ?? "";
  const principalCommentValue = principalComment ?? card.principalComment ?? "";

  const save = async () => {
    try {
      await saveComments({
        reportCardId: card._id as never,
        classTeacherComment: canEditClass ? classCommentValue : undefined,
        principalComment: canEditPrincipal ? principalCommentValue : undefined,
      });
      toast.success("Comments saved");
    } catch (err) {
      toast.error("Unable to save comments.", { description: err instanceof Error ? err.message : undefined });
    }
  };

  return (
    <div className="page-shell max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="outline" size="sm">
          <Link to="/report-cards">
            <ArrowLeft className="size-4" /> Back to report cards
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <StatusBadge status={card.status} />
          <span className="text-xs text-muted-foreground">v{card.snapshotVersion}</span>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" /> Print
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadReportCardPdf(data as unknown as ReportCardPdfData)}
          >
            <Download className="size-4" /> Download PDF
          </Button>
        </div>
      </div>

      {/* Printable sheet */}
      <div className="rounded-xl border bg-card p-6 shadow-sm print:border-0 print:shadow-none">
        <header className="border-b pb-4 text-center">
          <h1 className="text-xl font-bold tracking-tight">{data.school.name}</h1>
          {data.school.address && (
            <p className="text-xs text-muted-foreground">{data.school.address}</p>
          )}
          <h2 className="mt-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Term Report Card — {data.termName} {data.yearName}
          </h2>
        </header>

        <section className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Info label="Student" value={data.student?.fullName ?? "—"} />
          <Info label="Admission no." value={data.student?.admissionNumber ?? "—"} />
          <Info label="Class" value={data.classLabel} />
          <Info label="Term end" value={data.termEndDate ?? "—"} />
        </section>

        {data.settings.showAttendance && card.attendance && (
          <section className="mt-4 rounded-lg border p-3 text-sm">
            <p className="mb-1 font-medium">Attendance</p>
            <p className="text-xs text-muted-foreground">
              Present {card.attendance.present} · Absent {card.attendance.absent} · Late{" "}
              {card.attendance.late} · Excused {card.attendance.excused} —{" "}
              <span className="font-semibold text-foreground">{card.attendance.percentage}%</span>
            </p>
          </section>
        )}

        <section className="mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5">Subject</th>
                <th className="py-1.5">Score</th>
                <th className="py-1.5">%</th>
                <th className="py-1.5">Grade</th>
                {data.settings.showSubjectComments && <th className="py-1.5">Teacher remark</th>}
              </tr>
            </thead>
            <tbody>
              {card.subjects.map((s) => (
                <tr key={s.subjectId} className="border-b last:border-0">
                  <td className="py-1.5 font-medium">{s.subjectName}</td>
                  <td className="py-1.5 tabular-nums">
                    {s.totalScore}
                    <span className="block text-[10px] text-muted-foreground">
                      {s.components.map((c) => `${c.title}: ${c.score ?? "—"}/${c.maxMarks}`).join(" · ")}
                    </span>
                  </td>
                  <td className="py-1.5 tabular-nums">{s.percentage}</td>
                  <td className="py-1.5">{s.gradeLabel ?? "—"}</td>
                  {data.settings.showSubjectComments && (
                    <td className="py-1.5 text-xs text-muted-foreground">{s.teacherComment ?? ""}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Info label="Overall average" value={card.overallAverage != null ? `${card.overallAverage}%` : "—"} />
          <Info label="Overall grade" value={card.overallGrade ?? "—"} />
          <Info
            label="Rank"
            value={data.settings.showRank && card.rank ? `${card.rank} of ${card.classSize ?? "—"}` : "—"}
          />
        </section>

        <section className="mt-4 grid gap-3 print:hidden">
          <div className="grid gap-1.5">
            <Label>Class teacher&apos;s comment</Label>
            <Textarea
              rows={2}
              value={classCommentValue}
              disabled={!canEditClass || card.status === "published"}
              onChange={(e) => setClassComment(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Principal&apos;s comment</Label>
            <Textarea
              rows={2}
              value={principalCommentValue}
              disabled={!canEditPrincipal || card.status === "published"}
              onChange={(e) => setPrincipalComment(e.target.value)}
            />
          </div>
          {card.status !== "published" && (canEditClass || canEditPrincipal) && (
            <Button size="sm" className="w-fit" onClick={save}>Save comments</Button>
          )}
        </section>

        {/* Print-only rendering of saved comments */}
        <section className="mt-4 hidden print:block">
          {card.classTeacherComment && (
            <p className="text-sm"><span className="font-medium">Class teacher:</span> {card.classTeacherComment}</p>
          )}
          {card.principalComment && (
            <p className="text-sm"><span className="font-medium">Principal:</span> {card.principalComment}</p>
          )}
        </section>

        <footer className="mt-6 border-t pt-3 text-center text-xs text-muted-foreground">
          {data.settings.signatureLabels.split("|").map((s) => s.trim()).filter(Boolean).join("  |  ")}
          {data.settings.nextTermOpeningDate && (
            <p className="mt-1">Next term opens: {data.settings.nextTermOpeningDate}</p>
          )}
          {data.settings.footerText && <p className="mt-1">{data.settings.footerText}</p>}
        </footer>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
