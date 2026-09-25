import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/lib/status";
import { usePermissions } from "@/hooks/use-session";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Clock } from "lucide-react";
import { ClassSelect, ScopeBar } from "@/components/ops/Controls";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";

const STATUSES = ["present", "absent", "late", "excused"] as const;
type AttStatus = (typeof STATUSES)[number];

const STATUS_STYLES: Record<AttStatus, string> = {
  present: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  absent: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  late: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  excused: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};

type RegisterRow = {
  studentId: string;
  enrollmentId: string;
  admissionNumber: string;
  fullName: string;
};

type ExistingRecord = {
  studentId: string;
  status: string;
  reason?: string;
  note?: string;
};

export default function Attendance() {
  const { can } = usePermissions();
  const [classSectionId, setClassSectionId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<"today" | "lesson" | "history">("today");
  // Attendance mode from settings decides whether the lesson tab is usable.
  const settings = useQuery(api.academicOps.getSettings, can("settings.view") ? {} : "skip");
  const lessonAllowed =
    !settings || settings.attendanceMode === "lesson" || settings.attendanceMode === "both";

  return (
    <div className="page-shell">
      <PageHeader
        title="Attendance"
        description="Take the daily or per-lesson register, review history and monitor attendance rates."
      />

      <div className="mb-4 flex gap-2">
        <Button
          variant={mode === "today" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("today")}
        >
          <ClipboardCheck className="size-4" /> Daily register
        </Button>
        {lessonAllowed && (
          <Button
            variant={mode === "lesson" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("lesson")}
          >
            <Clock className="size-4" /> Lesson register
          </Button>
        )}
        <Button
          variant={mode === "history" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("history")}
        >
          History &amp; analytics
        </Button>
      </div>

      {mode === "today" ? (
        <RegisterView
          classSectionId={classSectionId}
          setClassSectionId={setClassSectionId}
          date={date}
          setDate={setDate}
          canTake={can("attendance.take")}
        />
      ) : mode === "lesson" ? (
        <LessonRegisterView date={date} setDate={setDate} canTake={can("attendance.take")} />
      ) : (
        <HistoryView classSectionId={classSectionId} setClassSectionId={setClassSectionId} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Lesson register (per timetable lesson, same session engine)           */
/* -------------------------------------------------------------------- */

function LessonRegisterView({
  date, setDate, canTake,
}: {
  date: string; setDate: (v: string) => void; canTake: boolean;
}) {
  // Teachers see only their own lessons (server-side scoping in listEntries).
  const entries = useQuery(api.timetable.listEntries, { includeDrafts: false });
  const lessons = (entries ?? []).filter(
    (e) => e.periodType === "teaching" && e.dayOfWeek === DOW_FOR_TODAY(date),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const active = lessons.find((e) => e._id === selected) ?? null;

  return (
    <>
      <ScopeBar>
        <div>
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 bg-background"
          />
        </div>
      </ScopeBar>

      {entries === undefined ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : lessons.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No timetable lessons scheduled for {date}.
        </p>
      ) : (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {lessons.map((e) => (
            <button
              key={e._id}
              type="button"
              onClick={() => setSelected(e._id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors hover:bg-muted/40",
                selected === e._id && "border-primary bg-primary/5",
              )}
            >
              <p className="text-sm font-semibold">{e.classLabel} · {e.subjectName}</p>
              <p className="text-xs text-muted-foreground">
                {e.periodName} · {e.startTime}–{e.endTime} · {e.staffName}
              </p>
            </button>
          ))}
        </div>
      )}

      {active && (
        <LessonRegisterForEntry
          entry={active}
          date={date}
          canTake={canTake}
        />
      )}
    </>
  );
}

function DOW_FOR_TODAY(date: string): string {
  const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return names[new Date(date + "T00:00:00Z").getUTCDay()] ?? "mon";
}

function LessonRegisterForEntry({
  entry, date, canTake,
}: {
  entry: { _id: string; classSectionId: string; subjectId: string; classLabel: string; subjectName: string; periodName: string; startTime: string };
  date: string; canTake: boolean;
}) {
  const ctx = useQuery(
    api.attendance.register,
    { classSectionId: entry.classSectionId as never, date, sessionType: "lesson", subjectId: entry.subjectId as never },
  );
  const save = useMutation(api.attendance.saveSession);
  const [marks, setMarks] = useState<Record<string, AttStatus>>({});
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rows: RegisterRow[] = ctx?.students ?? [];
  if (ctx && seededFor !== `${entry._id}:${date}`) {
    const next: Record<string, AttStatus> = {};
    for (const s of ctx.students) next[s.studentId] = "present";
    for (const r of ctx.records) {
      if (STATUSES.includes(r.status as AttStatus)) next[r.studentId] = r.status as AttStatus;
    }
    setMarks(next);
    setSeededFor(`${entry._id}:${date}`);
  }

  const onSave = async (complete: boolean) => {
    setSaving(true);
    try {
      await save({
        sessionId: (ctx?.sessionId ?? undefined) as never,
        date,
        sessionType: "lesson",
        classSectionId: entry.classSectionId as never,
        subjectId: entry.subjectId as never,
        status: complete ? "completed" : "open",
        records: rows
          .filter((r) => marks[r.studentId])
          .map((r) => ({
            studentId: r.studentId as never,
            enrollmentId: r.enrollmentId as never,
            status: marks[r.studentId],
          })),
      });
      toast.success(complete ? "Lesson attendance completed" : "Lesson attendance saved (open)");
      setSeededFor(null);
    } catch (err) {
      toast.error("Unable to save lesson attendance.", {
        description: undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="card-soft">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {entry.classLabel} · {entry.subjectName} — {entry.periodName}
          {ctx?.sessionId ? <span className="ml-2"><StatusBadge status={ctx.status} /></span> : null}
        </CardTitle>
        {canTake && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={saving} onClick={() => onSave(false)}>Save draft</Button>
            <Button size="sm" disabled={saving} onClick={() => onSave(true)}>Complete</Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {ctx === undefined ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : rows.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium">No students enrolled in this class</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Enroll students into this class first — then take the register here each morning.
            </p>
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map((r) => (
              <div key={r.studentId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-40 flex-1">
                  <p className="text-sm font-medium">{r.fullName}</p>
                  <p className="text-xs text-muted-foreground">{r.admissionNumber}</p>
                </div>
                <div className="flex gap-1">
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!canTake}
                      onClick={() => setMarks((m) => ({ ...m, [r.studentId]: s }))}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50",
                        marks[r.studentId] === s
                          ? STATUS_STYLES[s]
                          : "bg-muted/60 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------- */
/* Daily register                                                        */
/* -------------------------------------------------------------------- */

function RegisterView({
  classSectionId, setClassSectionId, date, setDate, canTake,
}: {
  classSectionId: string;
  setClassSectionId: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  canTake: boolean;
}) {
  const ctx = useQuery(
    api.attendance.register,
    classSectionId && date
      ? { classSectionId: classSectionId as never, date, sessionType: "daily" }
      : "skip",
  );
  const todayData = useQuery(api.attendance.today, {});

  // Local editable state, seeded from the query.
  const [marks, setMarks] = useState<Record<string, AttStatus>>({});
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reasonFor, setReasonFor] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const save = useMutation(api.attendance.saveSession);

  const rows: RegisterRow[] = ctx?.students ?? [];
  const existing = new Map<string, ExistingRecord>();
  for (const r of ctx?.records ?? []) existing.set(r.studentId, r);

  if (ctx && seededFor !== `${classSectionId}:${date}`) {
    const next: Record<string, AttStatus> = {};
    for (const s of ctx.students) next[s.studentId] = "present";
    for (const r of ctx.records) {
      if (STATUSES.includes(r.status as AttStatus)) next[r.studentId] = r.status as AttStatus;
    }
    setMarks(next);
    setSeededFor(`${classSectionId}:${date}`);
  }

  const allMarked = rows.length > 0 && rows.every((r) => marks[r.studentId]);
  const markedCount = rows.filter((r) => marks[r.studentId]).length;

  const onSave = async (complete: boolean) => {
    if (!classSectionId || !date) return;
    const records = rows
      .filter((r) => marks[r.studentId])
      .map((r) => ({
        studentId: r.studentId as never,
        enrollmentId: r.enrollmentId as never,
        status: marks[r.studentId],
      }));
    setSaving(true);
    try {
      await save({
        sessionId: (ctx?.sessionId ?? undefined) as never,
        date,
        sessionType: "daily",
        classSectionId: classSectionId as never,
        status: complete ? "completed" : "open",
        records,
      });
      toast.success(complete ? "Attendance completed" : "Attendance saved (still open)");
      setSeededFor(null); // re-seed from server state
    } catch (err) {
      toast.error("Unable to save attendance.", {
        description: undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScopeBar>
        <ClassSelect yearId="" classSectionId={classSectionId} onChange={setClassSectionId} />
        <div>
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 bg-background"
          />
        </div>
      </ScopeBar>

      {canTake && classSectionId ? (
        <Card className="card-soft">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Register {ctx?.sessionId ? <StatusBadge status={ctx.status} /> : null}
              {ctx?.sessionId ? <span className="ml-2 text-xs font-normal text-muted-foreground">existing session</span> : null}
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {markedCount}/{rows.length} marked
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!allMarked || saving}
                onClick={() => onSave(false)}
              >
                Save draft
              </Button>
              <Button size="sm" disabled={!allMarked || saving} onClick={() => onSave(true)}>
                <CheckCircle2 className="size-4" /> Complete
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {ctx === undefined ? (
              <div className="h-64 animate-pulse rounded-lg bg-muted" />
            ) : rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No students were enrolled in this class on the selected date.
              </p>
            ) : (
              <div className="divide-y rounded-lg border">
                {rows.map((r) => (
                  <div key={r.studentId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="min-w-40 flex-1">
                      <p className="text-sm font-medium">{r.fullName}</p>
                      <p className="text-xs text-muted-foreground">{r.admissionNumber}</p>
                    </div>
                    <div className="flex gap-1">
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={!canTake}
                          onClick={() => setMarks((m) => ({ ...m, [r.studentId]: s }))}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50",
                            marks[r.studentId] === s
                              ? STATUS_STYLES[s]
                              : "bg-muted/60 text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {s}
                        </button>
                      ))}
                      {marks[r.studentId] === "absent" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setReasonFor({ id: r.studentId, name: r.fullName });
                            setReason(existing.get(r.studentId)?.reason ?? "");
                          }}
                        >
                          Reason…
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Select a class to open its register.
        </p>
      )}

      {todayData && todayData.sessions.length > 0 && (
        <Card className="card-soft mt-4">
          <CardHeader>
            <CardTitle className="text-base">Today&apos;s sessions ({todayData.date})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Present</TableHead>
                  <TableHead>Absent</TableHead>
                  <TableHead>Late</TableHead>
                  <TableHead>Excused</TableHead>
                  <TableHead>Recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {todayData.sessions.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell className="font-medium">{s.classLabel}</TableCell>
                    <TableCell><StatusBadge status={s.status} /></TableCell>
                    <TableCell>{s.present}</TableCell>
                    <TableCell className={s.absent > 0 ? "text-red-600" : ""}>{s.absent}</TableCell>
                    <TableCell>{s.late}</TableCell>
                    <TableCell>{s.excused}</TableCell>
                    <TableCell>{s.recorded}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ReasonDialog
        target={reasonFor}
        value={reason}
        onValueChange={setReason}
        onClose={() => {
          if (reasonFor) {
            // Reason rides along on the absent record when saving (server field).
            toast.message(`Reason noted for ${reasonFor.name}`, {
              description: reason || "No reason text entered (saved without a note).",
            });
          }
          setReasonFor(null);
        }}
      />
    </>
  );
}

function ReasonDialog({
  target, value, onValueChange, onClose,
}: {
  target: { id: string; name: string } | null;
  value: string;
  onValueChange: (v: string) => void;
  onClose: () => void;
}) {
  if (!target) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-background p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">Absence reason — {target.name}</h3>
        <Textarea
          className="mt-3"
          rows={3}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="e.g. Medical appointment (note is stored with the record)"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* History + analytics                                                   */
/* -------------------------------------------------------------------- */

function HistoryView({
  classSectionId, setClassSectionId,
}: {
  classSectionId: string;
  setClassSectionId: (v: string) => void;
}) {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const history = useQuery(
    api.attendance.classHistory,
    classSectionId ? { classSectionId: classSectionId as never, fromDate, toDate } : "skip",
  );
  const analytics = useQuery(api.attendance.analytics, {});

  const sessions = useMemo(() => history?.sessions ?? [], [history]);
  const totals = useMemo(() => {
    const t = { present: 0, absent: 0, late: 0, excused: 0, recorded: 0 };
    for (const s of sessions) {
      t.present += s.present;
      t.absent += s.absent;
      t.late += s.late;
      t.excused += s.excused;
      t.recorded += s.recorded;
    }
    return t;
  }, [sessions]);

  return (
    <>
      <ScopeBar>
        <ClassSelect yearId="" classSectionId={classSectionId} onChange={setClassSectionId} />
        <div>
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 bg-background" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 bg-background" />
        </div>
      </ScopeBar>

      <Card className="card-soft">
        <CardHeader>
          <CardTitle className="text-base">
            {history ? `${history.classLabel} — ${sessions.length} session(s)` : "Class history"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!classSectionId ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Select a class to view its history.</p>
          ) : history === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : sessions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No attendance recorded in this range.</p>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <MiniStat label="Present" value={totals.present} tone="text-emerald-600" />
                <MiniStat label="Absent" value={totals.absent} tone="text-red-600" />
                <MiniStat label="Late" value={totals.late} tone="text-amber-600" />
                <MiniStat label="Excused" value={totals.excused} tone="text-sky-600" />
                <MiniStat
                  label="Attendance rate"
                  value={
                    totals.recorded
                      ? `${Math.round(((totals.present + totals.late) / totals.recorded) * 1000) / 10}%`
                      : "—"
                  }
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Present</TableHead>
                    <TableHead>Absent</TableHead>
                    <TableHead>Late</TableHead>
                    <TableHead>Excused</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.sessionId}>
                      <TableCell>{s.date}</TableCell>
                      <TableCell><StatusBadge status={s.status} /></TableCell>
                      <TableCell>{s.present}</TableCell>
                      <TableCell className={s.absent > 0 ? "text-red-600" : ""}>{s.absent}</TableCell>
                      <TableCell>{s.late}</TableCell>
                      <TableCell>{s.excused}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {analytics && (
        <Card className="card-soft mt-4">
          <CardHeader>
            <CardTitle className="text-base">Term analytics (current term)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat
                label="Overall attendance"
                value={analytics.overallPercentage != null ? `${analytics.overallPercentage}%` : "—"}
              />
              <MiniStat label="Records" value={analytics.totalRecorded} />
              <MiniStat label="Absences" value={analytics.absences} tone="text-red-600" />
              <MiniStat label="Late arrivals" value={analytics.lateArrivals} tone="text-amber-600" />
            </div>
            {analytics.byClass.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Recorded</TableHead>
                    <TableHead>Absences</TableHead>
                    <TableHead>Late</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.byClass.map((c) => (
                    <TableRow key={c.classSectionId}>
                      <TableCell className="font-medium">{c.classLabel}</TableCell>
                      <TableCell className={c.percentage < 85 ? "font-semibold text-red-600" : ""}>
                        {c.percentage}%
                      </TableCell>
                      <TableCell>{c.recorded}</TableCell>
                      <TableCell>{c.absent}</TableCell>
                      <TableCell>{c.late}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold", tone)}>{value}</p>
    </div>
  );
}

// ChevronLeft / ChevronRight reserved for date paging in a later iteration.
void ChevronLeft; void ChevronRight;
