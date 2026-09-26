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
import { Bus, Route as RouteIcon, MapPin, Users, Plus } from "lucide-react";
import { Pill, statusTone, FormDialog, Field, EntityPicker } from "@/components/ops/shared";

export default function TransportPage() {
  const dash = useQuery(api.transport.transportDashboard, {});
  const [tab, setTab] = useState<"routes" | "vehicles" | "drivers" | "assignments">("routes");
  const routes = useQuery(api.transport.listRoutes, {});
  const vehicles = useQuery(api.transport.listVehicles, {});
  const drivers = useQuery(api.transport.listDrivers, {});
  const assignments = useQuery(api.transport.listAssignments, {});

  return (
    <div>
      <PageHeader title="Transport" description="Vehicles, drivers, routes and student assignments." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Active vehicles" value={dash?.vehicles ?? "—"} icon={Bus} />
        <MiniStat label="Routes" value={dash?.routes ?? "—"} icon={RouteIcon} />
        <MiniStat label="Active drivers" value={dash?.activeDrivers ?? "—"} icon={MapPin} />
        <MiniStat label="Assigned students" value={dash?.assignedStudents ?? "—"} icon={Users} />
      </div>

      <div className="mb-3 flex gap-1 rounded-lg border p-1 text-sm w-fit">
        {(["routes", "vehicles", "drivers", "assignments"] as const).map((t) => (
          <button
            key={t}
            className={`rounded-md px-3 py-1.5 capitalize transition ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "routes" ? <RoutesTab routes={routes ?? []} /> : null}
      {tab === "vehicles" ? <VehiclesTab vehicles={vehicles ?? []} /> : null}
      {tab === "drivers" ? <DriversTab drivers={drivers ?? []} /> : null}
      {tab === "assignments" ? <AssignmentsTab assignments={assignments ?? []} /> : null}
    </div>
  );
}

function MiniStat({ label, value, icon: Icon }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */

function RoutesTab({ routes }: { routes: Array<{ _id: string; name: string; vehicle: { registrationNumber: string; capacity: number } | null; stops: Array<{ _id: string; stopName: string; pickupTime: string }>; assignedStudents: number; status: string }> }) {
  const createRoute = useMutation(api.transport.createRoute);
  const addStop = useMutation(api.transport.addRouteStop);
  const [openStop, setOpenStop] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="transport.manage">
          <FormDialog
            title="New route"
            trigger={<Button size="sm"><Plus />New route</Button>}
            onSubmit={async (data) => {
              await createRoute({ name: data.name, vehicleId: (data.vehicleId || undefined) as never });
              toast.success("Route created");
            }}
          >
            {(set) => <RouteFields vehicles={[]} set={set} />}
          </FormDialog>
        </Can>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {routes.map((r) => (
          <Card key={r._id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{r.name}</CardTitle>
                <Pill tone={statusTone(r.status)}>{r.status}</Pill>
              </div>
              <p className="text-xs text-muted-foreground">
                {r.vehicle ? `${r.vehicle.registrationNumber} · ${r.vehicle.capacity} seats` : "No vehicle assigned"} · {r.assignedStudents} student(s)
              </p>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {r.stops.map((s, i) => (
                <div key={s._id} className="flex items-center gap-2 text-sm">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{i + 1}</span>
                  <span>{s.stopName}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{s.pickupTime}</span>
                </div>
              ))}
              {r.stops.length === 0 ? <p className="text-xs text-muted-foreground">No stops yet.</p> : null}
              <Can permission="transport.manage">
                {openStop === r._id ? (
                  <form
                    className="flex items-end gap-2 border-t pt-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      await addStop({
                        routeId: r._id as never,
                        stopName: String(form.get("stopName") ?? ""),
                        pickupTime: String(form.get("pickupTime") ?? ""),
                      });
                      setOpenStop(null);
                      toast.success("Stop added");
                    }}
                  >
                    <Field label="Stop name"><Input name="stopName" required className="h-8" /></Field>
                    <Field label="Time"><Input name="pickupTime" placeholder="06:45" required className="h-8 w-24" /></Field>
                    <Button size="sm" type="submit">Add</Button>
                  </form>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setOpenStop(r._id)}><Plus className="h-4 w-4" />Add stop</Button>
                )}
              </Can>
            </CardContent>
          </Card>
        ))}
        {routes.length === 0 ? (
          <div className="rounded-xl border p-8 text-center">
            <p className="text-sm font-medium">No routes yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Create your first transport route, add its stops, then assign a vehicle.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RouteFields({ set }: { vehicles: unknown[]; set: (n: string, v: string) => void }) {
  return <Field label="Route name"><Input onChange={(e) => set("name", e.target.value)} placeholder="e.g. Kitengela Loop A" /></Field>;
}

/* ================================================================== */

function VehiclesTab({ vehicles }: { vehicles: Array<{ _id: string; registrationNumber: string; vehicleType: string | null; capacity: number; driver: string | null; status: string; routes: string[]; assignedStudents: number }> }) {
  const createVehicle = useMutation(api.transport.createVehicle);
  const updateVehicle = useMutation(api.transport.updateVehicle);
  const drivers = useQuery(api.transport.listDrivers, {});
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="transport.manage">
          <FormDialog
            title="New vehicle"
            trigger={<Button size="sm"><Plus />New vehicle</Button>}
            onSubmit={async (data) => {
              await createVehicle({
                registrationNumber: data.registrationNumber,
                vehicleType: data.vehicleType || undefined,
                capacity: Number(data.capacity),
                driverId: (data.driverId || undefined) as never,
              });
              toast.success("Vehicle added");
            }}
          >
            {(set) => (
              <>
                <Field label="Registration number"><Input onChange={(e) => set("registrationNumber", e.target.value)} placeholder="KDA 123A" /></Field>
                <Field label="Type"><Input onChange={(e) => set("vehicleType", e.target.value)} placeholder="Bus / Van" /></Field>
                <Field label="Capacity"><Input type="number" min={1} onChange={(e) => set("capacity", e.target.value)} /></Field>
                <Field label="Driver">
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("driverId", e.target.value)} defaultValue="">
                    <option value="">— none —</option>
                    {(drivers ?? []).map((d) => <option key={d._id} value={d._id}>{d.fullName}</option>)}
                  </select>
                </Field>
              </>
            )}
          </FormDialog>
        </Can>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Registration</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="text-right">Capacity</TableHead>
              <TableHead className="hidden md:table-cell">Driver</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.map((v) => (
              <TableRow key={v._id}>
                <TableCell className="font-medium">{v.registrationNumber}</TableCell>
                <TableCell className="hidden sm:table-cell">{v.vehicleType ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{v.capacity}</TableCell>
                <TableCell className="hidden md:table-cell">{v.driver ?? "—"}</TableCell>
                <TableCell><Pill tone={statusTone(v.status)}>{v.status}</Pill></TableCell>
                <TableCell className="text-right">
                  <Can permission="transport.manage">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={async () => {
                        await updateVehicle({ vehicleId: v._id as never, status: v.status === "maintenance" ? "active" : "maintenance" });
                        toast.success(v.status === "maintenance" ? "Vehicle back in service" : "Vehicle sent for maintenance");
                      }}>
                        {v.status === "maintenance" ? "Back in service" : "Maintenance"}
                      </Button>
                    </div>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/* ================================================================== */

function DriversTab({ drivers }: { drivers: Array<{ _id: string; fullName: string; linkedStaffName: string | null; phone: string | null; licenseNumber: string | null; licenseExpiry: string | null; isExternal: boolean; status: string; vehicles: string[] }> }) {
  const createDriver = useMutation(api.transport.createDriver);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="transport.manage">
          <FormDialog
            title="New driver"
            trigger={<Button size="sm"><Plus />New driver</Button>}
            onSubmit={async (data) => {
              await createDriver({
                fullName: data.fullName, phone: data.phone || undefined,
                licenseNumber: data.licenseNumber || undefined, licenseExpiry: data.licenseExpiry || undefined,
              });
              toast.success("Driver added");
            }}
          >
            {(set) => (
              <>
                <Field label="Full name"><Input onChange={(e) => set("fullName", e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Phone"><Input onChange={(e) => set("phone", e.target.value)} /></Field>
                  <Field label="License no."><Input onChange={(e) => set("licenseNumber", e.target.value)} /></Field>
                </div>
                <Field label="License expiry"><Input type="date" onChange={(e) => set("licenseExpiry", e.target.value)} /></Field>
              </>
            )}
          </FormDialog>
        </Can>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Driver</TableHead>
              <TableHead className="hidden sm:table-cell">Contact</TableHead>
              <TableHead className="hidden md:table-cell">License</TableHead>
              <TableHead className="hidden lg:table-cell">Vehicles</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drivers.map((d) => (
              <TableRow key={d._id}>
                <TableCell className="font-medium">
                  {d.fullName}
                  <span className="block text-xs text-muted-foreground">{d.isExternal ? "External" : d.linkedStaffName ? `Staff: ${d.linkedStaffName}` : "Staff"}</span>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{d.phone ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell text-xs">{d.licenseNumber ?? "—"}{d.licenseExpiry ? ` · exp ${d.licenseExpiry}` : ""}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs">{d.vehicles.join(", ") || "—"}</TableCell>
                <TableCell><Pill tone={statusTone(d.status)}>{d.status}</Pill></TableCell>
              </TableRow>
            ))}
            {drivers.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center"><p className="text-sm font-medium">No drivers yet</p><p className="mt-1 text-xs text-muted-foreground">Add your drivers, then assign them to routes.</p></TableCell></TableRow>
              ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/* ================================================================== */

function AssignmentsTab({ assignments }: { assignments: Array<{ _id: string; studentName: string; admissionNumber: string; routeName: string; stopName: string | null; pickupTime: string | null; vehicle: string | null; direction: string; status: string }> }) {
  const assign = useMutation(api.transport.assignStudent);
  const end = useMutation(api.transport.endAssignment);
  const routes = useQuery(api.transport.listRoutes, {});
  const students = useQuery(api.students.list, { paginationOpts: { numItems: 300, cursor: null } });
  const [student, setStudent] = useState<{ id: string; label: string; sub?: string } | null>(null);
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const selectedRoute = (routes ?? []).find((r) => r._id === routeId);

  return (
    <div className="space-y-3">
      <Can permission="transport.manage">
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
            <Field label="Route">
              <select className="h-9 rounded-md border bg-background px-3 text-sm" value={routeId} onChange={(e) => { setRouteId(e.target.value); setStopId(""); }}>
                <option value="">— choose —</option>
                {(routes ?? []).map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Stop">
              <select className="h-9 rounded-md border bg-background px-3 text-sm" value={stopId} onChange={(e) => setStopId(e.target.value)} disabled={!selectedRoute}>
                <option value="">— none —</option>
                {(selectedRoute?.stops ?? []).map((s) => <option key={s._id} value={s._id}>{s.stopName} ({s.pickupTime})</option>)}
              </select>
            </Field>
            <Button
              onClick={async () => {
                if (!student || !routeId) {
                  toast.error("Choose a student and a route");
                  return;
                }
                try {
                  await assign({ studentId: student.id as never, routeId: routeId as never, stopId: (stopId || undefined) as never });
                  toast.success("Student assigned to route");
                  setStudent(null);
                  setRouteId("");
                  setStopId("");
                } catch (e) {
                  toast.error(friendlyError(e, "Assignment failed"));
                }
              }}
            >
              Assign
            </Button>
          </CardContent>
        </Card>
      </Can>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead className="hidden sm:table-cell">Route</TableHead>
              <TableHead className="hidden md:table-cell">Stop</TableHead>
              <TableHead className="hidden lg:table-cell">Vehicle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((a) => (
              <TableRow key={a._id}>
                <TableCell className="font-medium">{a.studentName}<span className="block text-xs text-muted-foreground">{a.admissionNumber}</span></TableCell>
                <TableCell className="hidden sm:table-cell">{a.routeName}</TableCell>
                <TableCell className="hidden md:table-cell">{a.stopName ? `${a.stopName} (${a.pickupTime})` : "—"}</TableCell>
                <TableCell className="hidden lg:table-cell">{a.vehicle ?? "—"}</TableCell>
                <TableCell><Pill tone={statusTone(a.status)}>{a.status}</Pill></TableCell>
                <TableCell className="text-right">
                  {a.status === "active" ? (
                    <Can permission="transport.manage">
                      <Button size="sm" variant="outline" onClick={async () => {
                        await end({ assignmentId: a._id as never });
                        toast.success("Assignment ended");
                      }}>End</Button>
                    </Can>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {assignments.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center"><p className="text-sm font-medium">No transport assignments yet</p><p className="mt-1 text-xs text-muted-foreground">Assign students with a transport fee item to a route and vehicle.</p></TableCell></TableRow>
              ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
