import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Briefcase, CalendarClock, Building2, FileText, Check, X, Plus } from "lucide-react";
import { StatCard, StatGrid, Pill, statusTone, FormDialog, Field } from "@/components/ops/shared";
import { EntityPicker } from "@/components/ops/shared";

type StaffRow = { id: string; label: string; sub?: string };

export default function HRPage() {
  const [tab, setTab] = useState("overview");

  return (
    <div>
      <PageHeader
        title="Human Resources"
        description="Employee profiles, contracts, documents and leave management."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab onGoto={setTab} /></TabsContent>
        <TabsContent value="employees"><EmployeesTab /></TabsContent>
        <TabsContent value="contracts"><ContractsTab /></TabsContent>
        <TabsContent value="leave"><LeaveTab /></TabsContent>
        <TabsContent value="departments"><DepartmentsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ================================================================== */

function OverviewTab({ onGoto }: { onGoto: (t: string) => void }) {
  const dash = useQuery(api.hr.hrDashboard, {});
  const cards = [
    { label: "Active employees", value: dash?.totalEmployees ?? "—", icon: Users, tab: "employees" },
    { label: "Active contracts", value: dash?.activeContracts ?? "—", icon: Briefcase, tab: "contracts" },
    { label: "Pending leave", value: dash?.pendingLeave ?? "—", icon: CalendarClock, tab: "leave" },
    { label: "Departments", value: dash?.departmentCount ?? "—", icon: Building2, tab: "departments" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="cursor-pointer transition hover:border-foreground/20" onClick={() => onGoto(c.tab)}>
            <CardContent className="pt-5">
              <c.icon className="h-4 w-4 text-muted-foreground" />
              <p className="mt-2 text-3xl font-bold tabular-nums">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {dash && (dash.staffWithoutHrProfile > 0 || dash.expiringContracts > 0) ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Needs attention</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            {dash.staffWithoutHrProfile > 0 ? (
              <p>{dash.staffWithoutHrProfile} active staff member(s) have no HR profile yet.</p>
            ) : null}
            {dash.expiringContracts > 0 ? (
              <p>{dash.expiringContracts} active contract(s) end this year.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/* ================================================================== */

function EmployeesTab() {
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("all");
  const employees = useQuery(api.hr.listEmployees, { search, departmentId: dept });
  const departments = useQuery(api.hr.listDepartments, {});
  const staffList = useQuery(api.staff.list, {
    search: "", status: "all", department: "all",
    paginationOpts: { numItems: 200, cursor: null },
  });
  const createEmployee = useMutation(api.hr.createEmployee);

  const availableStaff: StaffRow[] = (staffList?.page ?? []).map((s) => ({
    id: s._id, label: `${s.firstName} ${s.lastName}`.trim(), sub: s.employeeNumber,
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…" className="max-w-xs" />
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
          aria-label="Filter by department"
        >
          <option value="all">All departments</option>
          {(departments ?? []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
        </select>
        <Can permission="employees.create">
          <FormDialog
            title="New employee profile"
            trigger={<Button size="sm"><Plus />New profile</Button>}
            onSubmit={async (data) => {
              if (!data.staffId) throw new Error("Choose a staff member.");
              await createEmployee({
                staffId: data.staffId as never,
                departmentId: (data.departmentId || undefined) as never,
                jobTitle: data.jobTitle || undefined,
                hireDate: data.hireDate || undefined,
                qualifications: data.qualifications || undefined,
                emergencyContactName: data.emergencyContactName || undefined,
                emergencyContactPhone: data.emergencyContactPhone || undefined,
              });
              toast.success("Employee profile created");
            }}
          >
            {(set) => <EmployeeForm departments={departments ?? []} availableStaff={availableStaff} set={set} />}
          </FormDialog>
        </Can>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Employee #</TableHead>
              <TableHead className="hidden md:table-cell">Department</TableHead>
              <TableHead className="hidden md:table-cell">Title</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(employees ?? []).map((e) => (
              <TableRow key={e._id}>
                <TableCell className="font-medium">{e.name}</TableCell>
                <TableCell className="hidden sm:table-cell">{e.employeeNumber}</TableCell>
                <TableCell className="hidden md:table-cell">{e.department ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell">{e.jobTitle ?? "—"}</TableCell>
                <TableCell><Pill tone={statusTone(e.status)}>{e.status}</Pill></TableCell>
              </TableRow>
            ))}
            {employees && employees.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No employee profiles yet.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function EmployeeForm({
  departments, availableStaff, set,
}: {
  departments: Array<{ _id: string; name: string }>;
  availableStaff: StaffRow[];
  set: (name: string, value: string) => void;
}) {
  const [staff, setStaff] = useState<StaffRow | null>(null);
  return (
    <>
      <Field label="Staff member">
        <EntityPicker
          options={availableStaff}
          value={staff}
          onChange={(o) => {
            setStaff(o);
            set("staffId", o?.id ?? "");
          }}
          placeholder="Search staff…"
        />
      </Field>
      <Field label="Department">
        <select
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          onChange={(e) => set("departmentId", e.target.value)}
          defaultValue=""
        >
          <option value="">— none —</option>
          {departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Job title">
          <Input onChange={(e) => set("jobTitle", e.target.value)} placeholder="e.g. Senior Teacher" />
        </Field>
        <Field label="Hire date">
          <Input type="date" onChange={(e) => set("hireDate", e.target.value)} />
        </Field>
      </div>
      <Field label="Qualifications">
        <Textarea rows={2} onChange={(e) => set("qualifications", e.target.value)} placeholder="Degrees, certifications…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Emergency contact">
          <Input onChange={(e) => set("emergencyContactName", e.target.value)} placeholder="Name" />
        </Field>
        <Field label="Emergency phone">
          <Input onChange={(e) => set("emergencyContactPhone", e.target.value)} placeholder="Phone" />
        </Field>
      </div>
    </>
  );
}

/* ================================================================== */

function ContractsTab() {
  const contracts = useQuery(api.hr.listAllContracts, {});
  const employees = useQuery(api.hr.listEmployees, { search: "" });
  const updateStatus = useMutation(api.hr.updateContractStatus);
  const createContract = useMutation(api.hr.createContract);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="contracts.manage">
          <FormDialog
            title="New contract"
            trigger={<Button size="sm"><Plus />New contract</Button>}
            onSubmit={async (data) => {
              if (!data.employeeId) throw new Error("Choose an employee.");
              await createContract({
                employeeId: data.employeeId as never,
                contractType: data.contractType,
                startDate: data.startDate,
                endDate: data.endDate || undefined,
              });
              toast.success("Contract created (draft) — activate it to assign salary");
            }}
          >
            {(set) => <ContractForm employees={employees ?? []} set={set} />}
          </FormDialog>
        </Can>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="hidden md:table-cell">Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(contracts ?? []).map((c) => (
              <TableRow key={c._id}>
                <TableCell className="font-medium">{c.contractNumber}<span className="block text-xs text-muted-foreground">{c.employeeName}</span></TableCell>
                <TableCell className="hidden capitalize sm:table-cell">{c.contractType.replace("_", " ")}</TableCell>
                <TableCell className="hidden md:table-cell text-xs">{c.startDate} → {c.endDate ?? "—"}</TableCell>
                <TableCell><Pill tone={statusTone(c.status)}>{c.status}</Pill></TableCell>
                <TableCell className="text-right">
                  <Can permission="contracts.manage">
                    <div className="flex justify-end gap-1">
                      {c.status === "draft" ? (
                        <Button size="sm" variant="outline" onClick={async () => {
                          await updateStatus({ contractId: c._id as never, status: "active" });
                          toast.success("Contract activated");
                        }}>Activate</Button>
                      ) : null}
                      {c.status === "active" ? (
                        <Button size="sm" variant="outline" onClick={async () => {
                          await updateStatus({ contractId: c._id as never, status: "terminated" });
                          toast.success("Contract terminated");
                        }}>Terminate</Button>
                      ) : null}
                    </div>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
            {contracts && contracts.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No contracts yet.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function ContractForm({
  employees, set,
}: {
  employees: Array<{ _id: string; name: string; employeeNumber: string }>;
  set: (name: string, value: string) => void;
}) {
  return (
    <>
      <Field label="Employee">
        <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("employeeId", e.target.value)} defaultValue="">
          <option value="">— choose —</option>
          {employees.map((e) => <option key={e._id} value={e._id}>{e.name} ({e.employeeNumber})</option>)}
        </select>
      </Field>
      <Field label="Contract type">
        <select className="h-9 w-full rounded-md border bg-background px-3 text-sm capitalize" onChange={(e) => set("contractType", e.target.value)} defaultValue="permanent">
          <option value="probation">Probation</option>
          <option value="fixed_term">Fixed term</option>
          <option value="permanent">Permanent</option>
          <option value="internship">Internship</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date"><Input type="date" onChange={(e) => set("startDate", e.target.value)} /></Field>
        <Field label="End date (optional)"><Input type="date" onChange={(e) => set("endDate", e.target.value)} /></Field>
      </div>
    </>
  );
}

/* ================================================================== */

function LeaveTab() {
  const [statusFilter, setStatusFilter] = useState("all");
  const requests = useQuery(api.hr.listLeaveRequests, { status: statusFilter });
  const leaveTypes = useQuery(api.hr.listLeaveTypes, {});
  const balances = useQuery(api.hr.leaveBalances, {});
  const staffList = useQuery(api.staff.list, {
    search: "", status: "all", department: "all",
    paginationOpts: { numItems: 200, cursor: null },
  });
  const requestLeave = useMutation(api.hr.requestLeave);
  const decideLeave = useMutation(api.hr.decideLeaveRequest);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm" aria-label="Filter leave status">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <Can permission="leave.view">
            <FormDialog
              title="Request leave"
              trigger={<Button size="sm"><Plus />Request leave</Button>}
              onSubmit={async (data) => {
                if (!data.leaveTypeId || !data.staffId) throw new Error("Choose staff and leave type.");
                await requestLeave({
                  staffId: data.staffId as never,
                  leaveTypeId: data.leaveTypeId as never,
                  startDate: data.startDate,
                  endDate: data.endDate,
                  reason: data.reason || undefined,
                });
                toast.success("Leave requested");
              }}
            >
              {(set) => (
                <>
                  <Field label="Staff member">
                    <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("staffId", e.target.value)} defaultValue="">
                      <option value="">— choose —</option>
                      {(staffList?.page ?? []).map((s) => (
                        <option key={s._id} value={s._id}>{s.firstName} {s.lastName}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Leave type">
                    <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("leaveTypeId", e.target.value)} defaultValue="">
                      <option value="">— choose —</option>
                      {(leaveTypes ?? []).map((t) => <option key={t._id} value={t._id}>{t.name} ({t.annualDays}d/yr)</option>)}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From"><Input type="date" onChange={(e) => set("startDate", e.target.value)} /></Field>
                    <Field label="To"><Input type="date" onChange={(e) => set("endDate", e.target.value)} /></Field>
                  </div>
                  <Field label="Reason"><Textarea rows={2} onChange={(e) => set("reason", e.target.value)} /></Field>
                </>
              )}
            </FormDialog>
          </Can>
        </div>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(requests ?? []).map((l) => (
                <TableRow key={l._id}>
                  <TableCell className="font-medium">{l.staffName}<span className="block text-xs text-muted-foreground">{l.days} day{l.days === 1 ? "" : "s"}</span></TableCell>
                  <TableCell className="hidden sm:table-cell">{l.leaveTypeName}</TableCell>
                  <TableCell className="text-xs">{l.startDate} → {l.endDate}</TableCell>
                  <TableCell><Pill tone={statusTone(l.status)}>{l.status}</Pill></TableCell>
                  <TableCell className="text-right">
                    {l.status === "pending" ? (
                      <Can permission="leave.approve">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={async () => {
                            await decideLeave({ leaveRequestId: l._id as never, decision: "approved" });
                            toast.success("Leave approved");
                          }}><Check className="h-4 w-4" /></Button>
                          <Button size="sm" variant="outline" onClick={async () => {
                            await decideLeave({ leaveRequestId: l._id as never, decision: "rejected", decisionNote: "Rejected via dashboard" });
                            toast.success("Leave rejected");
                          }}><X className="h-4 w-4" /></Button>
                        </div>
                      </Can>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {requests && requests.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No leave requests.</TableCell></TableRow>
              ) : null}
            </TableBody>
          </Table>
        </Card>
      </div>
      <div className="space-y-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CalendarClock className="h-4 w-4" />My leave balances</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(balances ?? []).map((b) => (
              <div key={b.leaveTypeId} className="flex items-center justify-between text-sm">
                <span>{b.name}</span>
                <span className="tabular-nums text-muted-foreground">{b.remaining} / {b.annualDays} left</span>
              </div>
            ))}
            {balances && balances.length === 0 ? <p className="text-sm text-muted-foreground">No leave types configured.</p> : null}
          </CardContent>
        </Card>
        <Can permission="leave.manage">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" />Leave types</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(leaveTypes ?? []).map((t) => (
                <div key={t._id} className="flex items-center justify-between text-sm">
                  <span>{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.paid ? "Paid" : "Unpaid"} · {t.annualDays}d</span>
                </div>
              ))}
              <LeaveTypeDialog />
            </CardContent>
          </Card>
        </Can>
      </div>
    </div>
  );
}

function LeaveTypeDialog() {
  const createLeaveType = useMutation(api.hr.createLeaveType);
  return (
    <FormDialog
      title="New leave type"
      trigger={<Button size="sm" variant="outline" className="w-full"><Plus />Add leave type</Button>}
      onSubmit={async (data) => {
        await createLeaveType({
          name: data.name, annualDays: Number(data.annualDays), paid: data.paid === "yes",
        });
        toast.success("Leave type created");
      }}
    >
      {(set) => (
        <>
          <Field label="Name"><Input onChange={(e) => set("name", e.target.value)} placeholder="e.g. Compassionate leave" /></Field>
          <Field label="Annual days"><Input type="number" min={1} onChange={(e) => set("annualDays", e.target.value)} /></Field>
          <Field label="Paid?">
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("paid", e.target.value)} defaultValue="yes">
              <option value="yes">Paid</option>
              <option value="no">Unpaid</option>
            </select>
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/* ================================================================== */

function DepartmentsTab() {
  const departments = useQuery(api.hr.listDepartments, {});
  const createDepartment = useMutation(api.hr.createDepartment);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="hr.manage">
          <FormDialog
            title="New department"
            trigger={<Button size="sm"><Plus />New department</Button>}
            onSubmit={async (data) => {
              await createDepartment({ name: data.name, description: data.description || undefined });
              toast.success("Department created");
            }}
          >
            {(set) => (
              <>
                <Field label="Name"><Input onChange={(e) => set("name", e.target.value)} placeholder="e.g. Transport" /></Field>
                <Field label="Description"><Textarea rows={2} onChange={(e) => set("description", e.target.value)} /></Field>
              </>
            )}
          </FormDialog>
        </Can>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(departments ?? []).map((d) => (
          <Card key={d._id}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <p className="font-medium">{d.name}</p>
                <Pill tone={statusTone(d.status)}>{d.status}</Pill>
              </div>
              {d.description ? <p className="mt-1 text-xs text-muted-foreground">{d.description}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">{d.employeeCount} employee(s)</p>
            </CardContent>
          </Card>
        ))}
        {departments && departments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No departments yet.</p>
        ) : null}
      </div>
    </div>
  );
}
