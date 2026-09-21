import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/lib/status";
import { usePermissions } from "@/hooks/use-session";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClassSelect, ScopeBar, YearSelect } from "@/components/ops/Controls";
import { cn } from "@/lib/utils";
import { Plus, Send, Trash2 } from "lucide-react";

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
];

type Entry = {
  _id: string;
  dayOfWeek: string;
  periodId: string;
  periodName: string;
  periodType: string;
  startTime: string;
  endTime: string;
  displayOrder: number;
  classSectionId: string;
  classLabel: string;
  subjectName: string;
  subjectCode: string;
  staffId: string | null;
  staffName: string;
  roomName: string | null;
  status: string;
};

export default function Timetable() {
  const { can } = usePermissions();
  const [tab, setTab] = useState<"grid" | "periods" | "rooms">("grid");
  return (
    <div className="page-shell">
      <PageHeader
        title="Timetable"
        description="Weekly class schedule, periods and rooms."
      />
      <div className="mb-4 flex gap-2">
        {(["grid", "periods", "rooms"] as const).map((t) => (
          <Button
            key={t}
            variant={tab === t ? "default" : "outline"}
            size="sm"
            className="capitalize"
            onClick={() => setTab(t)}
          >
            {t === "grid" ? "Class grid" : t}
          </Button>
        ))}
      </div>
      {tab === "grid" && <GridView canManage={can("timetable.manage")} canPublish={can("timetable.publish")} />}
      {tab === "periods" && <PeriodsView canManage={can("timetable.manage")} />}
      {tab === "rooms" && <RoomsView canManage={can("timetable.manage")} />}
    </div>
  );
}

/* ----------------------------- Grid ---------------------------------- */

