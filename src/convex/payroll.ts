import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord, getSession } from "./session";
import { recordAudit } from "./audit";
import { postLedgerTransaction, ACC } from "./finance";
import { PAYROLL_RUN_STATUSES } from "./schema";

/* ================================================================== */
/* Salary structures                                                   */
/* ================================================================== */

export const listSalaryStructures = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "payroll.view");
    const schoolId = session.schoolId as Id<"schools">;
    const structures = await ctx.db
      .query("salaryStructures")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const components = await ctx.db
      .query("salaryComponents")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return structures.map((s) => ({
      ...s,
      components: components
        .filter((c) => c.salaryStructureId === s._id && c.status === "active")
        .map((c) => ({ _id: c._id, componentType: c.componentType, name: c.name, calculation: c.calculation, amount: c.amount })),
    }));
  },
});

export const createSalaryStructure = mutation({
  args: { name: v.string(), basicSalary: v.number() },
  handler: async (ctx, { name, basicSalary }) => {
    const session = await requirePermission(ctx, "payroll.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Structure name is required.");
    if (!(basicSalary > 0)) throw new ConvexError("Basic salary must be positive.");
    const id = await ctx.db.insert("salaryStructures", {
      schoolId, name: trimmed, basicSalary, status: "active",
      createdById: session.userId, createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payroll.structure.created",
      entityType: "salaryStructures", entityId: id,
      description: `Salary structure "${trimmed}" created (basic ${basicSalary})`,
    });
    return id;
  },
});

export const addSalaryComponent = mutation({
  args: {
    salaryStructureId: v.id("salaryStructures"),
    componentType: v.union(v.literal("earning"), v.literal("deduction")),
    name: v.string(),
    calculation: v.union(v.literal("fixed_amount"), v.literal("percentage_of_basic")),
    amount: v.number(),
  },
  handler: async (ctx, { salaryStructureId, componentType, name, calculation, amount }) => {
    const session = await requirePermission(ctx, "payroll.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const s = await getSchoolRecord(ctx, schoolId, "salaryStructures", salaryStructureId);
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Component name is required.");
    if (!(amount > 0)) throw new ConvexError("Component amount must be positive.");
    if (calculation === "percentage_of_basic" && amount > 100) {
      throw new ConvexError("Percentage components cannot exceed 100%.");
    }
    const id = await ctx.db.insert("salaryComponents", {
      schoolId, salaryStructureId, componentType, name: trimmed, calculation, amount, status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payroll.component.added",
      entityType: "salaryComponents", entityId: id,
      description: `${componentType === "earning" ? "Earning" : "Deduction"} "${trimmed}" (${calculation === "fixed_amount" ? amount : `${amount}% of basic`}) added to "${s.name}"`,
    });
    return id;
  },
});

export const removeSalaryComponent = mutation({
  args: { componentId: v.id("salaryComponents") },
  handler: async (ctx, { componentId }) => {
    const session = await requirePermission(ctx, "payroll.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const c = await getSchoolRecord(ctx, schoolId, "salaryComponents", componentId);
    await ctx.db.patch(componentId, { status: "archived" });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payroll.component.removed",
      entityType: "salaryComponents", entityId: componentId,
      description: `Component "${c.name}" archived`,
    });
    return componentId;
  },
});

/* ================================================================== */
/* Payroll runs                                                        */
/* ================================================================== */

