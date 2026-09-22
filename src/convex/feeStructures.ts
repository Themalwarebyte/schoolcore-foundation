import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { ACC, ensureStudentAccount, postLedgerTransaction, nextNumber } from "./finance";

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ================================================================== */
/* Fee structures                                                      */
/* ================================================================== */

export const listStructures = query({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    const session = await requirePermission(ctx, "finance.view");
    const schoolId = session.schoolId as Id<"schools">;
    let rows: Doc<"feeStructures">[];
    if (academicYearId) {
      await getSchoolRecord(ctx, schoolId, "academicYears", academicYearId);
      rows = await ctx.db
        .query("feeStructures")
        .withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId))
        .collect();
    } else {
      rows = await ctx.db.query("feeStructures").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    }
    const terms = await ctx.db.query("terms").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const termById = new Map(terms.map((t) => [t._id, t]));
    const grades = await ctx.db.query("gradeLevels").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const gradeById = new Map(grades.map((g) => [g._id, g]));
    const withTotals = await Promise.all(
      rows.map(async (f) => {
        const items = await ctx.db.query("feeItems").withIndex("by_structure", (q) => q.eq("feeStructureId", f._id)).collect();
        const activeItems = items.filter((i) => i.status === "active");
        const term = termById.get(f.termId);
        return {
          _id: f._id,
          name: f.name,
          termId: f.termId,
          termName: term?.name ?? "—",
          academicYearId: f.academicYearId,
          grades:
            f.applicableGradeLevelIds.length === 0
              ? "All classes"
              : f.applicableGradeLevelIds.map((g) => gradeById.get(g)?.name ?? "?").join(", "),
          itemCount: activeItems.length,
          total: round2(activeItems.reduce((s, i) => s + i.amount, 0)),
          status: f.status,
        };
      }),
    );
    return withTotals.sort((a, b) => (a.termName < b.termName ? -1 : 1));
  },
});

export const structureDetail = query({
  args: { feeStructureId: v.id("feeStructures") },
  handler: async (ctx, { feeStructureId }) => {
    const session = await requirePermission(ctx, "finance.view");
    const schoolId = session.schoolId as Id<"schools">;
    const f = await getSchoolRecord(ctx, schoolId, "feeStructures", feeStructureId);
    const items = await ctx.db.query("feeItems").withIndex("by_structure", (q) => q.eq("feeStructureId", f._id)).collect();
    return {
      structure: { _id: f._id, name: f.name, termId: f.termId, academicYearId: f.academicYearId, status: f.status, applicableGradeLevelIds: f.applicableGradeLevelIds },
      items: items
        .filter((i) => i.status !== "archived")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => ({
          _id: i._id, name: i.name, category: i.category, amount: i.amount,
          mandatory: i.mandatory, status: i.status,
        })),
      total: round2(items.filter((i) => i.status === "active").reduce((s, i) => s + i.amount, 0)),
    };
  },
});

export const saveStructure = mutation({
  args: {
    feeStructureId: v.optional(v.id("feeStructures")),
    name: v.string(),
    termId: v.id("terms"),
    applicableGradeLevelIds: v.array(v.id("gradeLevels")),
    items: v.array(
      v.object({ name: v.string(), category: v.string(), amount: v.number(), mandatory: v.boolean() }),
    ),
  },
  handler: async (ctx, { feeStructureId, name, termId, applicableGradeLevelIds, items }) => {
    const session = await requirePermission(ctx, "fees.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const term = await getSchoolRecord(ctx, schoolId, "terms", termId);
    if (!name.trim()) throw new ConvexError("Structure name is required.");
    if (items.length === 0) throw new ConvexError("Add at least one fee item.");
    for (const it of items) {
      if (!it.name.trim()) throw new ConvexError("Every fee item needs a name.");
      if (!(it.amount > 0)) throw new ConvexError("Fee item amounts must be positive.");
    }
    for (const gid of applicableGradeLevelIds) {
      await getSchoolRecord(ctx, schoolId, "gradeLevels", gid);
    }
    let structureId = feeStructureId;
    if (structureId) {
      const existing = await getSchoolRecord(ctx, schoolId, "feeStructures", structureId);
      await ctx.db.patch(structureId, {
        name: name.trim(), termId: term._id, applicableGradeLevelIds, updatedAt: Date.now(),
      });
      // Replace items wholesale (simple + auditable via the structure audit row).
      const old = await ctx.db.query("feeItems").withIndex("by_structure", (q) => q.eq("feeStructureId", structureId as Id<"feeStructures">)).collect();
      for (const o of old) await ctx.db.patch(o._id, { status: "archived" });
    } else {
      structureId = await ctx.db.insert("feeStructures", {
        schoolId,
        academicYearId: term.academicYearId,
        termId: term._id,
        name: name.trim(),
        applicableGradeLevelIds,
        status: "active",
        createdBy: session.userId,
      });
    }
    for (const it of items) {
      await ctx.db.insert("feeItems", {
        schoolId, feeStructureId: structureId, name: it.name.trim(),
        category: it.category, amount: it.amount, mandatory: it.mandatory, status: "active",
      });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "fee_structure.saved", entityType: "feeStructures",
      entityId: structureId, description: `Fee structure "${name.trim()}" saved (${items.length} items)`,
    });
    return structureId;
  },
});

