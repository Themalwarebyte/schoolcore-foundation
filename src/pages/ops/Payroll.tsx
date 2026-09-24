import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Wallet, BadgeDollarSign, Users, ArrowRight, Plus } from "lucide-react";
import { Pill, statusTone, FormDialog, Field, EmptyState } from "@/components/ops/shared";
import { usePermissions } from "@/hooks/use-session";

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function PayrollPage() {
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const runs = useQuery(api.payroll.listPayrollRuns, {});
  const structures = useQuery(api.payroll.listSalaryStructures, {});
  const mine = useQuery(api.payroll.myPayslips, {});
  const { can } = usePermissions();

  const currentRun = selectedRun ?? runs?.[0]?._id ?? null;

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Salary structures, payroll runs and payslips — connected to the general ledger."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <RunSection
            runs={runs ?? []}
            currentRun={currentRun}
            onSelect={setSelectedRun}
            canManage={can("payroll.manage")}
          />
          <StructuresSection structures={structures ?? []} canManage={can("payroll.manage")} />
        </div>
        <MyPayslips mine={mine} canView={can("payroll.view")} />
      </div>
    </div>
  );
}

/* ================================================================== */

function RunSection({
  runs, currentRun, onSelect, canManage,
}: {
  runs: Array<{
    _id: string; runNumber: string; periodLabel: string; status: string;
    totalGross: number; totalDeductions: number; totalNet: number; employeeCount: number;
  }>;
  currentRun: string | null;
  onSelect: (id: string) => void;
  canManage: boolean;
}) {
  const createRun = useMutation(api.payroll.createPayrollRun);
  const advance = useMutation(api.payroll.advancePayrollRun);
  const detail = useQuery(api.payroll.getPayrollRun, currentRun ? { runId: currentRun as never } : "skip");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" />Payroll runs</CardTitle>
        {canManage ? (
          <FormDialog
            title="New payroll run"
            trigger={<Button size="sm"><Plus />New run</Button>}
            onSubmit={async (data) => {
              await createRun({ periodYear: Number(data.periodYear), periodMonth: Number(data.periodMonth) });
              toast.success("Payroll run drafted");
            }}
          >
            {(set) => (
              <>
                <Field label="Month">
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("periodMonth", e.target.value)} defaultValue="">
                    <option value="">— choose —</option>
                    {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Year"><Input type="number" onChange={(e) => set("periodYear", e.target.value)} placeholder="2026" /></Field>
              </>
            )}
          </FormDialog>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {runs.length === 0 ? (
          <EmptyState icon={Wallet} title="No payroll runs yet" hint="Create a run to generate payslips for all active employees." />
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {runs.slice(0, 6).map((r) => (
                <button
                  key={r._id}
                  onClick={() => onSelect(r._id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${
                    currentRun === r._id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {r.periodLabel} · {r.status}
                </button>
              ))}
            </div>
            {detail ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat label="Employees" value={detail.run.employeeCount} />
                  <MiniStat label="Gross" value={money(detail.run.totalGross)} />
                  <MiniStat label="Deductions" value={money(detail.run.totalDeductions)} />
                  <MiniStat label="Net pay" value={money(detail.run.totalNet)} strong />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="hidden sm:table-cell">Gross</TableHead>
                      <TableHead className="hidden sm:table-cell">Deductions</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.payslips.map((p) => (
                      <TableRow key={p._id}>
                        <TableCell className="font-medium">{p.staffName}<span className="block text-xs text-muted-foreground">{p.employeeNumber}</span></TableCell>
                        <TableCell className="hidden sm:table-cell tabular-nums">{money(p.grossPay)}</TableCell>
                        <TableCell className="hidden sm:table-cell tabular-nums">{money(p.totalDeductions)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{money(p.netPay)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {canManage && detail.run.status !== "paid" ? (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={async () => {
                        await advance({ runId: detail.run._id as never });
                        toast.success(
                          detail.run.status === "approved"
                            ? "Payroll marked paid and posted to the ledger"
                            : `Moved to ${detail.run.status === "draft" ? "review" : "approved"}`,
                        );
                      }}
                    >
                      {detail.run.status === "draft" ? "Submit for review" : detail.run.status === "review" ? "Approve" : "Mark paid (ledger)"}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, strong }: { label: string; value: string | number; strong?: boolean }) {
  return (
    <div className="rounded-lg border p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${strong ? "text-lg font-bold" : "text-sm font-semibold"}`}>{value}</p>
    </div>
  );
}

/* ================================================================== */

function StructuresSection({
  structures, canManage,
}: {
  structures: Array<{
    _id: string; name: string; basicSalary: number;
    components: Array<{ _id: string; componentType: string; name: string; calculation: string; amount: number }>;
  }>;
  canManage: boolean;
}) {
  const createStructure = useMutation(api.payroll.createSalaryStructure);
  const addComponent = useMutation(api.payroll.addSalaryComponent);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-2"><BadgeDollarSign className="h-4 w-4" />Salary structures</CardTitle>
        {canManage ? (
          <FormDialog
            title="New salary structure"
            trigger={<Button size="sm" variant="outline"><Plus />New structure</Button>}
            onSubmit={async (data) => {
              await createStructure({ name: data.name, basicSalary: Number(data.basicSalary) });
              toast.success("Salary structure created");
            }}
          >
            {(set) => (
              <>
                <Field label="Name"><Input onChange={(e) => set("name", e.target.value)} placeholder="e.g. Teacher Scale A" /></Field>
                <Field label="Basic salary"><Input type="number" onChange={(e) => set("basicSalary", e.target.value)} /></Field>
              </>
            )}
          </FormDialog>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {structures.length === 0 ? (
          <p className="text-sm text-muted-foreground">No salary structures yet.</p>
        ) : (
          structures.map((s) => (
            <div key={s._id} className="rounded-lg border">
              <button
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm"
                onClick={() => setExpanded(expanded === s._id ? null : s._id)}
              >
                <span className="font-medium">{s.name}</span>
                <span className="tabular-nums text-muted-foreground">Basic {money(s.basicSalary)} · {s.components.length} component(s)</span>
              </button>
              {expanded === s._id ? (
                <div className="space-y-1 border-t px-3 py-2 text-sm">
                  {s.components.map((c) => (
                    <div key={c._id} className="flex items-center justify-between">
                      <span>
                        <Pill tone={c.componentType === "earning" ? "green" : "red"}>{c.componentType}</Pill>{" "}
                        {c.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {c.calculation === "percentage_of_basic" ? `${c.amount}% basic` : money(c.amount)}
                      </span>
                    </div>
                  ))}
                  {canManage ? (
                    <FormDialog
                      title={`Add component — ${s.name}`}
                      trigger={<Button size="sm" variant="outline" className="mt-1 w-full"><Plus />Add earning / deduction</Button>}
                      onSubmit={async (data) => {
                        await addComponent({
                          salaryStructureId: s._id as never,
                          componentType: data.componentType as "earning" | "deduction",
                          name: data.name,
                          calculation: data.calculation as "fixed_amount" | "percentage_of_basic",
                          amount: Number(data.amount),
                        });
                        toast.success("Component added");
                      }}
                    >
                      {(set) => (
                        <>
                          <Field label="Kind">
                            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("componentType", e.target.value)} defaultValue="earning">
                              <option value="earning">Earning (allowance)</option>
                              <option value="deduction">Deduction</option>
                            </select>
                          </Field>
                          <Field label="Name"><Input onChange={(e) => set("name", e.target.value)} placeholder="e.g. Housing allowance / Tax" /></Field>
                          <Field label="Calculation">
                            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("calculation", e.target.value)} defaultValue="fixed_amount">
                              <option value="fixed_amount">Fixed amount</option>
                              <option value="percentage_of_basic">% of basic salary</option>
                            </select>
                          </Field>
                          <Field label="Amount"><Input type="number" onChange={(e) => set("amount", e.target.value)} /></Field>
                        </>
                      )}
                    </FormDialog>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/* ================================================================== */

interface MyPayslip {
  _id: string; basicSalary: number; grossPay: number; totalDeductions: number; netPay: number;
  lines: Array<{ name: string; componentType: string; amount: number }>; generatedAt: number;
}

function MyPayslips({
  mine, canView,
}: {
  mine:
    | { isEmployee: boolean; payslips: MyPayslip[]; runById: Record<string, { periodLabel: string; status: string; runNumber: string }> }
    | undefined;
  canView: boolean;
}) {
  if (!canView) return null;
  return (
    <Card className="self-start">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />My payslips</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {mine === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !mine.isEmployee ? (
          <p className="text-sm text-muted-foreground">Your account is not linked to a staff record.</p>
        ) : mine.payslips.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payslips issued to you yet.</p>
        ) : (
          mine.payslips.map((p) => {
            const run = mine.runById[p.payrollRunId];
            return (
              <details key={p._id} className="rounded-lg border p-2.5">
                <summary className="flex cursor-pointer items-center justify-between text-sm font-medium">
                  <span>{run?.periodLabel ?? "Payroll"} — net {money(p.netPay)}</span>
                  <Pill tone={statusTone(run?.status ?? "draft")}>{run?.status}</Pill>
                </summary>
                <div className="mt-2 space-y-1 text-xs">
                  {p.lines.map((l, i) => (
                    <div key={i} className="flex justify-between">
                      <span className={l.componentType === "deduction" ? "text-rose-600 dark:text-rose-400" : ""}>
                        {l.componentType === "deduction" ? "− " : ""}{l.name}
                      </span>
                      <span className="tabular-nums">{money(l.amount)}</span>
                    </div>
                  ))}
                </div>
              </details>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
