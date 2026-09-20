import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getSession, requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const list = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    department: v.optional(v.string()),
    paginationOpts: v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) }),
  },
  handler: async (ctx, { search, status, department, paginationOpts }) => {
    const session = await requirePermission(ctx, "staff.view");
    const result = await ctx.db
      .query("staff")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .order("desc")
      .paginate(paginationOpts);
    let rows = result.page;
    if (status && status !== "all") rows = rows.filter((s) => s.employmentStatus === status);
    if (department && department !== "all") rows = rows.filter((s) => s.department === department);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (s) =>
          s.firstName.toLowerCase().includes(q) ||
          s.lastName.toLowerCase().includes(q) ||
          s.employeeNumber.toLowerCase().includes(q) ||
          (s.email ?? "").toLowerCase().includes(q),
      );
    }
    const enriched = await Promise.all(
      rows.map(async (s) => {
        const allocations = await ctx.db
          .query("teacherAllocations")
          .withIndex("by_staff", (q) => q.eq("staffId", s._id))
          .collect();
        return { ...s, allocationCount: allocations.filter((a) => a.status === "active").length };
      }),
    );
    return { ...result, page: enriched };
  },
});

export const get = query({
  args: { staffId: v.id("staff") },
  handler: async (ctx, { staffId }) => {
    const session = await getSession(ctx);
    const member = await ctx.db.get(staffId);
    if (!member) throw new ConvexError("Staff member not found.");
    if (member.schoolId !== session.schoolId) {
      throw new ConvexError("You do not have access to this staff member.");
    }
    const allocations = await ctx.db
      .query("teacherAllocations")
      .withIndex("by_staff", (q) => q.eq("staffId", staffId))
      .collect();
    const enriched = await Promise.all(
      allocations.map(async (a) => {
        const subject = await ctx.db.get(a.subjectId);
        const section = await ctx.db.get(a.classSectionId);
        let classLabel: string | null = null;
        if (section) {
          const grade = await ctx.db.get(section.gradeLevelId);
          classLabel = grade ? `${grade.name} ${section.streamName}` : section.streamName;
        }
        const year = await ctx.db.get(a.academicYearId);
        return {
          _id: a._id,
          subjectName: subject?.name ?? "—",
          classLabel,
          yearName: year?.name ?? "—",
          status: a.status,
        };
      }),
    );
    let userName: string | null = null;
    let userEmail: string | null = null;
    if (member.userId) {
      const user = await ctx.db.get(member.userId);
      userName = user?.name ?? null;
      userEmail = user?.email ?? null;
    }
    return { ...member, allocations: enriched, userName, userEmail };
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "staff.view");
    const rows = await ctx.db
      .query("staff")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    const teachers = rows.filter((s) => s.jobTitle?.toLowerCase().includes("teach")).length;
    return {
      total: rows.length,
      active: rows.filter((s) => s.employmentStatus === "active").length,
      teachers,
      onLeave: rows.filter((s) => s.employmentStatus === "on_leave").length,
    };
  },
});

export const departments = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "staff.view");
    const rows = await ctx.db
      .query("staff")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return [...new Set(rows.map((s) => s.department).filter(Boolean))] as string[];
  },
});

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    employeeNumber: v.string(),
    firstName: v.string(),
    middleName: v.optional(v.string()),
    lastName: v.string(),
    gender: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    department: v.optional(v.string()),
    employmentType: v.optional(v.string()),
    employmentStatus: v.string(),
    hireDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    createAccount: v.optional(v.boolean()),
    accountPassword: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "staff.create");
    const schoolId = session.schoolId as Id<"schools">;
    const employeeNumber = args.employeeNumber.trim();
    if (!employeeNumber) throw new ConvexError("Employee number is required.");
    const dup = await ctx.db
      .query("staff")
      .withIndex("by_school_employee", (q) =>
        q.eq("schoolId", schoolId).eq("employeeNumber", employeeNumber),
      )
      .unique();
    if (dup) throw new ConvexError("This employee number is already in use at your school.");

    let userId: Id<"users"> | undefined;
    if (args.createAccount) {
      if (!args.email) throw new ConvexError("An email is required to create a user account.");
      if (!args.accountPassword || args.accountPassword.length < 8) {
        throw new ConvexError("Account password must be at least 8 characters.");
      }
      const email = args.email.trim().toLowerCase();
      const existingUser = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .unique();
      if (existingUser) {
        userId = existingUser._id;
      } else {
        userId = await ctx.db.insert("users", {
          email,
          name: `${args.firstName} ${args.lastName}`.trim(),
          isActive: true,
        });
      }
      // Teacher role membership; password provisioning happens in an action.
      await ctx.runMutation(internal.accounts.addMembershipInternal, {
        userId: userId as Id<"users">,
        schoolId,
        role: "teacher",
      });
    }

    const id = await ctx.db.insert("staff", {
      schoolId,
      employeeNumber,
      userId,
      firstName: args.firstName.trim(),
      middleName: args.middleName?.trim() || undefined,
      lastName: args.lastName.trim(),
      gender: args.gender || undefined,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim().toLowerCase() || undefined,
      jobTitle: args.jobTitle?.trim() || undefined,
      department: args.department?.trim() || undefined,
      employmentType: args.employmentType || undefined,
      employmentStatus: args.employmentStatus,
      hireDate: args.hireDate || undefined,
      notes: args.notes?.trim() || undefined,
      updatedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "staff.created",
      entityType: "staff",
      entityId: id,
      description: `Added staff ${args.firstName} ${args.lastName} (${employeeNumber})`,
    });
    return id;
  },
});

export const update = mutation({
  args: {
    staffId: v.id("staff"),
    firstName: v.string(),
    middleName: v.optional(v.string()),
    lastName: v.string(),
    gender: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    department: v.optional(v.string()),
    employmentType: v.optional(v.string()),
    employmentStatus: v.string(),
    hireDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { staffId, ...args }) => {
    const session = await requirePermission(ctx, "staff.update");
    const member = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "staff", staffId);
    await ctx.db.patch(staffId, {
      ...args,
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      updatedAt: Date.now(),
      updatedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: member.schoolId,
      action: "staff.updated",
      entityType: "staff",
      entityId: staffId,
      description: `Updated staff ${args.firstName} ${args.lastName}`,
    });
    return null;
  },
});

export const archive = mutation({
  args: { staffId: v.id("staff"), status: v.union(v.literal("archived"), v.literal("terminated"), v.literal("retired")) },
  handler: async (ctx, { staffId, status }) => {
    const session = await requirePermission(ctx, "staff.archive");
    const { getSchoolRecord } = await import("./session");
    const member = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "staff", staffId);
    await ctx.db.patch(staffId, {
      employmentStatus: status,
      updatedAt: Date.now(),
      updatedById: session.userId,
    });
    // Deactivate their allocations and linked account.
    const allocations = await ctx.db
      .query("teacherAllocations")
      .withIndex("by_staff", (q) => q.eq("staffId", staffId))
      .collect();
    for (const a of allocations) {
      if (a.status === "active") await ctx.db.patch(a._id, { status: "inactive" });
    }
    if (member.userId) {
      const linkedUserId = member.userId;
      await ctx.db.patch(linkedUserId, { isActive: false });
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", linkedUserId))
        .collect();
      for (const s of sessions) await ctx.db.delete(s._id);
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: member.schoolId,
      action: "staff.archived",
      entityType: "staff",
      entityId: staffId,
      description: `${member.firstName} ${member.lastName} (${member.employeeNumber}) → ${status}`,
    });
    return null;
  },
});