export const listPayrollRuns = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "payroll.view");
    const schoolId = session.schoolId as Id<"schools">;
    const runs = await ctx.db
      .query("payrollRuns")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return runs.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getPayrollRun = query({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, { runId }) => {
    const session = await requirePermission(ctx, "payroll.view");
    const schoolId = session.schoolId as Id<"schools">;
    const run = await getSchoolRecord(ctx, schoolId, "payrollRuns", runId);
    const slips = await ctx.db
      .query("payslips")
      .withIndex("by_run", (q) => q.eq("payrollRunId", runId))
      .collect();
    const staffMap = new Map<Id<"staff">, { name: string; employeeNumber: string }>();
    const rows = await Promise.all(
      slips.map(async (p) => {
        let staff = staffMap.get(p.staffId);
        if (!staff) {
          const s = await ctx.db.get(p.staffId);
          if (s) {
            staff = { name: [s.firstName, s.lastName].filter(Boolean).join(" "), employeeNumber: s.employeeNumber };
            staffMap.set(p.staffId, staff);
          }
        }
        return {
          _id: p._id,
          staffName: staff?.name ?? "—",
          employeeNumber: staff?.employeeNumber ?? "—",
          basicSalary: p.basicSalary,
          grossPay: p.grossPay,
          totalDeductions: p.totalDeductions,
          netPay: p.netPay,
          lines: p.lines,
          contractId: p.contractId ?? null,
        };
      }),
    );
    return { run, payslips: rows.sort((a, b) => a.staffName.localeCompare(b.staffName)) };
  },
});

interface ComputedLine { name: string; componentType: string; amount: number }

/**
 * Compute a payslip from the employee's active contract salary structure.
 * Pure arithmetic — percentages resolve against the structure's basic salary.
 */
async function computePayslip(
  ctx: import("./_generated/server").MutationCtx,
  schoolId: Id<"schools">,
  employeeId: Id<"employees">,
): Promise<{ basicSalary: number; gross: number; deductions: number; net: number; lines: ComputedLine[]; structureId: Id<"salaryStructures"> | undefined; contractId: Id<"contracts"> | undefined }> {
  const contracts = await ctx.db
    .query("contracts")
    .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
    .collect();
  const active = contracts.find((c) => c.status === "active");
  const structureId = active?.salaryStructureId;
  if (!structureId) {
    throw new ConvexError("This employee has no active contract with a salary structure. Activate a contract first.");
  }
  const structure = await ctx.db.get(structureId);
  if (!structure) throw new ConvexError("The contract's salary structure no longer exists.");
  const components = await ctx.db
    .query("salaryComponents")
    .withIndex("by_structure", (q) => q.eq("salaryStructureId", structureId))
    .collect()
    .then((cs) => cs.filter((c) => c.status === "active"));
  const basic = structure.basicSalary;
  const lines: ComputedLine[] = [{ name: "Basic salary", componentType: "earning", amount: basic }];
  let gross = basic;
  let deductions = 0;
  for (const c of components) {
    const amount =
      c.calculation === "percentage_of_basic" ? Math.round(basic * (c.amount / 100) * 100) / 100 : c.amount;
    if (c.componentType === "earning") gross += amount;
    else deductions += amount;
    lines.push({ name: c.name, componentType: c.componentType, amount });
  }
  const net = Math.round((gross - deductions) * 100) / 100;
  return { basicSalary: basic, gross: Math.round(gross * 100) / 100, deductions: Math.round(deductions * 100) / 100, net, lines, structureId, contractId: active?._id };
}

