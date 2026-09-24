import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PortalPageHeader, PortalSkeleton } from "@/components/layouts/portal-layout";
import { AttendanceView, ResultsView, ReportCardsView } from "./shared";
import { formatDateTime } from "@/lib/status";
import { CalendarCheck, Award, ClipboardList, Megaphone, ArrowRight, GraduationCap } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Student dashboard                                                   */
/* ------------------------------------------------------------------ */

export default function StudentDashboard() {
  const overview = useQuery(api.portal.studentOverview, {});
  const announcements = useQuery(api.portal.listAnnouncements, {});

  if (overview === undefined) {
    return (
      <div className="mx-auto max-w-3xl">
        <PortalSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PortalPageHeader
        title={`Hi, ${overview.student.name.split(" ")[0]}`}
        description={
          [overview.student.className, overview.term?.name].filter(Boolean).join(" · ") || undefined
        }
      />

      {/* Identity strip */}
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
            <GraduationCap className="size-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{overview.student.name}</p>
            <p className="text-sm text-muted-foreground">{overview.student.admissionNumber}</p>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCard
          icon={CalendarCheck}
          label="Attendance"
          to="/student/attendance"
          sub="This term so far"
          value={<AttendanceMini />}
        />
        <StatCard
          icon={Award}
          label="Best subject"
          to="/student/results"
          sub="Published results"
          value={<BestSubject items={overview.latestResults} />}
        />
      </div>

      {/* Next assignments */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="size-4" /> Upcoming work
            {overview.assignmentsDue > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {overview.assignmentsDue} due
              </span>
            )}
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/student/assignments">All <ArrowRight className="size-4" /></Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {overview.nextAssignments.length === 0 && (
            <p className="py-3 text-center text-sm text-muted-foreground">
              Nothing due — you're all caught up.
            </p>
          )}
          {overview.nextAssignments.map((a, i) => (
            <div key={`${a.title}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.subject}</p>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Due {a.dueDate}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Announcements preview */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="size-4" /> School announcements
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/student/announcements">All <ArrowRight className="size-4" /></Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {(announcements?.announcements ?? []).slice(0, 3).map((a) => (
            <div key={a._id} className="rounded-lg border p-3">
              <p className="text-sm font-medium">{a.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.message}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {a.creator} · {a.publishedAt ? formatDateTime(a.publishedAt) : ""}
              </p>
            </div>
          ))}
          {(announcements?.announcements ?? []).length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No announcements right now.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AttendanceMini() {
  const data = useQuery(api.portal.studentAttendance, {});
  if (data === undefined || data.summary.percentage == null) return <span>—</span>;
  return <span>{data.summary.percentage}%</span>;
}

function BestSubject({ items }: { items: { subject: string; percentage: number }[] }) {
  if (items.length === 0) return <span>—</span>;
  return <span>{items[0].percentage}%</span>;
}

function StatCard({
  icon: Icon, label, sub, to, value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; sub: string; to: string; value: React.ReactNode;
}) {
  return (
    <Link to={to} className="group">
      <Card className="h-full transition-colors group-hover:border-primary/40">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-primary" />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          </div>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Student sub-pages                                                   */
/* ------------------------------------------------------------------ */

export function StudentAttendance() {
  const data = useQuery(api.portal.studentAttendance, {});
  return (
    <div>
      <PortalPageHeader title="My attendance" description="Daily attendance from the school register." />
      <AttendanceView data={data} />
    </div>
  );
}

export function StudentResults() {
  const data = useQuery(api.portal.studentResults, {});
  return (
    <div>
      <PortalPageHeader title="My results" description="Published subject results by term." />
      <ResultsView data={data} />
    </div>
  );
}

export function StudentReportCards() {
  const cards = useQuery(api.portal.studentReportCards, {});
  return (
    <div>
      <PortalPageHeader title="My report cards" description="Published term report cards." />
      <ReportCardsView cards={cards} detailBase="/student" />
    </div>
  );
}

export function StudentAssignments() {
  const data = useQuery(api.portal.studentAssignments, {});
  if (data === undefined) return <PortalSkeleton />;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = data.assignments.filter((a) => a.dueDate >= today);
  const past = data.assignments.filter((a) => a.dueDate < today);
  return (
    <div>
      <PortalPageHeader title="My assignments" description="Homework from your teachers." />
      <div className="space-y-4">
        {data.assignments.length === 0 && (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No assignments published for your class yet.
          </CardContent></Card>
        )}
        {upcoming.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <p className="border-b px-4 py-3 text-sm font-medium">Upcoming</p>
              <div className="divide-y">
                {upcoming.map((a, i) => (
                  <div key={`${a.title}-${i}`} className="px-4 py-3">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.subject} · {a.teacher ?? "Teacher TBA"} · due {a.dueDate}
                    </p>
                    {a.instructions && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.instructions}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {past.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <p className="border-b px-4 py-3 text-sm font-medium">Earlier</p>
              <div className="divide-y">
                {past.slice(0, 20).map((a, i) => (
                  <div key={`${a.title}-${i}`} className="px-4 py-3">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.subject} · was due {a.dueDate}
                    </p>
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

export function StudentTimetable() {
  const data = useQuery(api.portal.studentTimetable, {});
  if (data === undefined) return <PortalSkeleton />;
  const days = new Map<string, typeof data.days>();
  for (const e of data.days) {
    const list = days.get(e.dayName) ?? [];
    list.push(e);
    days.set(e.dayName, list);
  }
  const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const sortedDays = [...days.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  return (
    <div>
      <PortalPageHeader title="My timetable" description="Your published class timetable." />
      <div className="space-y-3">
        {sortedDays.length === 0 && (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No published timetable for your class yet.
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
