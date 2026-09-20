import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
    paginationOpts: v.object({ numItems: v.number(), cursor: v.union(v.string(), v.null()) }),
  },
  handler: async (ctx, { search, status, paginationOpts }) => {
    const session = await requirePermission(ctx, "guardians.view");
    const paged = await ctx.db
      .query("guardians")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .order("desc")
      .paginate(paginationOpts);
    let rows = paged.page;
    if (status && status !== "all") {
      rows = rows.filter((g) => g.status === status);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (g) =>
          g.firstName.toLowerCase().includes(q) ||
          g.lastName.toLowerCase().includes(q) ||
          (g.phone ?? "").includes(q) ||
          (g.email ?? "").toLowerCase().includes(q),
      );
    }
    const enriched = await Promise.all(
      rows.map(async (g) => {
        const links = await ctx.db
          .query("guardianStudents")
          .withIndex("by_guardian", (q) => q.eq("guardianId", g._id))
          .collect();
        const children = await Promise.all(
          links.map(async (l) => {
            const s = await ctx.db.get(l.studentId);
            if (!s) return null;
            return { _id: s._id, name: `${s.firstName} ${s.lastName}`, admissionNumber: s.admissionNumber };
          }),
        );
        return {
          ...g,
          childrenCount: children.filter(Boolean).length,
          children: children.filter(Boolean),
        };
      }),
    );
    return { page: enriched, isDone: true, continueCursor: "" };
  },
});

export const get = query({
  args: { guardianId: v.id("guardians") },
  handler: async (ctx, { guardianId }) => {
    const session = await getSession(ctx);
    const guardian = await ctx.db.get(guardianId);
    if (!guardian) throw new ConvexError("Guardian not found.");
    if (guardian.schoolId !== session.schoolId) {
      throw new ConvexError("You do not have access to this guardian.");
    }
    const links = await ctx.db
      .query("guardianStudents")
      .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
      .collect();
    const children = await Promise.all(
      links.map(async (l) => {
        const s = await ctx.db.get(l.studentId);
        return s
          ? {
              linkId: l._id,
              _id: s._id,
              name: `${s.firstName} ${s.lastName}`,
              admissionNumber: s.admissionNumber,
              relationship: l.relationship ?? guardian.relationship ?? "guardian",
              isPrimary: !!l.isPrimary,
              isEmergencyContact: !!l.isEmergencyContact,
            }
          : null;
      }),
    );
    return { ...guardian, children: children.filter(Boolean) };
  },
});

/** Guardians linked to a student (for the student profile). */
export const forStudentGuardians = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "guardians.view");
    const student = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "students", studentId);
    const links = await ctx.db
      .query("guardianStudents")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .collect();
    const rows = await Promise.all(
      links.map(async (l) => {
        const g = await ctx.db.get(l.guardianId);
        if (!g) return null;
        return {
          linkId: l._id,
          guardianId: g._id,
          name: `${g.firstName} ${g.lastName}`,
          relationshipLabel: l.relationship ?? g.relationship ?? "guardian",
          phone: g.phone,
          isPrimary: !!l.isPrimary,
          isEmergencyContact: !!l.isEmergencyContact,
        };
      }),
    );
    return rows.filter(Boolean);
  },
});

/** Guardian candidates for linking: search by name/phone/email. */
export const searchForLinking = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    const session = await requirePermission(ctx, "guardians.view");
    const all = await ctx.db
      .query("guardians")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    let rows = all;
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (g) =>
          `${g.firstName} ${g.lastName}`.toLowerCase().includes(q) ||
          (g.phone ?? "").includes(q) ||
          (g.email ?? "").toLowerCase().includes(q),
      );
    }
    return rows.slice(0, 20).map((g) => ({
      _id: g._id,
      name: `${g.firstName} ${g.lastName}`,
      phone: g.phone,
      relationship: g.relationship,
    }));
  },
});

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    firstName: v.string(),
    middleName: v.optional(v.string()),
    lastName: v.string(),
    relationship: v.optional(v.string()),
    phone: v.optional(v.string()),
    altPhone: v.optional(v.string()),
    email: v.optional(v.string()),
    occupation: v.optional(v.string()),
    address: v.optional(v.string()),
    nationalId: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "guardians.create");
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!firstName || !lastName) throw new ConvexError("First and last name are required.");
    if (args.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
      throw new ConvexError("Email format is invalid.");
    }
    const id = await ctx.db.insert("guardians", {
      schoolId: session.schoolId as Id<"schools">,
      firstName,
      middleName: args.middleName?.trim() || undefined,
      lastName,
      relationship: args.relationship || undefined,
      phone: args.phone?.trim() || undefined,
      altPhone: args.altPhone?.trim() || undefined,
      email: args.email?.trim().toLowerCase() || undefined,
      occupation: args.occupation?.trim() || undefined,
      address: args.address?.trim() || undefined,
      nationalId: args.nationalId?.trim() || undefined,
      status: args.status ?? "active",
      updatedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: session.schoolId,
      action: "guardian.created",
      entityType: "guardians",
      entityId: id,
      description: `Added guardian ${firstName} ${lastName}`,
    });
    return id;
  },
});

