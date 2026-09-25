import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PortalPageHeader, PortalSkeleton, usePortalSignOut } from "@/components/layouts/portal-layout";
import { downloadReportCardPdf, type ReportCardPdfData } from "@/lib/reportCardPdf";
import { formatDateTime } from "@/lib/status";
import { Megaphone, Bell, CheckCheck, UserRound, Download, ArrowLeft, Loader2 } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

export function PortalAnnouncements() {
  const data = useQuery(api.portal.listAnnouncements, {});
  if (data === undefined) return <PortalSkeleton />;
  return (
    <div>
      <PortalPageHeader title="Announcements" description="News from your school." />
      <div className="space-y-3">
        {data.announcements.length === 0 && (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            No announcements right now.
          </CardContent></Card>
        )}
        {data.announcements.map((a) => (
          <Card key={a._id}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Megaphone className="size-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{a.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.message}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {a.creator} · {a.publishedAt ? formatDateTime(a.publishedAt) : ""}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export function PortalNotifications() {
  const data = useQuery(api.portal.listNotifications, { limit: 100 });
  const markRead = useMutation(api.portal.markNotificationRead);
  const markAll = useMutation(api.portal.markAllNotificationsRead);
  const navigate = useNavigate();

  if (data === undefined) return <PortalSkeleton />;

  return (
    <div>
      <PortalPageHeader
        title="Notifications"
        description={data.unread > 0 ? `${data.unread} unread` : "You're all caught up"}
        actions={
          data.unread > 0 ? (
            <Button size="sm" variant="outline" onClick={() => void markAll({})}>
              <CheckCheck className="size-4" /> Mark all read
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-2">
        {data.notifications.length === 0 && (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
            <Bell className="mx-auto mb-2 size-8 text-muted-foreground/40" />
            No notifications yet.
          </CardContent></Card>
        )}
        {data.notifications.map((n) => (
          <button
            key={n._id}
            type="button"
            className={`w-full rounded-xl border p-3 text-left transition-colors hover:bg-accent/50 ${
              n.readAt ? "opacity-70" : "border-primary/30 bg-primary/[0.04]"
            }`}
            onClick={async () => {
              try {
                if (!n.readAt) await markRead({ notificationId: n._id as never });
                if (n.link) navigate(n.link);
              } catch {
                toast.error("Could not open this notification.");
              }
            }}
          >
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Bell className="size-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                <p className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</p>
              </div>
              {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function PortalProfile() {
  const profile = useQuery(api.portal.myProfile, {});
  const save = useMutation(api.portal.updateGuardianContact);
  const signOut = usePortalSignOut();
  const [phone, setPhone] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (profile === undefined) return <PortalSkeleton />;
  const g = profile.guardian;

  return (
    <div>
      <PortalPageHeader title="My profile" />
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <UserRound className="size-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{profile.name ?? "—"}</p>
                <p className="text-sm text-muted-foreground">{profile.email ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {g ? (
          <Card>
            <CardContent className="space-y-4 p-4">
              <div>
                <Label htmlFor="p-name">Guardian record</Label>
                <p className="mt-1 text-sm">{g.name}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-phone">Phone</Label>
                <Input id="p-phone" value={phone ?? g.phone ?? ""} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-address">Home address</Label>
                <Input id="p-address" value={address ?? g.address ?? ""} onChange={(e) => setAddress(e.target.value)} placeholder="Address" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Occupation: {g.occupation ?? "—"}
                </p>
                <Button
                  size="sm"
                  disabled={saving || (phone === null && address === null)}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await save({
                        phone: phone ?? undefined,
                        address: address ?? undefined,
                      });
                      setPhone(null);
                      setAddress(null);
                      toast.success("Contact details updated");
                    } catch (err) {
                      toast.error("Could not save your changes.", {
                        description: undefined,
                      });
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving && <Loader2 className="size-4 animate-spin" />} Save changes
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Updates are written to your guardian record and audited.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              This account is not linked to a guardian record. Contact the school office to update your details.
            </CardContent>
          </Card>
        )}

        <Button variant="outline" className="w-full" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Portal report card detail (published snapshot + PDF download)       */
/* ------------------------------------------------------------------ */

export function PortalReportCardDetail() {
  const { reportCardId } = useParams<{ reportCardId: string }>();
  const navigate = useNavigate();
  const data = useQuery(
    api.portal.portalReportCardDetail,
    reportCardId ? { reportCardId: reportCardId as never } : "skip",
  );

  if (data === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data || !data.card) {
    return (
      <div>
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          Report card not found or not published.
        </CardContent></Card>
      </div>
    );
  }

  const card = data.card;
  const download = () => downloadReportCardPdf(data as unknown as ReportCardPdfData);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button size="sm" onClick={download}>
          <Download className="size-4" /> Download PDF
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <header className="border-b pb-3 text-center">
          <h1 className="text-lg font-bold tracking-tight">{data.school.name}</h1>
          {data.school.address && <p className="text-xs text-muted-foreground">{data.school.address}</p>}
          <h2 className="mt-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Term Report Card — {data.termName} {data.yearName}
          </h2>
        </header>

        <section className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Info label="Student" value={data.student?.fullName ?? "—"} />
          <Info label="Admission no." value={data.student?.admissionNumber ?? "—"} />
          <Info label="Class" value={data.classLabel} />
          <Info label="Term end" value={data.termEndDate ?? "—"} />
        </section>

        {data.settings.showAttendance && card.attendance && (
          <section className="mt-3 rounded-lg border p-3 text-xs">
            <p className="mb-1 font-medium">Attendance</p>
            <p className="text-muted-foreground">
              Present {card.attendance.present} · Absent {card.attendance.absent} · Late {card.attendance.late} · Excused {card.attendance.excused} —{" "}
              <span className="font-semibold text-foreground">{card.attendance.percentage}%</span>
            </p>
          </section>
        )}

        <section className="mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5">Subject</th>
                <th className="py-1.5">Score</th>
                <th className="py-1.5">%</th>
                <th className="py-1.5">Grade</th>
                {data.settings.showSubjectComments && <th className="py-1.5">Remark</th>}
              </tr>
            </thead>
            <tbody>
              {card.subjects.map((s) => (
                <tr key={s.subjectId} className="border-b last:border-0">
                  <td className="py-1.5 font-medium">{s.subjectName}</td>
                  <td className="py-1.5 tabular-nums">{s.totalScore}</td>
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

        <section className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <Info label="Average" value={card.overallAverage != null ? `${card.overallAverage}%` : "—"} />
          <Info label="Grade" value={card.overallGrade ?? "—"} />
          <Info label="Rank" value={data.settings.showRank && card.rank ? `${card.rank} of ${card.classSize ?? "—"}` : "—"} />
        </section>

        {(card.classTeacherComment || card.principalComment) && (
          <section className="mt-3 space-y-2 border-t pt-3 text-sm">
            {card.classTeacherComment && (
              <p><span className="font-medium">Class teacher:</span> {card.classTeacherComment}</p>
            )}
            {card.principalComment && (
              <p><span className="font-medium">Principal:</span> {card.principalComment}</p>
            )}
          </section>
        )}

        <footer className="mt-4 border-t pt-2 text-center text-[11px] text-muted-foreground">
          {data.settings.signatureLabels.split("|").map((s) => s.trim()).filter(Boolean).join("  |  ")}
          {data.settings.nextTermOpeningDate && <p className="mt-1">Next term opens: {data.settings.nextTermOpeningDate}</p>}
        </footer>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
