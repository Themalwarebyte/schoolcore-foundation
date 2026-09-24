import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getSession, requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { CONTRACT_STATUSES } from "./schema";
import { can } from "./access";

/* ================================================================== */
/* Departments                                                         */
/* ================================================================== */

export const listDepartments = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "hr.view");
    const rows = await ctx.db
      .query("departments")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    const withCounts = await Promise.all(
      rows.map(async (d) => {
        const employees = await ctx.db
          .query("employees")
          .withIndex("by_department", (q) => q.eq("departmentId", d._id))
          .collect()
          .then((es) => es.filter((e) => e.status === "active").length);
        return { ...d, employeeCount: employees };
      }),
    );
    return withCounts;
  },
});

export const createDepartment = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, { name, description }) => {
    const session = await requirePermission(ctx, "hr.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Department name is required.");
    const dup = await ctx.db
      .query("departments")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ds) => ds.find((d) => d.name.toLowerCase() === trimmed.toLowerCase()));
    if (dup) throw new ConvexError("A department with this name already exists.");
    const id = await ctx.db.insert("departments", {
      schoolId,
      name: trimmed,
      description: description?.trim(),
      status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.department.created",
      entityType: "departments", entityId: id, description: `Department "${trimmed}" created`,
    });
    return id;
  },
});

export const updateDepartment = mutation({
  args: { departmentId: v.id("departments"), name: v.string(), description: v.optional(v.string()), status: v.optional(v.string()) },
  handler: async (ctx, { departmentId, name, description, status }) => {
    const session = await requirePermission(ctx, "hr.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const d = await getSchoolRecord(ctx, schoolId, "departments", departmentId);
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Department name is required.");
    await ctx.db.patch(departmentId, {
      name: trimmed,
      description: description?.trim(),
      status: status ?? d.status,
      });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.department.updated",
      entityType: "departments", entityId: departmentId,
      description: `Department "${d.name}" → "${trimmed}"`,
    });
    return departmentId;
  },
});

/* ================================================================== */
/* Employee profiles (extend Staff — one identity, one record)         */
/* ================================================================== */

export const listEmployees = query({
  args: {
    search: v.optional(v.string()),
    departmentId: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { search, departmentId, status }) => {
    const session = await requirePermission(ctx, "hr.view");
    const schoolId = session.schoolId as Id<"schools">;
    let rows = await ctx.db
      .query("employees")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (status && status !== "all") rows = rows.filter((e) => e.status === status);
    if (departmentId && departmentId !== "all") rows = rows.filter((e) => e.departmentId === departmentId);
    const out = await Promise.all(
      rows.map(async (e) => {
        const staff = await ctx.db.get(e.staffId);
        const dept = e.departmentId ? await ctx.db.get(e.departmentId) : null;
        const contracts = await ctx.db
          .query("contracts")
          .withIndex("by_employee", (q) => q.eq("employeeId", e._id))
          .collect();
        const activeContract = contracts.find((c) => c.status === "active") ?? null;
        return {
          _id: e._id,
          staffId: e.staffId,
          name: staff ? [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(" ") : "—",
          employeeNumber: staff?.employeeNumber ?? "—",
          jobTitle: e.jobTitle ?? staff?.jobTitle ?? null,
          department: dept?.name ?? null,
          hireDate: e.hireDate ?? staff?.hireDate ?? null,
          status: e.status,
          activeContractType: activeContract?.contractType ?? null,
          activeContractStatus: activeContract?.status ?? null,
        };
      }),
    );
    const q = search?.trim().toLowerCase();
    return (q
      ? out.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.employeeNumber.toLowerCase().includes(q) ||
            (e.jobTitle ?? "").toLowerCase().includes(q),
        )
      : out
    ).sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getEmployee = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, { employeeId }) => {
    const session = await requirePermission(ctx, "hr.view");
    const schoolId = session.schoolId as Id<"schools">;
    const e = await getSchoolRecord(ctx, schoolId, "employees", employeeId);
    const staff = await ctx.db.get(e.staffId);
    if (!staff) throw new ConvexError("Underlying staff record no longer exists.");
    const dept = e.departmentId ? await ctx.db.get(e.departmentId) : null;
    const supervisor = e.supervisorStaffId ? await ctx.db.get(e.supervisorStaffId) : null;
    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_employee", (q) => q.eq("employeeId", e._id))
      .collect()
      .then((cs) => cs.sort((a, b) => (a.startDate < b.startDate ? 1 : -1)));
    const documents = await ctx.db
      .query("staffDocuments")
      .withIndex("by_employee", (q) => q.eq("employeeId", e._id))
      .collect();
    const leave = await ctx.db
      .query("leaveRequests")
      .withIndex("by_staff", (q) => q.eq("staffId", e.staffId))
      .collect()
      .then((ls) => ls.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20));
    const leaveTypes = await ctx.db
      .query("leaveTypes")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    // Document contents are intentionally NOT returned here — only metadata.
    // Documents require hr.manage to download (see getStaffDocument).
    return {
      employee: {
        _id: e._id,
        staffId: e.staffId,
        name: [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(" "),
        employeeNumber: staff.employeeNumber,
        email: staff.email ?? null,
        phone: staff.phone ?? null,
        jobTitle: e.jobTitle ?? staff.jobTitle ?? null,
        employmentType: staff.employmentType ?? null,
        employmentStatus: staff.employmentStatus,
        hireDate: e.hireDate ?? staff.hireDate ?? null,
        department: dept ? { id: dept._id, name: dept.name } : null,
        supervisor: supervisor ? { id: supervisor._id, name: [supervisor.firstName, supervisor.lastName].join(" ") } : null,
        qualifications: e.qualifications ?? null,
        emergencyContact: e.emergencyContactName
          ? { name: e.emergencyContactName, phone: e.emergencyContactPhone ?? null, relationship: e.emergencyContactRelationship ?? null }
          : null,
        notes: e.notes ?? null,
        status: e.status,
        updatedAt: e.updatedAt ?? null,
      },
      contracts: contracts.map((c) => ({ ...c })),
      documents: documents.map((d) => ({
        _id: d._id, documentType: d.documentType, title: d.title,
        expiryDate: d.expiryDate ?? null, uploadedAt: d.uploadedAt, hasFile: d.fileId !== undefined,
      })),
      leaveRequests: leave.map((l) => {
        const lt = leaveTypes.find((t) => t._id === l.leaveTypeId);
        return { ...l, leaveTypeName: lt?.name ?? "Leave" };
      }),
      leaveTypes,
    };
  },
});

