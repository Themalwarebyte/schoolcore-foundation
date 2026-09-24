import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PortalPageHeader, PortalSkeleton } from "@/components/layouts/portal-layout";
import { formatDateTime } from "@/lib/status";
import {
  CalendarCheck, Award, Wallet, ClipboardList, ArrowRight, Megaphone, GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function ParentDashboard() {
  const childrenData = useQuery(api.portal.parentChildren, {});
  const announcements = useQuery(api.portal.listAnnouncements, {});
  const [activeId, setActiveId] = useState<string | null>(null);

  const children = childrenData?.children ?? [];
  const active = children.find((c) => c.studentId === activeId) ?? children[0] ?? null;

  if (childrenData === undefined) {
    return (
      <div className="mx-auto max-w-3xl">
        <PortalSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PortalPageHeader
        title={`Welcome, ${childrenData.guardian.name.split(" ")[0]}`}
        description={active ? `Viewing ${active.name}` : undefined}
      />

      {/* Child switcher */}
      {children.length > 1 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {children.map((c) => (
            <button
              key={c.studentId}
              type="button"
              onClick={() => setActiveId(c.studentId)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                active?.studentId === c.studentId
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {c.name.split(" ")[0]} · {c.className ?? "—"}
            </button>
          ))}
        </div>
      )}

      {active && <ChildOverview studentId={active.studentId} childName={active.name} className_={active.className} />}

      {/* Latest announcements */}
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="size-4" /> Announcements
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/portal/announcements">View all <ArrowRight className="size-4" /></Link>
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

function ChildOverview({ studentId, childName, className_ }: { studentId: string; childName: string; className_: string | null }) {
  const overview = useQuery(api.portal.parentChildOverview, { studentId: studentId as never });

  if (overview === undefined) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }

  const fees = overview.fees;
  const attendance = overview.attendance;

  return (
    <div className="space-y-4">
      {/* Identity strip */}
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
            <GraduationCap className="size-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{childName}</p>
            <p className="text-sm text-muted-foreground">
              {overview.student.admissionNumber} · {className_ ?? "—"}
              {overview.term ? ` · ${overview.term.name}` : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={CalendarCheck}
          label="Attendance"
          value={attendance.percentage != null ? `${attendance.percentage}%` : "—"}
          sub={`${attendance.present + attendance.late} of ${attendance.markedDays} days present`}
          to={`/portal/${studentId}/attendance`}
        />
        <StatCard
          icon={Award}
          label="Latest average"
          value={overview.latestResult ? `${overview.latestResult.percentage}%` : "—"}
          sub={overview.latestResult ? overview.latestResult.subject : "No published results yet"}
          to={`/portal/${studentId}/results`}
        />
        <StatCard
          icon={Wallet}
          label="Fee balance"
          value={fees.balance > 0 ? fees.balance.toLocaleString() : "Clear"}
          sub={fees.balance > 0 ? `${fees.balance.toLocaleString()} outstanding` : "All settled"}
          to={`/portal/${studentId}/fees`}
          tone={fees.balance > 0 ? "warn" : "ok"}
        />
        <StatCard
          icon={ClipboardList}
          label="Assignments due"
          value={String(overview.upcomingAssignments)}
          sub="Published for their class"
          to={`/portal/${studentId}/assignments`}
        />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-3">
        <QuickLink to={`/portal/${studentId}/timetable`} label="Timetable" />
        <QuickLink to={`/portal/${studentId}/report-cards`} label="Report cards" />
        <QuickLink to={`/portal/${studentId}/fees`} label="Payments" />
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, sub, to, tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub: string; to: string; tone?: "ok" | "warn";
}) {
  return (
    <Link to={to} className="group">
      <Card className="h-full transition-colors group-hover:border-primary/40">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Icon className={cn("size-4", tone === "warn" ? "text-amber-600" : "text-primary")} />
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          </div>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to}>
      <Button variant="outline" className="w-full text-xs">{label}</Button>
    </Link>
  );
}