function GridView({ canManage, canPublish }: { canManage: boolean; canPublish: boolean }) {
  const [yearId, setYearId] = useState("");
  const [classSectionId, setClassSectionId] = useState("");
  const [teacherView, setTeacherView] = useState(false);
  const [includeDrafts, setIncludeDrafts] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const publish = useMutation(api.timetable.publishTimetable);

  const entries = useQuery(
    api.timetable.listEntries,
    { academicYearId: (yearId || undefined) as never, classSectionId: (teacherView ? undefined : (classSectionId || undefined)) as never, includeDrafts },
  );
  const periods = useQuery(api.timetable.listPeriods, {});

  // Group by row key: class grid → one row per class; teacher view → one row per teacher.
  const rows = new Map<string, { label: string; cells: Map<string, Entry> }>();
  for (const e of (entries ?? []) as Entry[]) {
    const rowKey = teacherView ? `t:${e.staffId ?? "—"}` : `c:${e.classSectionId}`;
    const rowLabel = teacherView ? e.staffName : e.classLabel;
    if (!rows.has(rowKey)) rows.set(rowKey, { label: rowLabel, cells: new Map() });
    rows.get(rowKey)!.cells.set(`${e.dayOfWeek}:${e.periodId}`, e);
  }
  const rowList = [...rows.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));

  const draftCount = (entries ?? []).filter((e) => e.status === "draft").length;

  return (
    <>
      <ScopeBar>
        <YearSelect yearId={yearId} onChange={(v) => { setYearId(v); setClassSectionId(""); }} />
        {teacherView ? (
          <div>
            <Label className="text-xs text-muted-foreground">Scope</Label>
            <p className="mt-1.5 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Whole-school teacher view — every teacher's weekly schedule.
            </p>
          </div>
        ) : (
          <ClassSelect yearId={yearId} classSectionId={classSectionId} onChange={setClassSectionId} allowAll />
        )}
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={teacherView}
              onChange={(e) => setTeacherView(e.target.checked)}
              className="size-4"
            />
            By teacher
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeDrafts}
              onChange={(e) => setIncludeDrafts(e.target.checked)}
              className="size-4"
            />
            Show drafts
          </label>
        </div>
        <div className="flex items-end justify-end gap-2">
          {canManage && !teacherView && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" /> Add lesson
            </Button>
          )}
          {canPublish && (
            <Button
              size="sm"
              variant="outline"
              disabled={draftCount === 0}
              onClick={async () => {
                try {
                  const count = await publish({ academicYearId: (yearId || undefined) as never });
                  toast.success(`Timetable published (${count} entries)`);
                } catch (err) {
                  toast.error("Unable to publish.", { description: err instanceof Error ? err.message : undefined });
                }
              }}
            >
              <Send className="size-4" /> Publish{draftCount ? ` (${draftCount})` : ""}
            </Button>
          )}
        </div>
      </ScopeBar>

      <Card className="card-soft overflow-x-auto">
        <CardContent className="pt-6">
          {entries === undefined || periods === undefined ? (
            <div className="h-64 animate-pulse rounded-lg bg-muted" />
          ) : rowList.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No timetable entries for this scope yet.
            </p>
          ) : (
            rowList.map(([rowKey, row]) => (
              <div key={rowKey} className="mb-6 last:mb-0">
                <p className="mb-2 text-sm font-semibold">
                  {teacherView ? "Teacher: " : ""}{row.label}
                </p>
                <table className="w-full min-w-[720px] border-separate border-spacing-1">
                  <thead>
                    <tr>
                      <th className="w-28 text-left text-xs font-medium text-muted-foreground">Period</th>
                      {DAYS.map((d) => (
                        <th key={d.key} className="text-xs font-medium text-muted-foreground">{d.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p) => (
                      <tr key={p._id}>
                        <td className={cn(
                          "rounded-md border px-2 py-1.5 text-xs",
                          p.periodType === "teaching" ? "bg-muted/40" : "bg-muted/20 text-muted-foreground",
                        )}>
                          <span className="font-medium">{p.name}</span>
                          <span className="block text-[10px] text-muted-foreground">
                            {p.startTime}–{p.endTime}
                          </span>
                        </td>
                        {DAYS.map((d) => {
                          const e = row.cells.get(`${d.key}:${p._id}`);
                          if (!e) {
                            return (
                              <td key={d.key} className="rounded-md border border-dashed bg-transparent p-1 text-center text-[10px] text-muted-foreground/50">
                                {p.periodType === "teaching" ? "—" : ""}
                              </td>
                            );
                          }
                          return (
                            <td key={d.key} className="p-0">
                              <div className={cn(
                                "h-full rounded-md border px-2 py-1.5 text-xs",
                                e.status === "draft" ? "border-dashed bg-amber-50 dark:bg-amber-950/30" : "bg-card",
                              )}>
                                <p className="font-medium leading-tight">{e.subjectName}</p>
                                {!teacherView && <p className="text-[10px] text-muted-foreground">{e.staffName}</p>}
                                {teacherView && <p className="text-[10px] text-muted-foreground">{e.classLabel}</p>}
                                {e.roomName && <p className="text-[10px] text-muted-foreground/80">{e.roomName}</p>}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <EntryDialog open={dialogOpen} onOpenChange={setDialogOpen} yearId={yearId} />
    </>
  );
}

function EntryDialog({
  open, onOpenChange, yearId,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; yearId: string;
}) {
  const periods = useQuery(api.timetable.listPeriods, open ? {} : "skip");
  const rooms = useQuery(api.timetable.listRooms, open ? {} : "skip");
  const options = useQuery(
    api.allocations.options,
    open ? { academicYearId: (yearId || undefined) as never } : "skip",
  );
  const allocations = useQuery(
    api.allocations.list,
    open && yearId ? { academicYearId: yearId as never } : "skip",
  );
  const create = useMutation(api.timetable.createEntry);
  const del = useMutation(api.timetable.deleteEntry);

  const [classSectionId, setClassSectionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [day, setDay] = useState("mon");
  const [roomId, setRoomId] = useState("");
  const [status, setStatus] = useState("draft");
  const [saving, setSaving] = useState(false);
  const gradeById = new Map((options?.classSections ?? []).map((c) => [c._id, c.gradeLevelId]));
  const grades = useQuery(api.academics.listGradeLevels, open ? {} : "skip");
  const gradeName = (id: string | null | undefined) =>
    (grades ?? []).find((g) => g._id === id)?.name ?? "";

  const classOptions = (options?.classSections ?? []).map((c) => ({
    _id: c._id,
    label: `${gradeName(gradeById.get(c._id))} · section`.trim(),
  }));

  const save = async () => {
    setSaving(true);
    try {
      await create({
        academicYearId: yearId as never,
        termId: undefined,
        dayOfWeek: day,
        periodId: periodId as never,
        classSectionId: classSectionId as never,
        subjectId: subjectId as never,
        roomId: (roomId && roomId !== "none" ? roomId : undefined) as never,
      });
      toast.success("Lesson added to timetable");
      onOpenChange(false);
    } catch (err) {
      toast.error("Unable to add lesson.", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const matchingAllocations = (allocations ?? []).filter(
    (a) => a.classSectionId === classSectionId &&
      (options?.subjects ?? []).some((s) => s._id === subjectId),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add lesson</DialogTitle>
          <DialogDescription>
            Teacher and class conflicts are validated on save.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Class *</Label>
            <Select value={classSectionId} onValueChange={setClassSectionId}>
              <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
              <SelectContent>
                {classOptions.map((c) => (
                  <SelectItem key={c._id} value={c._id}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Subject *</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
              <SelectContent>
                {options?.subjects.map((s) => (
                  <SelectItem key={s._id} value={s._id}>{s.name} ({s.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Day *</Label>
              <Select value={day} onValueChange={setDay}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d) => (
                    <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Period *</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger><SelectValue placeholder="Select period" /></SelectTrigger>
                <SelectContent>
                  {periods?.filter((p) => p.periodType === "teaching").map((p) => (
                    <SelectItem key={p._id} value={p._id}>{p.name} ({p.startTime})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Room</Label>
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {rooms?.map((r) => (
                    <SelectItem key={r._id} value={r._id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {classSectionId && subjectId && matchingAllocations.length === 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              No teacher is allocated to this class and subject yet — create an allocation first.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              disabled={!classSectionId || !subjectId || !periodId || !yearId || saving}
              onClick={save}
            >
              {saving ? "Adding…" : "Add lesson"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Periods --------------------------------- */

type PeriodRow = { name: string; startTime: string; endTime: string; periodType: string };

function PeriodsView({ canManage }: { canManage: boolean }) {
  const periods = useQuery(api.timetable.listPeriods, {});
  const save = useMutation(api.timetable.savePeriods);
  const [rows, setRows] = useState<PeriodRow[] | null>(null);

  const current: PeriodRow[] = (periods ?? []).map((p) => ({
    name: p.name, startTime: p.startTime, endTime: p.endTime, periodType: p.periodType,
  }));
  const value = rows ?? current;

  const update = (i: number, patch: Partial<PeriodRow>) => {
    setRows([...value].map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  return (
    <Card className="card-soft">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Daily period structure</CardTitle>
          <p className="text-xs text-muted-foreground">
            Saving replaces the whole set — existing lessons keep their period times by order.
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setRows([...value, { name: "", startTime: "08:00", endTime: "08:40", periodType: "teaching" }])}>
              <Plus className="size-4" /> Add period
            </Button>
            <Button
              size="sm"
              disabled={!rows}
              onClick={async () => {
                try {
                  await save({ periods: value });
                  toast.success("Periods saved");
                  setRows(null);
                } catch (err) {
                  toast.error("Unable to save periods.", { description: err instanceof Error ? err.message : undefined });
                }
              }}
            >
              Save changes
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {periods === undefined ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="space-y-2">
            {value.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <Input
                  className="w-40" placeholder="Name"
                  value={p.name} disabled={!canManage}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                <Input
                  type="time" className="w-32" value={p.startTime} disabled={!canManage}
                  onChange={(e) => update(i, { startTime: e.target.value })}
                />
                <Input
                  type="time" className="w-32" value={p.endTime} disabled={!canManage}
                  onChange={(e) => update(i, { endTime: e.target.value })}
                />
                <Select value={p.periodType} onValueChange={(v) => update(i, { periodType: v })} disabled={!canManage}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="teaching">Teaching</SelectItem>
                    <SelectItem value="break">Break</SelectItem>
                    <SelectItem value="lunch">Lunch</SelectItem>
                    <SelectItem value="assembly">Assembly</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                {canManage && (
                  <Button
                    variant="ghost" size="icon" className="size-8 text-destructive"
                    onClick={() => setRows(value.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------------- Rooms --------------------------------- */

function RoomsView({ canManage }: { canManage: boolean }) {
  const rooms = useQuery(api.timetable.listRooms, {});
  const create = useMutation(api.timetable.createRoom);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState("");

  return (
    <Card className="card-soft">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Rooms</CardTitle>
        {canManage && <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> Add room</Button>}
      </CardHeader>
      <CardContent>
        {rooms === undefined ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : rooms.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No rooms configured.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Capacity</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((r) => (
                <TableRow key={r._id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.code}</TableCell>
                  <TableCell>{r.capacity ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{r.roomType ?? "room"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add room</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Science Lab" />
            </div>
            <div className="grid gap-1.5">
              <Label>Code *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="LAB-1" />
            </div>
            <div className="grid gap-1.5">
              <Label>Capacity</Label>
              <Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!name.trim() || !code.trim()}
              onClick={async () => {
                try {
                  await create({
                    name: name.trim(),
                    code: code.trim(),
                    capacity: capacity ? Number(capacity) : undefined,
                    roomType: "classroom",
                  });
                  toast.success("Room added");
                  setOpen(false);
                  setName(""); setCode(""); setCapacity("");
                } catch (err) {
                  toast.error("Unable to add room.", { description: err instanceof Error ? err.message : undefined });
                }
              }}
            >
              Add room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