/** Preview net pay for every eligible employee without writing anything. */
export const previewRun = query({
  args: { periodYear: v.number(), periodMonth: v.number() },
  handler: async (ctx, { periodYear, periodMonth }) => {
    const session = await requirePermission(ctx, "payroll.view");
    const schoolId = session.schoolId as Id<"schools">;
    const existing = await ctx.db
      .query("payrollRuns")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((rs) => rs.find((r) => r.periodYear === periodYear && r.periodMonth === periodMonth));
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((es) => es.filter((e) => e.status === "active"));
    const rows = [];
    for (const e of employees) {
      const contracts = await ctx.db
        .query("contracts")
        .withIndex("by_employee", (q) => q.eq("employeeId", e._id))
        .collect();
      const active = contracts.find((c) => c.status === "active" && c.salaryStructureId);
      if (!active?.salaryStructureId) {
        rows.push({ employeeId: e._id, staffId: e.staffId, name: "—", status: "skipped", reason: "No active contract with salary structure", gross: 0, deductions: 0, net: 0 });
        continue;
      }
      const staff = await ctx.db.get(e.staffId);
      const structureId: Id<"salaryStructures"> = active.salaryStructureId;
      const structure = await ctx.db.get(structureId);
      const components = await ctx.db
        .query("salaryComponents")
        .withIndex("by_structure", (q) => q.eq("salaryStructureId", structureId))
        .collect()
        .then((cs) => cs.filter((c) => c.status === "active"));
      const basic = structure?.basicSalary ?? 0;
      let gross = basic;
      let deductions = 0;
      for (const c of components) {
        const amount = c.calculation === "percentage_of_basic" ? Math.round(basic * (c.amount / 100) * 100) / 100 : c.amount;
        if (c.componentType === "earning") gross += amount;
        else deductions += amount;
      }
      rows.push({
        employeeId: e._id,
        staffId: e.staffId,
        name: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : "—",
        status: "ready" as const,
        reason: null,
        gross: Math.round(gross * 100) / 100,
        deductions: Math.round(deductions * 100) / 100,
        net: Math.round((gross - deductions) * 100) / 100,
      });
    }
    return { duplicate: existing ? { runId: existing._id, status: existing.status } : null, employees: rows };
  },
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const createPayrollRun = mutation({
  args: { periodYear: v.number(), periodMonth: v.number() },
  handler: async (ctx, { periodYear, periodMonth }) => {
    const session = await requirePermission(ctx, "payroll.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!(periodMonth >= 1 && periodMonth <= 12)) throw new ConvexError("Month must be between 1 and 12.");
    const dup = await ctx.db
      .query("payrollRuns")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((rs) => rs.find((r) => r.periodYear === periodYear && r.periodMonth === periodMonth));
    if (dup) throw new ConvexError(`A payroll run for ${MONTHS[periodMonth - 1]} ${periodYear} already exists.`);
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((es) => es.filter((e) => e.status === "active"));
    if (employees.length === 0) throw new ConvexError("No active employees to pay. Create HR profiles first.");
    const runs = await ctx.db
      .query("payrollRuns")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const runNumber = `PAY-${periodYear}-${String(runs.length + 1).padStart(4, "0")}`;
    const periodLabel = `${MONTHS[periodMonth - 1]} ${periodYear}`;
    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;
    let count = 0;
    const runId = await ctx.db.insert("payrollRuns", {
      schoolId, runNumber, periodLabel, periodYear, periodMonth,
      totalGross: 0, totalDeductions: 0, totalNet: 0, employeeCount: 0,
      status: "draft", createdById: session.userId, createdAt: Date.now(),
    });
    for (const e of employees) {
      try {
        const calc = await computePayslip(ctx, schoolId, e._id);
        await ctx.db.insert("payslips", {
          schoolId,
          payrollRunId: runId,
          staffId: e.staffId,
          employeeId: e._id,
          basicSalary: calc.basicSalary,
          grossPay: calc.gross,
          totalDeductions: calc.deductions,
          netPay: calc.net,
          lines: calc.lines,
          salaryStructureId: calc.structureId,
          contractId: calc.contractId,
          generatedAt: Date.now(),
        });
        totalGross += calc.gross;
        totalDeductions += calc.deductions;
        totalNet += calc.net;
        count += 1;
      } catch {
        // Employees without an active contract/structure are skipped, not silently paid.
      }
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    await ctx.db.patch(runId, {
      totalGross: round2(totalGross),
      totalDeductions: round2(totalDeductions),
      totalNet: round2(totalNet),
      employeeCount: count,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payroll.run.created",
      entityType: "payrollRuns", entityId: runId,
      description: `Payroll run ${runNumber} (${periodLabel}) drafted: ${count} payslip(s), net ${round2(totalNet)}`,
    });
    return runId;
  },
});

export const advancePayrollRun = mutation({
  args: { runId: v.id("payrollRuns") },
  handler: async (ctx, { runId }) => {
    const session = await getSession(ctx);
    const schoolId = session.schoolId as Id<"schools">;
    const run = await getSchoolRecord(ctx, schoolId, "payrollRuns", runId);
    const idx = PAYROLL_RUN_STATUSES.indexOf(run.status as (typeof PAYROLL_RUN_STATUSES)[number]);
    if (idx < 0 || run.status === "paid") throw new ConvexError("This payroll run can no longer be advanced.");
    if (run.status === "draft") {
      await requirePermission(ctx, "payroll.manage");
      await ctx.db.patch(runId, { status: "review" });
      await recordAudit(ctx, {
        userId: session.userId, schoolId, action: "payroll.run.submitted",
        entityType: "payrollRuns", entityId: runId,
        description: `Payroll run ${run.runNumber} submitted for review`,
      });
      return { status: "review" };
    }
    if (run.status === "review") {
      await requirePermission(ctx, "payroll.manage");
      await ctx.db.patch(runId, { status: "approved", approvedById: session.userId, approvedAt: Date.now() });
      await recordAudit(ctx, {
        userId: session.userId, schoolId, action: "payroll.run.approved",
        entityType: "payrollRuns", entityId: runId,
        description: `Payroll run ${run.runNumber} approved (${run.employeeCount} employees, net ${run.totalNet})`,
      });
      return { status: "approved" };
    }
    // approved → paid: post the expense to the general ledger.
    await requirePermission(ctx, "payroll.manage");
    const today = new Date().toISOString().slice(0, 10);
    const txnId = await postLedgerTransaction(ctx, schoolId, session.userId, {
      transactionType: "expense",
      date: today,
      amount: run.totalNet,
      description: `Payroll ${run.periodLabel} — ${run.runNumber} (${run.employeeCount} employees)`,
      lines: [
        { code: ACC.EXPENSES_CLEARING, direction: "debit", amount: run.totalNet },
        { code: ACC.CASH, direction: "credit", amount: run.totalNet },
      ],
    });
    await ctx.db.patch(runId, { status: "paid", paidTransactionId: txnId, paidAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "payroll.run.paid",
      entityType: "payrollRuns", entityId: runId,
      description: `Payroll run ${run.runNumber} marked paid; ledger expense posted (${run.totalNet})`,
    });
    return { status: "paid" };
  },
});

/* ================================================================== */
/* My payslips (self-service)                                          */
/* ================================================================== */

export const myPayslips = query({
  args: {},
  handler: async (ctx) => {
    // Self-service: any signed-in school member may look up their OWN payslips
    // (the query only ever returns slips tied to the caller's staff record;
    // payroll administration still requires payroll.view/payroll.manage).
    const session = await getSession(ctx);
    const schoolId = session.schoolId as Id<"schools">;
    const ownStaff = await ctx.db
      .query("staff")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!ownStaff) return { isEmployee: false as const, payslips: [], runById: {} };
    const slips = await ctx.db
      .query("payslips")
      .withIndex("by_staff", (q) => q.eq("staffId", ownStaff._id))
      .collect();
    const runById: Record<string, { periodLabel: string; status: string; runNumber: string }> = {};
    for (const p of slips) {
      if (!runById[p.payrollRunId]) {
        const run = await ctx.db.get(p.payrollRunId);
        if (run) runById[p.payrollRunId] = { periodLabel: run.periodLabel, status: run.status, runNumber: run.runNumber };
      }
    }
    return {
      isEmployee: true as const,
      payslips: slips
        .sort((a, b) => b.generatedAt - a.generatedAt)
        .map((p) => ({
          _id: p._id,
          payrollRunId: p.payrollRunId,
          basicSalary: p.basicSalary,
          grossPay: p.grossPay,
          totalDeductions: p.totalDeductions,
          netPay: p.netPay,
          lines: p.lines,
          generatedAt: p.generatedAt,
        })),
      runById,
    };
  },
});