/** Create an HR profile for an existing staff member. */
export const createEmployee = mutation({
  args: {
    staffId: v.id("staff"),
    departmentId: v.optional(v.id("departments")),
    jobTitle: v.optional(v.string()),
    hireDate: v.optional(v.string()),
    supervisorStaffId: v.optional(v.id("staff")),
    qualifications: v.optional(v.string()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    emergencyContactRelationship: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "employees.create");
    const schoolId = session.schoolId as Id<"schools">;
    const staff = await getSchoolRecord(ctx, schoolId, "staff", args.staffId);
    const dup = await ctx.db
      .query("employees")
      .withIndex("by_staff", (q) => q.eq("staffId", args.staffId))
      .first();
    if (dup) throw new ConvexError("This staff member already has an HR profile.");
    const id = await ctx.db.insert("employees", {
      schoolId,
      staffId: args.staffId,
      departmentId: args.departmentId,
      jobTitle: args.jobTitle?.trim(),
      hireDate: args.hireDate,
      supervisorStaffId: args.supervisorStaffId,
      qualifications: args.qualifications?.trim(),
      emergencyContactName: args.emergencyContactName?.trim(),
      emergencyContactPhone: args.emergencyContactPhone?.trim(),
      emergencyContactRelationship: args.emergencyContactRelationship?.trim(),
      notes: args.notes?.trim(),
      status: "active",
      updatedAt: Date.now(),
      updatedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.employee.created",
      entityType: "employees", entityId: id,
      description: `HR profile created for ${[staff.firstName, staff.lastName].join(" ")} (${staff.employeeNumber})`,
    });
    return id;
  },
});