export const update = mutation({
  args: {
    guardianId: v.id("guardians"),
    firstName: v.string(),
    middleName: v.optional(v.string()),
    lastName: v.string(),
    relationship: v.optional(v.string()),
    phone: v.optional(v.string()),
    altPhone: v.optional(v.string()),
    email: v.optional(v.string()),
    occupation: v.optional(v.string()),
    address: v.optional(v.string()),
    nationalId: v.optional(v.string()),
    status: v.string(),
  },
  handler: async (ctx, { guardianId, ...args }) => {
    const session = await requirePermission(ctx, "guardians.update");
    const guardian = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "guardians", guardianId);
    await ctx.db.patch(guardianId, {
      ...args,
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      email: args.email?.trim().toLowerCase() || undefined,
      updatedAt: Date.now(),
      updatedById: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: guardian.schoolId,
      action: "guardian.updated",
      entityType: "guardians",
      entityId: guardianId,
      description: `Updated guardian ${args.firstName} ${args.lastName}`,
    });
    return null;
  },
});

/** Link a guardian to a student (many-to-many, safe for siblings). */
export const linkStudent = mutation({
  args: {
    guardianId: v.id("guardians"),
    studentId: v.id("students"),
    relationship: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
    isEmergencyContact: v.optional(v.boolean()),
  },
  handler: async (ctx, { guardianId, studentId, ...flags }) => {
    const session = await requirePermission(ctx, "guardians.update");
    const guardian = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "guardians", guardianId);
    const student = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "students", studentId);
    // Same-school enforcement: both records already verified to belong to the
    // caller's school, so a cross-school link is impossible by construction.
    const existing = await ctx.db
      .query("guardianStudents")
      .withIndex("by_guardian_student", (q) =>
        q.eq("guardianId", guardianId).eq("studentId", studentId),
      )
      .unique();
    if (existing) throw new ConvexError("This guardian is already linked to this student.");
    if (flags.isPrimary) {
      // Only one primary guardian per student.
      const links = await ctx.db
        .query("guardianStudents")
        .withIndex("by_student", (q) => q.eq("studentId", studentId))
        .collect();
      for (const l of links) {
        if (l.isPrimary) await ctx.db.patch(l._id, { isPrimary: false });
      }
    }
    await ctx.db.insert("guardianStudents", {
      schoolId: session.schoolId as Id<"schools">,
      guardianId,
      studentId,
      relationship: flags.relationship ?? guardian.relationship,
      isPrimary: !!flags.isPrimary,
      isEmergencyContact: !!flags.isEmergencyContact,
      receivesAcademicCommunication: true,
      receivesFinancialCommunication: true,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: session.schoolId,
      action: "guardian.linked",
      entityType: "guardianStudents",
      entityId: guardianId,
      description: `Linked ${guardian.firstName} ${guardian.lastName} to ${student.firstName} ${student.lastName}`,
    });
    return null;
  },
});

export const unlinkStudent = mutation({
  args: { linkId: v.id("guardianStudents") },
  handler: async (ctx, { linkId }) => {
    const session = await requirePermission(ctx, "guardians.update");
    const link = await getSchoolRecord(ctx, session.schoolId as Id<"schools">, "guardianStudents", linkId);
    const guardian = await ctx.db.get(link.guardianId);
    const student = await ctx.db.get(link.studentId);
    await ctx.db.delete(linkId);
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: session.schoolId,
      action: "guardian.unlinked",
      entityType: "guardianStudents",
      entityId: linkId,
      description: `Removed link between ${guardian ? `${guardian.firstName} ${guardian.lastName}` : "guardian"} and ${student ? `${student.firstName} ${student.lastName}` : "student"}`,
    });
    return null;
  },
});
