import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Navigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/lib/status";
import { usePermissions } from "@/hooks/use-session";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  PieChart, Pie, Cell,
} from "recharts";
import {
  GraduationCap, UserRound, Users, Grid3X3, CalendarRange, BookOpen, ArrowRight,
  CalendarCheck, ClipboardCheck, Award, Clock, AlertTriangle, CheckCircle2, ListChecks,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export default function Dashboard() {
  const overview = useQuery(api.dashboard.overview);
  const activity = useQuery(api.auditLogs.recent, { limit: 8 });
  const { can, role } = usePermissions();
  const navigate = useNavigate();

  // Phase 4: portal roles are redirected to their portals (also enforced in
  // the school layout, this keeps direct /dashboard visits consistent).
  if (role === "parent") return <Navigate to="/portal" replace />;
  if (role === "student") return <Navigate to="/student" replace />;

  // Phase 2: teacher home (replaces the admin dashboard for teachers).
  const showTeacherHome = can("attendance.take") && !can("users.view");
  const teacherHome = useQuery(
    api.academicOps.teacherHome,
    showTeacherHome ? {} : "skip",
  );

  if (showTeacherHome) {
    return <TeacherHome data={teacherHome} />;
  }

  return <AdminHome overview={overview} activity={activity} />;

  /* Metric card definitions shared by the admin dashboard. */
  function cards(): { label: string; value: number | undefined; icon: typeof GraduationCap; to: string }[] {
    return [
      { label: "Total Students", value: overview?.counts.students, icon: GraduationCap, to: "/students" },
      { label: "Total Staff", value: overview?.counts.staff, icon: UserRound, to: "/staff" },
      { label: "Teachers", value: overview?.counts.teachers, icon: UserRound, to: "/staff" },
      { label: "Guardians", value: overview?.counts.guardians, icon: Users, to: "/guardians" },
      { label: "Active Classes", value: overview?.counts.classes, icon: Grid3X3, to: "/academics/classes" },
      { label: "Subjects", value: overview?.counts.subjects, icon: BookOpen, to: "/academics/subjects" },
    ];
  }
}

/* ---------------------------------------------------------------------- */
/* Admin dashboard (school admins, principals, accountants)                */
/* ---------------------------------------------------------------------- */

type Overview = {
  counts: {
    students: number; staff: number; teachers: number;
    guardians: number; classes: number; subjects: number;
  };
  academicContext: { name: string; startDate: string; endDate: string } | null;
  studentsByGrade: { name: string; count: number }[];
  genderDistribution: { male: number; female: number; other: number };
  recentStudents: { _id: string; fullName: string; admissionNumber: string; studentStatus: string }[];
};

type Activity = {
  _id: string; description: string; action: string; userName: string;
  _creationTime: number;
}[];

function AdminHome({
  overview, activity,
}: { overview: Overview | undefined; activity: Activity | undefined }) {
  const checklist = useQuery(api.dashboard.setupChecklist, {});
  const attention = useQuery(api.dashboard.attention, {});
  const navigate = useNavigate();

  const attentionItems: { label: string; count: number; to: string }[] = attention ? [
    { label: "students missing details", count: attention.incompleteStudents, to: "/students" },
    { label: "invoices overdue", count: attention.overdueInvoices, to: "/finance/invoices" },
    { label: "admission applications to review", count: attention.pendingAdmissions, to: "/admissions" },
    { label: "leave requests pending", count: attention.pendingLeave, to: "/hr" },
    { label: "expense claims to approve", count: attention.pendingExpenses, to: "/finance/expenses" },
  ].filter((i) => i.count > 0) : [];

  const cards = [
    { label: "Total Students", value: overview?.counts.students, icon: GraduationCap, to: "/students" },
    { label: "Total Staff", value: overview?.counts.staff, icon: UserRound, to: "/staff" },
    { label: "Teachers", value: overview?.counts.teachers, icon: UserRound, to: "/staff" },
    { label: "Guardians", value: overview?.counts.guardians, icon: Users, to: "/guardians" },
    { label: "Active Classes", value: overview?.counts.classes, icon: Grid3X3, to: "/academics/classes" },
    { label: "Subjects", value: overview?.counts.subjects, icon: BookOpen, to: "/academics/subjects" },
  ];

  return (
    <div className="page-shell">
      <PageHeader
        title="Dashboard"
        description={
          overview?.academicContext
            ? `${overview.academicContext.name} · in session`
            : "Set a current academic year to begin"
        }
        actions={
          <Can permission="academics.manage">
            <Link to="/academics/years" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <CalendarRange className="size-4" /> Academic setup
            </Link>
          </Can>
        }
      />

      {/* Setup progress — shown until the school is fully set up */}
      {checklist && !checklist.isComplete && (
        <Card className="card-soft mb-4">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <ListChecks className="size-4 text-primary" /> School setup · {checklist.percent}% complete
              </p>
              <Link to="/onboarding" className="text-xs font-medium text-primary hover:underline">
                Continue setup
              </Link>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${checklist.percent}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {checklist.steps.map((s) => (
                <span key={s.key} className={`flex items-center gap-1.5 text-xs ${s.done ? "text-muted-foreground" : "font-medium text-foreground"}`}>
                  {s.done
                    ? <CheckCircle2 className="size-3.5 text-emerald-600" />
                    : <span className="size-2 rounded-full border border-muted-foreground" />}
                  {s.label}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attention required — actionable, only when there is work */}
      {attentionItems.length > 0 && (
        <Card className="card-soft mb-4 border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-500" /> Attention required
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {attentionItems.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="flex items-center justify-between rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50"
              >
                <span><span className="font-semibold">{item.count}</span> {item.label}</span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => navigate(c.to)}
            className="card-soft group p-4 text-left transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <c.icon className="size-4 text-muted-foreground" />
              <ArrowRight className="size-3.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
            </div>
            {c.value === undefined ? (
              <Skeleton className="mt-3 h-7 w-12" />
            ) : (
              <p className="mt-3 text-2xl font-semibold tabular-nums">{c.value}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{c.label}</p>
          </button>
        ))}
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="card-soft lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Students by grade</CardTitle>
          </CardHeader>
          <CardContent>
            {!overview ? (
              <Skeleton className="h-64 w-full" />
            ) : overview.studentsByGrade.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No enrollments yet — enroll students into classes to see this chart.
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overview.studentsByGrade}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                    <ReTooltip cursor={{ fill: "var(--muted)" }} />
                    <Bar dataKey="count" name="Students" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="card-soft">
          <CardHeader>
            <CardTitle className="text-base">Gender distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {!overview ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: "Female", value: overview.genderDistribution.female },
                          { name: "Male", value: overview.genderDistribution.male },
                          { name: "Other", value: overview.genderDistribution.other },
                        ]}
                        dataKey="value"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={2}
                      >
                        {[CHART_COLORS[0], CHART_COLORS[2], CHART_COLORS[3]].map((color, i) => (
                          <Cell key={i} fill={color} />
                        ))}
                      </Pie>
                      <ReTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1.5">
                  {[
                    ["Female", overview.genderDistribution.female, CHART_COLORS[0]],
                    ["Male", overview.genderDistribution.male, CHART_COLORS[2]],
                    ["Other", overview.genderDistribution.other, CHART_COLORS[3]],
                  ].map(([name, value, color]) => (
                    <div key={name as string} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: color as string }} />
                        {name}
                      </span>
                      <span className="font-medium tabular-nums">{value as number}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lists */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="card-soft lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent students</CardTitle>
            <Link to="/students" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {!overview ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : overview.recentStudents.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium">No students yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add students one by one or import your full list to get started.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link to="/students">Add students</Link>
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {overview.recentStudents.map((s) => (
                  <Link
                    key={s._id}
                    to={`/students/${s._id}`}
                    className="flex items-center justify-between py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div>
                      <p className="text-sm font-medium">{s.fullName}</p>
                      <p className="text-xs text-muted-foreground">{s.admissionNumber}</p>
                    </div>
                    <StatusBadge status={s.studentStatus} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="card-soft">
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity === undefined ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : activity.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {activity.map((a) => (
                  <div key={a._id} className="flex gap-3 text-sm">
                    <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                    <div className="min-w-0">
                      <p className="truncate text-foreground/90">{a.description || a.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.userName} · {new Date(a._creationTime).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <p className="text-xs text-muted-foreground">
          All figures are computed live from your school's database.
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Phase 2: Teacher home (§59)                                             */
/* ---------------------------------------------------------------------- */

type TeacherHomeData = {
  isTeacher: boolean;
  staffName: string;
  today: string;
  todaysClasses: {
    _id: string;
    classSectionId: string;
    subjectId: string;
    periodName: string;
    startTime: string;
    classLabel: string;
    subjectName: string;
    attendanceDone: boolean;
  }[];
  allocations: number;
  assignments: { _id: string; title: string; dueDate: string; status: string }[];
  assessments: { _id: string; title: string; status: string; subjectName: string; classLabel: string; entered: number; expected: number }[];
  actionRequired: { attendance: number; marksIncomplete: number };
};

function TeacherHome({
  data,
}: { data: TeacherHomeData | null | undefined }) {
  if (data === undefined) {
    return (
      <div className="page-shell">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    );
  }
  // Non-teaching staff fall back to the standard admin dashboard.
  if (!data) return <AdminHome overview={undefined} activity={undefined} />;

  return (
    <div className="page-shell">
      <PageHeader
        title={`Good day, ${data.staffName.split(" ")[0]}`}
        description={`${data.today} · ${data.allocations} active allocation(s)`}
        actions={
          <Link to="/attendance" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <CalendarCheck className="size-4" /> Take attendance
          </Link>
        }
      />

      {data.actionRequired.attendance > 0 || data.actionRequired.marksIncomplete > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <ActionTile
            icon={CalendarCheck}
            tone="amber"
            label="Attendance to complete today"
            value={data.actionRequired.attendance}
            to="/attendance"
          />
          <ActionTile
            icon={ClipboardCheck}
            tone="red"
            label="Assessments awaiting marks"
            value={data.actionRequired.marksIncomplete}
            to="/assessments"
          />
        </div>
      ) : (
        <Card className="card-soft mb-4 border-emerald-200 dark:border-emerald-900">
          <CardContent className="flex items-center gap-3 py-4">
            <Award className="size-5 text-emerald-600" />
            <p className="text-sm">You&apos;re all caught up — attendance recorded and marks up to date.</p>
          </CardContent>
        </Card>
      )}

      <Card className="card-soft">
        <CardHeader>
          <CardTitle className="text-base">Today&apos;s lessons</CardTitle>
        </CardHeader>
        <CardContent>
          {data.todaysClasses.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No lessons scheduled for you today.
            </p>
          ) : (
            <div className="divide-y">
              {data.todaysClasses.map((e) => (
                <div key={e._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <Clock className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {e.classLabel} · {e.subjectName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {e.periodName} at {e.startTime}
                      </p>
                    </div>
                  </div>
                  {e.attendanceDone ? (
                    <StatusBadge status="completed" />
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/attendance">Record</Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="card-soft">
          <CardHeader>
            <CardTitle className="text-base">Assignments due soon</CardTitle>
          </CardHeader>
          <CardContent>
            {data.assignments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No active assignments.</p>
            ) : (
              <div className="divide-y">
                {data.assignments.map((a) => (
                  <div key={a._id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium">{a.title}</span>
                    <span className="text-xs text-muted-foreground">due {a.dueDate}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="card-soft">
          <CardHeader>
            <CardTitle className="text-base">Marks needing entry</CardTitle>
          </CardHeader>
          <CardContent>
            {data.assessments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">All marks are up to date.</p>
            ) : (
              <div className="divide-y">
                {data.assessments.map((a) => (
                  <div key={a._id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.classLabel} · {a.subjectName}
                      </p>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {a.entered}/{a.expected}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActionTile({
  icon: Icon, label, value, to, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number; to: string; tone: "amber" | "red";
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border p-4 transition-colors hover:bg-muted/50"
    >
      <Icon className={tone === "red" ? "size-5 text-red-500" : "size-5 text-amber-500"} />
      <div>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <ArrowRight className="ml-auto size-4 text-muted-foreground" />
    </Link>
  );
}