export const archiveStructure = mutation({
  args: { feeStructureId: v.id("feeStructures") },
  handler: async (ctx, { feeStructureId }) => {
    const session = await requirePermission(ctx, "fees.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const f = await getSchoolRecord(ctx, schoolId, "feeStructures", feeStructureId);
    await ctx.db.patch(feeStructureId, { status: "archived", updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "fee_structure.archived", entityType: "feeStructures",
      entityId: feeStructureId, description: `Fee structure "${f.name}" archived`,
    });
    return { ok: true };
  },
});

/* ================================================================== */
/* Bulk billing run — enrollment-driven invoice generation             */
/* ================================================================== */

export const billingPreview = query({
  args: { feeStructureId: v.id("feeStructures") },
  handler: async (ctx, { feeStructureId }) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    const structure = await getSchoolRecord(ctx, schoolId, "feeStructures", feeStructureId);
    const items = (await ctx.db.query("feeItems").withIndex("by_structure", (q) => q.eq("feeStructureId", structure._id)).collect())
      .filter((i) => i.status === "active");
    const perStudent = round2(items.reduce((s, i) => s + i.amount, 0));

    // Target students: active enrollments in the structure's year, filtered by
    // the structure's applicable grades (empty = all).
    const enrollments = (
      await ctx.db.query("enrollments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect()
    ).filter((e) => e.status === "active" && e.academicYearId === structure.academicYearId);
    const gradeFilter = new Set(structure.applicableGradeLevelIds);
    const sections = await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const sectionGrade = new Map(sections.map((s) => [s._id, s.gradeLevelId]));
    const targeted = enrollments.filter((e) => gradeFilter.size === 0 || gradeFilter.has(sectionGrade.get(e.classSectionId) as Id<"gradeLevels">));

    // Students already invoiced for this term.
    const invoices = (
      await ctx.db.query("invoices").withIndex("by_term", (q) => q.eq("termId", structure.termId)).collect()
    ).filter((i) => i.schoolId === schoolId);
    const alreadyBilled = new Set(invoices.map((i) => i.studentId));
    const pending = targeted.filter((e) => !alreadyBilled.has(e.studentId));

    return {
      structureName: structure.name,
      perStudent,
      enrolledCount: targeted.length,
      alreadyBilledCount: targeted.length - pending.length,
      pendingCount: pending.length,
      projectedTotal: round2(perStudent * pending.length),
    };
  },
});

export const runBilling = mutation({
  args: {
    feeStructureId: v.id("feeStructures"),
    issueDate: v.string(),
    dueDate: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { feeStructureId, issueDate, dueDate, dryRun }) => {
    const session = await requirePermission(ctx, "billing.create");
    const schoolId = session.schoolId as Id<"schools">;
    const structure = await getSchoolRecord(ctx, schoolId, "feeStructures", feeStructureId);
    if (structure.status !== "active") throw new ConvexError("This fee structure is archived.");
    if (dueDate < issueDate) throw new ConvexError("Due date cannot be before the issue date.");

    const items = (await ctx.db.query("feeItems").withIndex("by_structure", (q) => q.eq("feeStructureId", structure._id)).collect())
      .filter((i) => i.status === "active");
    if (items.length === 0) throw new ConvexError("This fee structure has no active items.");

    const enrollments = (
      await ctx.db.query("enrollments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect()
    ).filter((e) => e.status === "active" && e.academicYearId === structure.academicYearId);
    const gradeFilter = new Set(structure.applicableGradeLevelIds);
    const sections = await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const sectionGrade = new Map(sections.map((s) => [s._id, s.gradeLevelId]));
    const targeted = enrollments.filter((e) => gradeFilter.size === 0 || gradeFilter.has(sectionGrade.get(e.classSectionId) as Id<"gradeLevels">));

    const existingInvoices = (
      await ctx.db.query("invoices").withIndex("by_term", (q) => q.eq("termId", structure.termId)).collect()
    ).filter((i) => i.schoolId === schoolId);
    const alreadyBilled = new Set(existingInvoices.map((i) => i.studentId));

    const students = await ctx.db.query("students").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const studentById = new Map(students.map((s) => [s._id, s]));

    const targets = targeted.filter((e) => !alreadyBilled.has(e.studentId));
    if (dryRun) {
      return { dryRun: true as const, created: 0, skipped: targeted.length - targets.length, total: round2(targets.length * items.reduce((s, i) => s + i.amount, 0)) };
    }

    let created = 0;
    for (const e of targets) {
      const student = studentById.get(e.studentId);
      if (!student) continue;
      const accountId = await ensureStudentAccount(ctx, schoolId, student._id);
      const invoiceNumber = await nextNumber(ctx, schoolId, "INV");
      const total = round2(items.reduce((s, i) => s + i.amount, 0));
      const invoiceId = await ctx.db.insert("invoices", {
        schoolId,
        invoiceNumber,
        studentId: student._id,
        accountId,
        academicYearId: structure.academicYearId,
        termId: structure.termId,
        issueDate,
        dueDate,
        totalAmount: total,
        status: "issued",
        notes: `Auto-billed from fee structure "${structure.name}"`,
        createdById: session.userId,
        issuedAt: Date.now(),
      });
      for (const it of items) {
        await ctx.db.insert("invoiceItems", {
          schoolId, invoiceId, description: it.name, category: it.category,
          quantity: 1, amount: it.amount, sourceFeeItemId: it._id,
        });
      }
      await postLedgerTransaction(ctx, schoolId, session.userId, {
        transactionType: "invoice",
        date: issueDate,
        amount: total,
        description: `Invoice ${invoiceNumber} — ${student.firstName} ${student.lastName}`,
        studentId: student._id,
        accountId,
        invoiceId,
        lines: [
          { code: ACC.RECEIVABLE, direction: "debit", amount: total },
          { code: ACC.REVENUE, direction: "credit", amount: total },
        ],
      });
      created++;
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "billing.run", entityType: "feeStructures",
      entityId: feeStructureId,
      description: `Billing run for "${structure.name}": ${created} invoices issued, ${targets.length - created + (targeted.length - targets.length)} skipped (already billed)`,
      metadata: { created: String(created), structure: structure.name },
    });
    return { dryRun: false as const, created, skipped: targeted.length - targets.length + (targets.length - created) };
  },
});

/** Billing readiness for the finance dashboard (counts only). */
export const readiness = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "billing.view");
    const schoolId = session.schoolId as Id<"schools">;
    const structures = (await ctx.db.query("feeStructures").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect())
      .filter((s) => s.status === "active");
    const out = [] as Array<{ _id: Id<"feeStructures">; name: string; pending: number }>;
    for (const structure of structures) {
      const items = (await ctx.db.query("feeItems").withIndex("by_structure", (q) => q.eq("feeStructureId", structure._id)).collect()).filter((i) => i.status === "active");
      if (items.length === 0) continue;
      const enrollments = (
        await ctx.db.query("enrollments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect()
      ).filter((e) => e.status === "active" && e.academicYearId === structure.academicYearId);
      const gradeFilter = new Set(structure.applicableGradeLevelIds);
      const sections = await ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
      const sectionGrade = new Map(sections.map((s) => [s._id, s.gradeLevelId]));
      const targeted = enrollments.filter((e) => gradeFilter.size === 0 || gradeFilter.has(sectionGrade.get(e.classSectionId) as Id<"gradeLevels">));
      const invoices = (await ctx.db.query("invoices").withIndex("by_term", (q) => q.eq("termId", structure.termId)).collect()).filter((i) => i.schoolId === schoolId);
      const alreadyBilled = new Set(invoices.map((i) => i.studentId));
      out.push({ _id: structure._id, name: structure.name, pending: targeted.filter((e) => !alreadyBilled.has(e.studentId)).length });
    }
    return out;
  },
});
