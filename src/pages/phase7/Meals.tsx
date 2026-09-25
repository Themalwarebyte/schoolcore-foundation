import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UtensilsCrossed, ScanLine, Plus } from "lucide-react";

export default function Meals() {
  const [planOpen, setPlanOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const [planName, setPlanName] = useState("");
  const [planType, setPlanType] = useState("lunch");
  const [planCost, setPlanCost] = useState("");
  const [planDesc, setPlanDesc] = useState("");

  const [enrollPlanId, setEnrollPlanId] = useState("");
  const [enrollStudentId, setEnrollStudentId] = useState("");
  const [enrollYearId, setEnrollYearId] = useState("");
  const [subsidy, setSubsidy] = useState("");

  const [qrToken, setQrToken] = useState("");
  const [qrMealType, setQrMealType] = useState("lunch");

  const plans = useQuery(api.phase7.meals.listPlans, {});
  const enrollments = useQuery(api.phase7.meals.listMealEnrollments, {});
  const summary = useQuery(api.phase7.meals.consumptionSummary, {});
  const todayLog = useQuery(api.phase7.meals.consumptionForDate, {});
  const students = useQuery(api.students.list, {
    search: undefined, status: "active",
    paginationOpts: { numItems: 300, cursor: null },
  });
  const years = useQuery(api.academics.listYears, {});
  const currentYear = (years ?? []).find((y) => (y as { isCurrent?: boolean }).isCurrent) ?? (years ?? [])[(years ?? []).length - 1];

  const upsertPlan = useMutation(api.phase7.meals.upsertPlan);
  const enrollStudent2 = useMutation(api.phase7.meals.enrollStudent);
  const endEnrollment = useMutation(api.phase7.meals.endMealEnrollment);
  const recordByQr = useMutation(api.phase7.meals.recordConsumptionByQr);

  return (
    <>
      <PageHeader
        title="Meals"
        description="Meal plans, eligibility and daily consumption. The student QR ID doubles as a meal card — scans are validated server-side against active eligibility."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setQrOpen(true)}>
              <ScanLine className="size-4" /> QR meal scan
            </Button>
            <Button variant="outline" onClick={() => { setPlanName(""); setPlanCost(""); setPlanDesc(""); setPlanType("lunch"); setPlanOpen(true); }}>
              <Plus className="size-4" /> New plan
            </Button>
            <Button onClick={() => { setEnrollPlanId(""); setEnrollStudentId(""); setSubsidy(""); setEnrollOpen(true); }}>
              <UtensilsCrossed className="size-4" /> Enroll student
            </Button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {summary && [
            { label: "Eligible today", value: summary.eligible },
            { label: "Lunches", value: summary.lunch },
            { label: "Milk", value: summary.milk },
            { label: "Snacks", value: summary.snack },
          ].map((s) => (
            <Card key={s.label} className="card-soft">
              <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-semibold">{s.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <Card className="card-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Meal plans</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { key: "name", header: "Plan" },
                { key: "type", header: "Type" },
                { key: "cost", header: "Daily cost" },
                { key: "status", header: "Status" },
              ]}
              rows={(plans ?? []).map((p) => ({
                _id: p._id,
                name: p.name,
                type: <Badge variant="outline" className="capitalize">{p.planType.replace("_", " ")}</Badge>,
                cost: p.dailyCost,
                status: <Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge>,
              }))}
              loading={plans === undefined}
              empty={<><p className="text-sm font-medium">No meal plans</p><p className="text-xs text-muted-foreground">Create lunch, milk or snack plans to enroll students.</p></>}
              page={0}
              pageSize={10}
              onPageChange={() => undefined}
              hasNextPage={false}
            />
          </CardContent>
        </Card>

        <Card className="card-soft">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Eligibility (enrollments)</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { key: "student", header: "Student" },
                { key: "plan", header: "Plan" },
                { key: "period", header: "Start" },
                { key: "subsidy", header: "Subsidy" },
                { key: "status", header: "Status" },
                { key: "actions", header: "", className: "w-10" },
              ]}
              rows={(enrollments ?? []).map((e) => ({
                _id: e._id,
                student: e.studentName,
                plan: e.planName,
                period: e.startDate,
                subsidy: e.subsidyPercent !== null ? `${e.subsidyPercent}%` : "—",
                status: <Badge variant={e.status === "active" ? "default" : "secondary"}>{e.status}</Badge>,
                actions: e.status === "active" ? (
                  <Button size="sm" variant="outline" onClick={async () => {
                    try { await endEnrollment({ mealEnrollmentId: e._id as never, status: "ended" }); toast.success("Eligibility ended"); }
                    catch (err) { toast.error(friendlyError(err)); }
                  }}>End</Button>
                ) : null,
              }))}
              loading={enrollments === undefined}
              empty={<><p className="text-sm font-medium">No meal enrollments</p><p className="text-xs text-muted-foreground">Enroll students into meal plans to grant eligibility.</p></>}
              page={0}
              pageSize={15}
              onPageChange={() => undefined}
              hasNextPage={false}
            />
          </CardContent>
        </Card>

        <Card className="card-soft">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Today's consumption ({summary?.date ?? ""})</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { key: "student", header: "Student" },
                { key: "meal", header: "Meal" },
                { key: "via", header: "Recorded" },
                { key: "at", header: "Time" },
              ]}
              rows={(todayLog ?? []).map((c) => ({
                _id: c._id,
                student: c.studentName,
                meal: <Badge variant="outline" className="capitalize">{c.mealType}</Badge>,
                via: c.viaQr ? <span className="text-xs text-green-700">QR scan</span> : <span className="text-xs text-muted-foreground">Manual</span>,
                at: new Date(c.recordedAt).toLocaleTimeString(),
              }))}
              loading={todayLog === undefined}
              empty={<><p className="text-sm font-medium">No consumption recorded today</p><p className="text-xs text-muted-foreground">Use the QR meal scan or manual recording.</p></>}
              page={0}
              pageSize={15}
              onPageChange={() => undefined}
              hasNextPage={false}
            />
          </CardContent>
        </Card>
      </div>

      {/* Plan dialog */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New meal plan</DialogTitle>
            <DialogDescription>Lunch, milk, snack or full-board plan.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1"><Label>Name *</Label><Input value={planName} onChange={(e) => setPlanName(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={planType} onValueChange={setPlanType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lunch">Lunch</SelectItem>
                  <SelectItem value="milk">Milk</SelectItem>
                  <SelectItem value="snack">Snack</SelectItem>
                  <SelectItem value="full_board">Full board</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Daily cost</Label><Input type="number" value={planCost} onChange={(e) => setPlanCost(e.target.value)} /></div>
            <div className="space-y-1"><Label>Description</Label><Input value={planDesc} onChange={(e) => setPlanDesc(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanOpen(false)}>Cancel</Button>
            <Button
              disabled={!planName.trim() || !(Number(planCost) > 0)}
              onClick={async () => {
                try {
                  await upsertPlan({ name: planName.trim(), planType, dailyCost: Number(planCost), description: planDesc || undefined });
                  toast.success("Meal plan created"); setPlanOpen(false);
                } catch (e) { toast.error(friendlyError(e)); }
              }}
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enroll dialog */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll student in a meal plan</DialogTitle>
            <DialogDescription>Grants meal eligibility for the academic year.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Student *</Label>
              <Select value={enrollStudentId} onValueChange={setEnrollStudentId}>
                <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
                <SelectContent>
                  {((students as { page?: Array<{ _id: string; admissionNumber: string; firstName: string; lastName: string }> } | undefined)?.page ?? []).map((s) => (
                    <SelectItem key={s._id} value={s._id}>{s.admissionNumber} — {s.firstName} {s.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Plan *</Label>
              <Select value={enrollPlanId} onValueChange={setEnrollPlanId}>
                <SelectTrigger><SelectValue placeholder="Select plan" /></SelectTrigger>
                <SelectContent>
                  {(plans ?? []).filter((p) => p.status === "active").map((p) => (
                    <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Academic year</Label>
              <Select value={enrollYearId || currentYear?._id || ""} onValueChange={setEnrollYearId}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {(years ?? []).map((y) => <SelectItem key={y._id} value={y._id}>{y.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Subsidy % (sponsored plans)</Label><Input type="number" value={subsidy} onChange={(e) => setSubsidy(e.target.value)} placeholder="0" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            <Button
              disabled={!enrollStudentId || !enrollPlanId}
              onClick={async () => {
                try {
                  await enrollStudent2({
                    studentId: enrollStudentId as never,
                    planId: enrollPlanId as never,
                    academicYearId: (enrollYearId || currentYear?._id) as never,
                    startDate: new Date().toISOString().slice(0, 10),
                    subsidyPercent: subsidy ? Number(subsidy) : undefined,
                  });
                  toast.success("Student enrolled in meal plan");
                  setEnrollOpen(false);
                } catch (e) { toast.error(friendlyError(e)); }
              }}
            >Enroll</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR scan dialog */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>QR meal scan</DialogTitle>
            <DialogDescription>
              Scan or paste the student's QR token. Eligibility, duplicate consumption and school scope are validated server-side — no student data lives inside the QR itself.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1"><Label>QR token *</Label><Input value={qrToken} onChange={(e) => setQrToken(e.target.value)} placeholder="Paste scanned token" /></div>
            <div className="space-y-1">
              <Label>Meal</Label>
              <Select value={qrMealType} onValueChange={setQrMealType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lunch">Lunch</SelectItem>
                  <SelectItem value="milk">Milk</SelectItem>
                  <SelectItem value="snack">Snack</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQrOpen(false)}>Cancel</Button>
            <Button
              disabled={!qrToken.trim()}
              onClick={async () => {
                try {
                  await recordByQr({ token: qrToken.trim(), mealType: qrMealType });
                  toast.success(`${qrMealType} recorded`);
                  setQrToken("");
                } catch (e) { toast.error(friendlyError(e)); }
              }}
            >Record meal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