export const updateEmployee = mutation({
  args: {
    employeeId: v.id("employees"),
    departmentId: v.optional(v.id("departments")),
    jobTitle: v.optional(v.string()),
    hireDate: v.optional(v.string()),
    supervisorStaffId: v.optional(v.id("staff")),
    qualifications: v.optional(v.string()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    emergencyContactRelationship: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { employeeId, ...patch }) => {
    const session = await requirePermission(ctx, "employees.update");
    const schoolId = session.schoolId as Id<"schools">;
    const e = await getSchoolRecord(ctx, schoolId, "employees", employeeId);
    await ctx.db.patch(employeeId, {
      ...patch,
      jobTitle: patch.jobTitle?.trim(),
      qualifications: patch.qualifications?.trim(),
      status: patch.status ?? e.status,
      updatedAt: Date.now(),
      updatedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.employee.updated",
      entityType: "employees", entityId: employeeId,
      description: `HR profile updated (${Object.keys(patch).filter((k) => k !== "status").join(", ")})`,
    });
    return employeeId;
  },
});

/* ================================================================== */
/* Contracts                                                           */
/* ================================================================== */

export const createContract = mutation({
  args: {
    employeeId: v.id("employees"),
    contractType: v.string(),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    salaryStructureId: v.optional(v.id("salaryStructures")),
  },
  handler: async (ctx, { employeeId, contractType, startDate, endDate, salaryStructureId }) => {
    const session = await requirePermission(ctx, "contracts.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const e = await getSchoolRecord(ctx, schoolId, "employees", employeeId);
    if (endDate && endDate < startDate) {
      throw new ConvexError("Contract end date cannot be before the start date.");
    }
    if (salaryStructureId) {
      await getSchoolRecord(ctx, schoolId, "salaryStructures", salaryStructureId);
    }
    const staff = await ctx.db.get(e.staffId);
    const existing = await ctx.db
      .query("contracts")
      .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
      .collect();
    const contractNumber = `CTR-${schoolId.slice(-4).toUpperCase()}-${String(existing.length + 1).padStart(4, "0")}`;
    const id = await ctx.db.insert("contracts", {
      schoolId,
      employeeId,
      staffId: e.staffId,
      contractNumber,
      contractType,
      startDate,
      endDate,
      salaryStructureId,
      status: "draft",
      createdById: session.userId,
      updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.contract.created",
      entityType: "contracts", entityId: id,
      description: `Contract ${contractNumber} (${contractType}) created for ${[staff?.firstName, staff?.lastName].filter(Boolean).join(" ")}`,
    });
    return id;
  },
});

/** Flat contract list for the HR contracts tab. */
export const listAllContracts = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "hr.view");
    const schoolId = session.schoolId as Id<"schools">;
    const contracts = await ctx.db
      .query("contracts")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((cs) => cs.sort((a, b) => (a.startDate < b.startDate ? 1 : -1)));
    const out = await Promise.all(
      contracts.map(async (c) => {
        const staff = await ctx.db.get(c.staffId);
        return {
          _id: c._id,
          contractNumber: c.contractNumber,
          contractType: c.contractType,
          startDate: c.startDate,
          endDate: c.endDate ?? null,
          status: c.status,
          employeeName: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : "—",
        };
      }),
    );
    return out;
  },
});

