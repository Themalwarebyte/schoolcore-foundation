import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "react-router";
import { PageHeader } from "@/components/layouts/platform-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/lib/status";
import {
  School, GraduationCap, UserRound, Activity as ActivityIcon, ArrowRight,
  AlertTriangle, ListChecks, Inbox,
} from "lucide-react";

export default function PlatformDashboard() {
  const stats = useQuery(api.schools.platformStats);
  const activity = useQuery(api.platform.platformActivity, { limit: 8 });
  const requests = useQuery(api.phase7.registration.platformRequestStats, {});
  const onboarding = useQuery(api.phase7.onboarding.platformList, {});

  const needsAttention = (onboarding ?? []).filter(
    (r) => !r.activated && r.schoolStatus === "active",
  );

  const cards = [
    { label: "Total schools", value: stats?.totalSchools, icon: School, to: "/platform/schools" },
    { label: "Active schools", value: stats?.activeSchools, icon: School, to: "/platform/schools" },
    { label: "Students (all schools)", value: stats?.totalStudents, icon: GraduationCap, to: "/platform/schools" },
    { label: "Staff (all schools)", value: stats?.totalStaff, icon: UserRound, to: "/platform/schools" },
  ];

  return (
    <div className="page-shell">
      <PageHeader
        title="Platform dashboard"
        description="Live statistics across every school on the platform."
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} to={c.to} className="card-soft group p-5 transition-shadow hover:shadow-md">
            <div className="flex items-center justify-between">
              <c.icon className="size-4 text-muted-foreground" />
              <ArrowRight className="size-3.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
            </div>
            {c.value === undefined ? (
              <Skeleton className="mt-3 h-8 w-16" />
            ) : (
              <p className="mt-3 text-3xl font-semibold tabular-nums">{c.value}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{c.label}</p>
          </Link>
        ))}
      </div>

      {/* Needs attention — work waiting on the platform admin */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="card-soft border-amber-200 dark:border-amber-900">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-500" /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats === undefined || requests === undefined ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (
              <>
                <Link to="/platform/school-requests" className="flex items-center justify-between rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50">
                  <span>
                    <span className="font-semibold">{requests.pending}</span> registration request{requests.pending === 1 ? "" : "s"} to review
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </Link>
                <Link to="/platform/schools" className="flex items-center justify-between rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50">
                  <span>
                    <span className="font-semibold">{onboarding?.length ?? 0}</span> school{(onboarding?.length ?? 0) === 1 ? "" : "s"} onboarded or onboarding
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </Link>
                <Link to="/platform/schools" className="flex items-center justify-between rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50">
                  <span>
                    <span className="font-semibold">{needsAttention.length}</span> active school{needsAttention.length === 1 ? "" : "s"} with setup incomplete
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="card-soft">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4" /> Setup progress by school
            </CardTitle>
          </CardHeader>
          <CardContent>
            {onboarding === undefined ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : onboarding.length === 0 ? (
              <div className="py-8 text-center">
                <Inbox className="mx-auto size-8 text-muted-foreground/60" />
                <p className="mt-2 text-sm text-muted-foreground">
                  No schools onboarded yet. Approve a registration request to get started.
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {onboarding.slice(0, 6).map((r) => {
                  const steps = [r.profileDone, r.academicsDone, r.usersDone, r.importDone];
                  const pct = Math.round((steps.filter(Boolean).length / steps.length) * 100);
                  return (
                    <div key={r._id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.schoolName}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.activated ? "Activated" : `${pct}% set up`}
                        </p>
                      </div>
                      <StatusBadge status={r.schoolStatus ?? "inactive"} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="card-soft">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recently created schools</CardTitle>
            <Link to="/platform/schools" className="text-sm font-medium text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {!stats ? (
              <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : stats.recentSchools.length === 0 ? (
              <div className="py-8 text-center">
                <School className="mx-auto size-8 text-muted-foreground/60" />
                <p className="mt-2 text-sm text-muted-foreground">No schools yet — new registrations will appear here.</p>
              </div>
            ) : (
              <div className="divide-y">
                {stats.recentSchools.map((s) => (
                  <Link key={s._id} to="/platform/schools" className="flex items-center justify-between py-2.5 hover:bg-muted/50">
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.code}</p>
                    </div>
                    <StatusBadge status={s.status} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="card-soft">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent platform activity</CardTitle>
            <Link to="/platform/activity" className="text-sm font-medium text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {activity === undefined ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : activity.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {activity.map((a) => (
                  <div key={a._id} className="flex gap-3 text-sm">
                    <ActivityIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate">{a.description || a.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.userName} · {a.schoolName}
                      </p>
                    </div>
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
