import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Home, BedDouble, Plus, History } from "lucide-react";
import { Pill, statusTone, FormDialog, Field, EntityPicker } from "@/components/ops/shared";

export default function BoardingPage() {
  const dash = useQuery(api.boarding.boardingDashboard, {});
  const hostels = useQuery(api.boarding.listHostels, {});
  const allocations = useQuery(api.boarding.listAllocations, { activeOnly: true });
  const [tab, setTab] = useState<"hostels" | "allocations">("hostels");

  return (
    <div>
      <PageHeader title="Boarding" description="Hostels, rooms, beds and student allocation." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Hostels" value={dash?.hostelCount ?? "—"} icon={Home} />
        <MiniStat label="Occupied beds" value={dash ? `${dash.occupiedBeds}/${dash.totalBeds}` : "—"} icon={BedDouble} />
        <MiniStat label="Free beds" value={dash?.freeBeds ?? "—"} icon={BedDouble} tone="good" />
        <MiniStat label="Active allocations" value={dash?.activeAllocations ?? "—"} icon={Home} />
      </div>

      <div className="mb-3 flex gap-1 rounded-lg border p-1 text-sm w-fit">
        {(["hostels", "allocations"] as const).map((t) => (
          <button
            key={t}
            className={`rounded-md px-3 py-1.5 capitalize transition ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "hostels" ? <HostelsTab hostels={hostels ?? []} /> : <AllocationsTab allocations={allocations ?? []} />}
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone?: "good" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className={`mt-2 text-2xl font-bold tabular-nums ${tone === "good" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */

function HostelsTab({
  hostels,
}: {
  hostels: Array<{ _id: string; name: string; gender: string | null; warden: string | null; roomCount: number; bedCount: number; occupiedBeds: number; status: string }>;
}) {
  const createHostel = useMutation(api.boarding.createHostel);
  const addRoom = useMutation(api.boarding.addRoom);
  const [openRoom, setOpenRoom] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="boarding.manage">
          <FormDialog
            title="New hostel"
            trigger={<Button size="sm"><Plus />New hostel</Button>}
            onSubmit={async (data) => {
              await createHostel({ name: data.name, gender: data.gender || undefined });
              toast.success("Hostel created");
            }}
          >
            {(set) => (
              <>
                <Field label="Name"><Input onChange={(e) => set("name", e.target.value)} placeholder="e.g. Jacaranda House" /></Field>
                <Field label="Gender">
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("gender", e.target.value)} defaultValue="">
                    <option value="">— mixed —</option>
                    <option value="male">Boys</option>
                    <option value="female">Girls</option>
                  </select>
                </Field>
              </>
            )}
          </FormDialog>
        </Can>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {hostels.map((h) => (
          <Card key={h._id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{h.name}</CardTitle>
                <Pill tone={statusTone(h.status)}>{h.status}</Pill>
              </div>
              <p className="text-xs text-muted-foreground">
                {h.gender ? (h.gender === "male" ? "Boys" : "Girls") : "Mixed"} · Warden: {h.warden ?? "—"}
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {h.roomCount} room(s) · {h.bedCount} bed(s) · {h.occupiedBeds} occupied
              </p>
              <Can permission="boarding.manage">
                {openRoom === h._id ? (
                  <form
                    className="flex items-end gap-2 border-t pt-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      await addRoom({
                        hostelId: h._id as never,
                        roomNumber: String(form.get("roomNumber") ?? ""),
                        capacity: Number(form.get("capacity") ?? "0"),
                      });
                      setOpenRoom(null);
                      toast.success("Room and beds created");
                    }}
                  >
                    <Field label="Room no."><Input name="roomNumber" required className="h-8" /></Field>
                    <Field label="Beds"><Input name="capacity" type="number" min={1} required className="h-8 w-20" /></Field>
                    <Button size="sm" type="submit">Add</Button>
                  </form>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setOpenRoom(h._id)}><Plus className="h-4 w-4" />Add room</Button>
                )}
              </Can>
            </CardContent>
          </Card>
        ))}
        {hostels.length === 0 ? <p className="text-sm text-muted-foreground">No hostels yet.</p> : null}
      </div>
    </div>
  );
}

/* ================================================================== */

function AllocationsTab({ allocations }: { allocations: Array<{ _id: string; studentName: string; admissionNumber: string; hostel: string; room: string; bed: string; startDate: string; status: string }> }) {
  const allocate = useMutation(api.boarding.allocateBed);
  const deallocate = useMutation(api.boarding.deallocateBed);
  const rooms = useQuery(api.boarding.listRooms, {});
  const students = useQuery(api.students.list, { paginationOpts: { numItems: 300, cursor: null } });
  const [student, setStudent] = useState<{ id: string; label: string; sub?: string } | null>(null);
  const [roomId, setRoomId] = useState("");
  const [historyStudent, setHistoryStudent] = useState<string | null>(null);
  const history = useQuery(
    api.boarding.studentAllocationHistory,
    historyStudent ? { studentId: historyStudent as never } : "skip",
  );

  return (
    <div className="space-y-3">
      <Can permission="boarding.manage">
        <Card>
          <CardContent className="flex flex-wrap items-end gap-2 pt-5">
            <div className="min-w-56 flex-1">
              <Field label="Student">
                <EntityPicker
                  options={(students?.page ?? []).map((s) => ({ id: s._id, label: `${s.firstName} ${s.lastName}`, sub: s.admissionNumber }))}
                  value={student}
                  onChange={setStudent}
                  placeholder="Search students…"
                />
              </Field>
            </div>
            <Field label="Room (free bed auto-assigned)">
              <select className="h-9 rounded-md border bg-background px-3 text-sm" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">— choose —</option>
                {(rooms ?? []).filter((r) => r.freeBeds > 0).map((r) => (
                  <option key={r._id} value={r._id}>{r.hostel} / {r.roomNumber} ({r.freeBeds} free)</option>
                ))}
              </select>
            </Field>
            <Button
              onClick={async () => {
                if (!student || !roomId) {
                  toast.error("Choose a student and a room with a free bed");
                  return;
                }
                try {
                  await allocate({ studentId: student.id as never, roomId: roomId as never });
                  toast.success("Bed allocated");
                  setStudent(null);
                  setRoomId("");
                } catch (e) {
                  toast.error(friendlyError(e, "Allocation failed"));
                }
              }}
            >
              Allocate bed
            </Button>
          </CardContent>
        </Card>
      </Can>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead className="hidden sm:table-cell">Hostel</TableHead>
              <TableHead className="hidden md:table-cell">Room</TableHead>
              <TableHead>Bed</TableHead>
              <TableHead className="hidden lg:table-cell">Since</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {allocations.map((a) => (
              <TableRow key={a._id}>
                <TableCell className="font-medium">
                  {a.studentName}
                  <span className="block text-xs text-muted-foreground">{a.admissionNumber}</span>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{a.hostel}</TableCell>
                <TableCell className="hidden md:table-cell">{a.room}</TableCell>
                <TableCell className="font-mono text-xs">{a.bed}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs">{a.startDate}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setHistoryStudent(historyStudent === a._id ? null : a._id)}>
                      <History className="h-4 w-4" />
                    </Button>
                    {a.status === "active" ? (
                      <Can permission="boarding.manage">
                        <Button size="sm" variant="outline" onClick={async () => {
                          await deallocate({ allocationId: a._id as never });
                          toast.success("Allocation ended");
                        }}>End</Button>
                      </Can>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {allocations.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No active allocations.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </Card>
      {history && historyStudent ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Allocation history</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between">
                <span>{h.hostel} / {h.room} / {h.bed}</span>
                <span className="text-xs text-muted-foreground">
                  {h.startDate} → {h.endDate ?? "present"} · <Pill tone={h.status === "active" ? "green" : "slate"}>{h.status}</Pill>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