export const updateContractStatus = mutation({
  args: { contractId: v.id("contracts"), status: v.string() },
  handler: async (ctx, { contractId, status }) => {
    const session = await requirePermission(ctx, "contracts.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const c = await getSchoolRecord(ctx, schoolId, "contracts", contractId);
    if (!(CONTRACT_STATUSES as readonly string[]).includes(status)) {
      throw new ConvexError("Unknown contract status.");
    }
    if (status === "active") {
      const others = await ctx.db
        .query("contracts")
        .withIndex("by_employee", (q) => q.eq("employeeId", c.employeeId))
        .collect();
      for (const o of others) {
        if (o._id !== contractId && o.status === "active") {
          await ctx.db.patch(o._id, { status: "expired", updatedAt: Date.now() });
        }
      }
    }
    await ctx.db.patch(contractId, { status, updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.contract.status_changed",
      entityType: "contracts", entityId: contractId,
      description: `Contract ${c.contractNumber}: ${c.status} → ${status}`,
    });
    return contractId;
  },
});

/* ================================================================== */
/* Staff documents (metadata open to hr.view; files need hr.manage)    */
/* ================================================================== */

export const listStaffDocuments = query({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const session = await requirePermission(ctx, "hr.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "staff", staffId);
    return ctx.db
      .query("staffDocuments")
      .withIndex("by_staff", (q) => q.eq("staffId", staffId))
      .collect()
      .then((ds) =>
        ds.map((d) => ({
          _id: d._id, documentType: d.documentType, title: d.title,
          expiryDate: d.expiryDate ?? null, uploadedAt: d.uploadedAt, hasFile: d.fileId !== undefined,
        })),
      );
  },
});

export const uploadStaffDocument = mutation({
  args: {
    staffId: v.id("staff"),
    documentType: v.string(),
    title: v.string(),
    filename: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
  },
  handler: async (ctx, { staffId, documentType, title, filename, mimeType, expiryDate }) => {
    const session = await requirePermission(ctx, "hr.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const staff = await getSchoolRecord(ctx, schoolId, "staff", staffId);
    if (!title.trim()) throw new ConvexError("Document title is required.");
    let fileId: Id<"files"> | undefined;
    if (filename) {
      fileId = await ctx.db.insert("files", {
        schoolId,
        uploadedById: session.userId,
        filename,
        mimeType: mimeType ?? "application/octet-stream",
      });
    }
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_staff", (q) => q.eq("staffId", staffId))
      .first();
    const id = await ctx.db.insert("staffDocuments", {
      schoolId,
      staffId,
      employeeId: employee?._id,
      documentType,
      title: title.trim(),
      fileId,
      expiryDate,
      uploadedById: session.userId,
      uploadedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.document.uploaded",
      entityType: "staffDocuments", entityId: id,
      description: `Document "${title.trim()}" (${documentType}) added for ${[staff.firstName, staff.lastName].filter(Boolean).join(" ")}`,
    });
    return id;
  },
});

/** File download — hr.manage only. Teachers never see other people's documents.
 * Access is audited through the auditDocumentAccess mutation called by the UI
 * when a document is opened (queries cannot write to the database). */
export const getStaffDocument = query({
  args: { documentId: v.id("staffDocuments") },
  handler: async (ctx, { documentId }) => {
    await requirePermission(ctx, "hr.manage");
    const session2 = await getSession(ctx);
    const schoolId = session2.schoolId as Id<"schools">;
    const d = await getSchoolRecord(ctx, schoolId, "staffDocuments", documentId);
    const file = d.fileId ? await ctx.db.get(d.fileId) : null;
    return {
      title: d.title,
      documentType: d.documentType,
      file: file ? { filename: file.filename, mimeType: file.mimeType } : null,
    };
  },
});

/** Audit an HR document access (called by the UI on open). */
export const auditDocumentAccess = mutation({
  args: { documentId: v.id("staffDocuments") },
  handler: async (ctx, { documentId }) => {
    const session = await requirePermission(ctx, "hr.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const d = await getSchoolRecord(ctx, schoolId, "staffDocuments", documentId);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.document.viewed",
      entityType: "staffDocuments", entityId: documentId,
      description: `Document "${d.title}" viewed`,
    });
    return true;
  },
});

export const deleteStaffDocument = mutation({
  args: { documentId: v.id("staffDocuments") },
  handler: async (ctx, { documentId }) => {
    const session = await requirePermission(ctx, "hr.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const d = await getSchoolRecord(ctx, schoolId, "staffDocuments", documentId);
    if (d.fileId) await ctx.db.delete(d.fileId);
    await ctx.db.delete(documentId);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.document.deleted",
      entityType: "staffDocuments", entityId: documentId,
      description: `Document "${d.title}" deleted`,
    });
    return documentId;
  },
});

/* ================================================================== */
/* Leave management                                                    */
/* ================================================================== */

export const listLeaveTypes = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "leave.view");
    return ctx.db
      .query("leaveTypes")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
  },
});

export const createLeaveType = mutation({
  args: { name: v.string(), annualDays: v.number(), paid: v.boolean(), requiresApproval: v.optional(v.boolean()) },
  handler: async (ctx, { name, annualDays, paid, requiresApproval }) => {
    const session = await requirePermission(ctx, "leave.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Leave type name is required.");
    if (!(annualDays > 0)) throw new ConvexError("Annual days must be positive.");
    const id = await ctx.db.insert("leaveTypes", {
      schoolId, name: trimmed, annualDays, paid, requiresApproval: requiresApproval ?? true, status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.leave_type.created",
      entityType: "leaveTypes", entityId: id, description: `Leave type "${trimmed}" (${annualDays} days) created`,
    });
    return id;
  },
});

