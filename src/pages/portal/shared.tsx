import { useQuery } from "convex/react";
import { Link } from "react-router";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { PortalSkeleton } from "@/components/layouts/portal-layout";
import { buildReceiptPdf, downloadPdf } from "@/lib/financePdf";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

const ATT_TONE: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  absent: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  late: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  excused: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

export function AttendanceView({
  data,
}: {
  data:
    | {
        summary: { present: number; absent: number; late: number; excused: number; percentage: number | null; totalDays: number };
        recent: { date: string; status: string; reason?: string | null }[];
      }
    | undefined;
}) {
  if (data === undefined) return <PortalSkeleton />;
  const s = data.summary;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Attendance rate</p>
              <p className="text-3xl font-semibold tracking-tight">
                {s.percentage != null ? `${s.percentage}%` : "No data"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{s.totalDays} days recorded</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-right text-sm">
              <span className="text-muted-foreground">Present</span><span className="font-medium tabular-nums">{s.present}</span>
              <span className="text-muted-foreground">Late</span><span className="font-medium tabular-nums">{s.late}</span>
              <span className="text-muted-foreground">Absent</span><span className="font-medium tabular-nums">{s.absent}</span>
              <span className="text-muted-foreground">Excused</span><span className="font-medium tabular-nums">{s.excused}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <p className="border-b px-4 py-3 text-sm font-medium">Recent days</p>
          <div className="divide-y">
            {data.recent.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No attendance recorded yet.</p>
            )}
            {data.recent.slice(0, 30).map((r) => (
              <div key={r.date} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium">{r.date}</p>
                  {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ATT_TONE[r.status] ?? "bg-muted"}`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export function ResultsView({
  data,
}: {
  data:
    | {
        terms: {
          termId: string;
          term: string;
          average: number;
          subjects: { subjectId?: string; subject: string; totalScore: number; percentage: number; gradeLabel: string | null }[];
        }[];
      }
    | undefined;
}) {
  if (data === undefined) return <PortalSkeleton />;
  return (
    <div className="space-y-4">
      {data.terms.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No published results yet. Results appear here once the school publishes them.
        </CardContent></Card>
      )}
      {data.terms.map((t) => (
        <Card key={t.termId}>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">{t.term}</p>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                Average {t.average}%
              </span>
            </div>
            <div className="space-y-2.5">
              {t.subjects.map((s, i) => (
                <div key={s.subjectId ?? `${t.termId}-${i}`} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">{s.subject}</p>
                      <p className="shrink-0 text-sm tabular-nums">{s.totalScore} · {s.percentage}%</p>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, Math.max(0, s.percentage))}%` }}
                      />
                    </div>
                  </div>
                  <span className="shrink-0 rounded border px-2 py-0.5 text-xs font-semibold">
                    {s.gradeLabel ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Report cards (list; detail page handles the PDF)                    */
/* ------------------------------------------------------------------ */

export function ReportCardsView({
  cards, detailBase,
}: {
  cards:
    | {
        reportCards: {
          reportCardId: string;
          term: string;
          overallAverage: number | null;
          overallGrade: string | null;
          rank: number | null;
          classSize: number | null;
        }[];
      }
    | undefined;
  /** Route prefix for the detail page, e.g. "/portal/<id>" or "/student". */
  detailBase: string;
}) {
  if (cards === undefined) return <PortalSkeleton />;
  return (
    <div className="space-y-3">
      {cards.reportCards.length === 0 && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No published report cards yet.
        </CardContent></Card>
      )}
      {cards.reportCards.map((c) => (
        <Card key={c.reportCardId}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{c.term}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {c.overallAverage != null ? `Average ${c.overallAverage}%` : ""}
                {c.overallGrade ? ` · Grade ${c.overallGrade}` : ""}
                {c.rank ? ` · Rank ${c.rank} of ${c.classSize ?? "—"}` : ""}
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to={`${detailBase}/report-cards/${c.reportCardId}`}>View</Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Receipt PDF helper (parent fees page)                               */
/* ------------------------------------------------------------------ */

export function ReceiptDownloadButton({ receiptId }: { receiptId: string }) {
  const receipt = useQuery(api.portal.receiptDetail, { receiptId: receiptId as never });
  if (receipt === undefined) {
    return <Button size="sm" variant="ghost" disabled><Download className="size-4" /></Button>;
  }
  const download = () => {
    if (!receipt.student) return;
    const doc = buildReceiptPdf({
      school: receipt.school ?? { name: "School" },
      receiptNumber: receipt.receiptNumber,
      paymentNumber: receipt.paymentNumber ?? "—",
      student: receipt.student,
      amount: receipt.amount ?? 0,
      method: receipt.method ?? "—",
      referenceNumber: receipt.referenceNumber,
      paymentDate: receipt.paymentDate ?? "—",
      receivedBy: receipt.receivedBy,
      balanceAfter: receipt.balanceAfter,
    });
    downloadPdf(doc, `Receipt-${receipt.receiptNumber}.pdf`);
  };
  return (
    <Button size="sm" variant="outline" onClick={download}>
      <Download className="size-4" /> PDF
    </Button>
  );
}
