import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  PieChart, Pie, Cell,
} from "recharts";
import {
  GraduationCap, UserRound, Users, Grid3X3, CalendarRange, BookOpen, ArrowRight,
} from "lucide-react";

import { Link, useNavigate } from "react-router";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export default function Dashboard() {
  const overview = useQuery(api.dashboard.overview);
  const activity = useQuery(api.auditLogs.recent, { limit: 8 });
  const navigate = useNavigate();

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
              <p className="py-8 text-center text-sm text-muted-foreground">No students admitted yet.</p>
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
        <Label className="text-xs text-muted-foreground">
          All figures are computed live from your school's database.
        </Label>
      </div>
    </div>
  );
}