/** Leaves visible to the caller: own leaves for everyone with leave.view; all when leave.manage. */
export const listLeaveRequests = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const session = await requirePermission(ctx, "leave.view");
    const schoolId = session.schoolId as Id<"schools">;
    const all = await ctx.db
      .query("leaveRequests")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const leaveTypes = await ctx.db
      .query("leaveTypes")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const staffMap = new Map<Id<"staff">, Doc<"staff">>();
    const enrich = async (l: Doc<"leaveRequests">) => {
      let staff: Doc<"staff"> | undefined = staffMap.get(l.staffId);
      if (!staff) { staff = (await ctx.db.get(l.staffId)) ?? undefined; if (staff) staffMap.set(l.staffId, staff); }
      const lt = leaveTypes.find((t) => t._id === l.leaveTypeId);
      return {
        _id: l._id,
        staffName: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : "—",
        employeeNumber: staff?.employeeNumber ?? "—",
        leaveTypeName: lt?.name ?? "Leave",
        startDate: l.startDate, endDate: l.endDate, days: l.days, reason: l.reason ?? null,
        status: l.status, decisionNote: l.decisionNote ?? null, decidedAt: l.decidedAt ?? null,
        createdAt: l.createdAt,
      };
    };
    // Non-managers only see their own requests (identity via staff.userId link).
    const isManager =
      session.role.role === "school_admin" ||
      session.role.role === "super_admin" ||
      session.role.role === "principal";
    let rows = all;
    if (!isManager) {
      const ownStaff = await ctx.db
        .query("staff")
        .withIndex("by_user", (q) => q.eq("userId", session.userId))
        .first();
      rows = ownStaff ? all.filter((l) => l.staffId === ownStaff._id) : [];
    }
    if (status && status !== "all") rows = rows.filter((l) => l.status === status);
    const out = await Promise.all(rows.map(enrich));
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const requestLeave = mutation({
  args: {
    staffId: v.id("staff"),
    leaveTypeId: v.id("leaveTypes"),
    startDate: v.string(),
    endDate: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { staffId, leaveTypeId, startDate, endDate, reason }) => {
    const session = await requirePermission(ctx, "leave.view");
    const schoolId = session.schoolId as Id<"schools">;
    const staff = await getSchoolRecord(ctx, schoolId, "staff", staffId);
    const lt = await getSchoolRecord(ctx, schoolId, "leaveTypes", leaveTypeId);
    if (!endDate || endDate < startDate) throw new ConvexError("Leave end date must be on or after the start date.");
    const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;
    if (!(days > 0)) throw new ConvexError("Leave must span at least one day.");
    // An employee requests their own leave unless the caller has hr.manage.
    const hasManage = await sessionHasPermission(ctx, session, "leave.manage");
    if (!hasManage && staff.userId !== session.userId) {
      throw new ConvexError("You can only request leave for yourself.");
    }
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_staff", (q) => q.eq("staffId", staffId))
      .first();
    const id = await ctx.db.insert("leaveRequests", {
      schoolId,
      staffId,
      employeeId: employee?._id,
      leaveTypeId,
      startDate, endDate, days,
      reason: reason?.trim(),
      status: "pending",
      requestedById: session.userId,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.leave.requested",
      entityType: "leaveRequests", entityId: id,
      description: `Leave requested: ${lt.name}, ${startDate} → ${endDate} (${days} day${days === 1 ? "" : "s"}) for ${[staff.firstName, staff.lastName].filter(Boolean).join(" ")}`,
    });
    return id;
  },
});

async function sessionHasPermission(ctx: unknown, session: { role: unknown }, permission: string): Promise<boolean> {
  // Static import of access.can (no runtime dynamic imports on Convex);
  // mirrors access.can for school roles.
  void ctx;
  return can(session.role as never, permission as never);
}

export const decideLeaveRequest = mutation({
  args: { leaveRequestId: v.id("leaveRequests"), decision: v.union(v.literal("approved"), v.literal("rejected")), decisionNote: v.optional(v.string()) },
  handler: async (ctx, { leaveRequestId, decision, decisionNote }) => {
    const session = await requirePermission(ctx, "leave.approve");
    const schoolId = session.schoolId as Id<"schools">;
    const l = await getSchoolRecord(ctx, schoolId, "leaveRequests", leaveRequestId);
    if (l.status !== "pending") throw new ConvexError("This leave request has already been decided.");
    await ctx.db.patch(leaveRequestId, {
      status: decision,
      decidedById: session.userId,
      decidedAt: Date.now(),
      decisionNote: decisionNote?.trim(),
    });
    const staff = await ctx.db.get(l.staffId);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: `hr.leave.${decision}`,
      entityType: "leaveRequests", entityId: leaveRequestId,
      description: `Leave ${decision}: ${l.days} day(s) from ${l.startDate} for ${[staff?.firstName, staff?.lastName].filter(Boolean).join(" ")}`,
    });
    return leaveRequestId;
  },
});

