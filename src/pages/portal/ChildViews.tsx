import { useParams } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { PortalPageHeader, PortalSkeleton } from "@/components/layouts/portal-layout";
import { AttendanceView, ResultsView, ReportCardsView, ReceiptDownloadButton } from "./shared";
import { Clock, Receipt } from "lucide-react";
import { formatDateTime } from "@/lib/status";

/* ------------------------------------------------------------------ */
/* Shared param guard                                                  */
/* ------------------------------------------------------------------ */

function useChildParam(): string {
  const { studentId } = useParams<{ studentId: string }>();
  return studentId ?? "";
}

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

export function ChildAttendance() {
  const studentId = useChildParam();
  const data = useQuery(
    api.portal.parentChildAttendance,
    studentId ? { studentId: studentId as never } : "skip",
  );
  return (
    <div>
      <PortalPageHeader title="Attendance" description="Daily attendance records for your child." />
      <AttendanceView data={data} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export function ChildResults() {
  const studentId = useChildParam();
  const data = useQuery(
    api.portal.parentChildResults,
    studentId ? { studentId: studentId as never } : "skip",
  );
  return (
    <div>
      <PortalPageHeader
        title="Results"
        description="Published subject results. Draft marks are never shown."
      />
      <ResultsView data={data} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Report cards                                                        */
/* ------------------------------------------------------------------ */

export function ChildReportCards() {
  const studentId = useChildParam();
  const cards = useQuery(
    api.portal.parentChildReportCards,
    studentId ? { studentId: studentId as never } : "skip",
  );
  return (
    <div>
      <PortalPageHeader title="Report cards" description="Published term report cards." />
      <ReportCardsView cards={cards} detailBase={`/portal/${studentId}`} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assignments                                                         */
/* ------------------------------------------------------------------ */

export function ChildAssignments() {
  const studentId = useChildParam();
  const data = useQuery(
    api.portal.parentChildAssignments,
    studentId ? { studentId: studentId as never } : "skip",
  );
  if (data === undefined) return <PortalSkeleton />;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = data.assignments.filter((a) => a.dueDate >= today);
  const past = data.assignments.filter((a) => a.dueDate < today);
  return (
    <div>
      <PortalPageHeader title="Assignments" description="Homework published for your child's class." />
      <div className="space-y-4">
        {data.assignments.length === 0 && (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No assignments published for this class yet.
          </CardContent></Card>
        )}
        {upcoming.length > 0 && (
          <Section title="Upcoming">
            {upcoming.map((a, i) => <AssignmentRow key={`${a.title}-${i}`} a={a} />)}
          </Section>
        )}
        {past.length > 0 && (
          <Section title="Earlier this term">
            {past.slice(0, 20).map((a, i) => <AssignmentRow key={`${a.title}-${i}`} a={a} />)}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-0">
        <p className="border-b px-4 py-3 text-sm font-medium">{title}</p>
        <div className="divide-y">{children}</div>
      </CardContent>
    </Card>
  );
}

function AssignmentRow({
  a,
}: {
  a: {
    title: string; instructions: string | null; subject: string; teacher: string | null;
    issueDate: string; dueDate: string; overdue: boolean;
  };
}) {
  const today = new Date().toISOString().slice(0, 10);
  const due = a.dueDate >= today;
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{a.title}</p>
          <p className="text-xs text-muted-foreground">
            {a.subject} · {a.teacher ?? "Teacher TBA"}
          </p>
          {a.instructions && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.instructions}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">Due {a.dueDate}</p>
          <span
            className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
              a.overdue
                ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                : due
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-muted"
            }`}
          >
            {a.overdue ? "Overdue" : due ? "Due soon" : "Issued"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Timetable                                                           */
/* ------------------------------------------------------------------ */

export function ChildTimetable() {
  const studentId = useChildParam();
  const data = useQuery(
    api.portal.parentChildTimetable,
    studentId ? { studentId: studentId as never } : "skip",
  );
  if (data === undefined) return <PortalSkeleton />;
  const days = new Map<string, typeof data.days>();
  for (const e of data.days) {
    const list = days.get(e.dayName) ?? [];
    list.push(e);
    days.set(e.dayName, list);
  }
  const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const sortedDays = [...days.entries()].sort(
    (a, b) => order.indexOf(a[0]) - order.indexOf(b[0]),
  );
  return (
    <div>
      <PortalPageHeader title="Timetable" description="Published class timetable." />
      <div className="space-y-3">
        {sortedDays.length === 0 && (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No published timetable for this class yet.
          </CardContent></Card>
        )}
        {sortedDays.map(([day, entries]) => (
          <Card key={day}>
            <CardContent className="p-0">
              <p className="border-b px-4 py-2.5 text-sm font-semibold">{day}</p>
              <div className="divide-y">
                {entries.map((e, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {e.startTime}–{e.endTime}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{e.subject ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {[e.teacher, e.room].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <Clock className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fees                                                                */
/* ------------------------------------------------------------------ */

export function ChildFees() {
  const studentId = useChildParam();
  const fees = useQuery(
    api.portal.parentChildFees,
    studentId ? { studentId: studentId as never } : "skip",
  );
  const receipts = useQuery(
    api.portal.parentChildReceipts,
    studentId ? { studentId: studentId as never } : "skip",
  );

  if (fees === undefined || receipts === undefined) return <PortalSkeleton />;

  const totals = fees.totals;
  return (
    <div>
      <PortalPageHeader title="Fees" description="Invoices, payments, and downloadable receipts." />

      {/* Summary */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total billed</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{totals.billed.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total paid</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {totals.paid.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Invoices */}
      <div className="space-y-3">
        <p className="text-sm font-semibold">Invoices</p>
        {fees.invoices.length === 0 && (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
            No invoices issued yet.
          </CardContent></Card>
        )}
        {fees.invoices.map((inv) => (
          <Card key={inv.invoiceId}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{inv.invoiceNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.term ?? ""} · Due {inv.dueDate}
                  </p>
                </div>
                <StatusPill status={inv.status} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <p className="text-[11px] text-muted-foreground">Total</p>
                  <p className="font-medium tabular-nums">{inv.totalAmount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Paid</p>
                  <p className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                    {inv.paid.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Balance</p>
                  <p className={`font-medium tabular-nums ${inv.balance > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>
                    {inv.balance.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Receipts */}
        <p className="pt-2 text-sm font-semibold">Receipts</p>
        {receipts.receipts.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
            No receipts yet.
          </CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {receipts.receipts.map((r) => (
                  <div key={r.receiptId} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Receipt className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.receiptNumber}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(r.issuedAt)}</p>
                      </div>
                    </div>
                    <ReceiptDownloadButton receiptId={r.receiptId} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "paid" || status === "confirmed"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "overdue" || status === "cancelled"
        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        : status === "partially_paid"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tone}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