export const cancelLeaveRequest = mutation({
  args: { leaveRequestId: v.id("leaveRequests") },
  handler: async (ctx, { leaveRequestId }) => {
    const session = await requirePermission(ctx, "leave.view");
    const schoolId = session.schoolId as Id<"schools">;
    const l = await getSchoolRecord(ctx, schoolId, "leaveRequests", leaveRequestId);
    if (l.status !== "pending") throw new ConvexError("Only pending requests can be cancelled.");
    const staff = await ctx.db.get(l.staffId);
    const hasManage = await sessionHasPermission(ctx, session, "leave.manage");
    if (!hasManage && staff?.userId !== session.userId) {
      throw new ConvexError("You can only cancel your own leave requests.");
    }
    await ctx.db.patch(leaveRequestId, { status: "cancelled", decidedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "hr.leave.cancelled",
      entityType: "leaveRequests", entityId: leaveRequestId,
      description: `Leave request (${l.startDate}, ${l.days} day(s)) cancelled`,
    });
    return leaveRequestId;
  },
});

/** Leave balance: entitlement minus approved days in the current calendar year. */
export const leaveBalances = query({
  args: { staffId: v.optional(v.id("staff")) },
  handler: async (ctx, { staffId }) => {
    const session = await requirePermission(ctx, "leave.view");
    const schoolId = session.schoolId as Id<"schools">;
    const isManager =
      session.role.role === "school_admin" || session.role.role === "super_admin" || session.role.role === "principal";
    let targetStaffId = staffId;
    if (!isManager) {
      const ownStaff = await ctx.db
        .query("staff")
        .withIndex("by_user", (q) => q.eq("userId", session.userId))
        .first();
      if (!ownStaff) return [];
      targetStaffId = ownStaff._id;
    }
    const leaveTypes = await ctx.db
      .query("leaveTypes")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ts) => ts.filter((t) => t.status === "active"));
    const year = String(new Date().getFullYear());
    const out = [];
    for (const lt of leaveTypes) {
      const requests = await ctx.db
        .query("leaveRequests")
        .withIndex("by_staff", (q) => q.eq("staffId", targetStaffId as Id<"staff">))
        .collect()
        .then((rs) =>
          rs.filter(
            (r) =>
              r.leaveTypeId === lt._id &&
              r.status === "approved" &&
              r.startDate.startsWith(year),
          ),
        );
      const used = requests.reduce((s, r) => s + r.days, 0);
      out.push({
        leaveTypeId: lt._id,
        name: lt.name,
        annualDays: lt.annualDays,
        used,
        remaining: Math.max(0, lt.annualDays - used),
      });
    }
    return out;
  },
});

/* ================================================================== */
/* HR dashboard                                                        */
/* ================================================================== */

export const hrDashboard = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "hr.view");
    const schoolId = session.schoolId as Id<"schools">;
    const [employees, contracts, leaveRequests, departments] = await Promise.all([
      ctx.db.query("employees").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("contracts").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("leaveRequests").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("departments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    const activeStaff = await ctx.db
      .query("staff")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ss) => ss.filter((s) => s.employmentStatus === "active").length);
    const year = String(new Date().getFullYear());
    return {
      totalEmployees: employees.filter((e) => e.status === "active").length,
      staffWithoutHrProfile: Math.max(0, activeStaff - employees.filter((e) => e.status === "active").length),
      activeContracts: contracts.filter((c) => c.status === "active").length,
      draftContracts: contracts.filter((c) => c.status === "draft").length,
      expiringContracts: contracts.filter((c) => c.status === "active" && c.endDate && c.endDate.slice(0, 4) === year && c.endDate <= `${year}-12-31`).length,
      pendingLeave: leaveRequests.filter((l) => l.status === "pending").length,
      approvedLeaveThisYear: leaveRequests.filter((l) => l.status === "approved" && l.startDate.startsWith(year)).length,
      departmentCount: departments.filter((d) => d.status === "active").length,
    };
  },
});
