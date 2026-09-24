import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { notifyStudentCircle } from "./notify";
import { ASSIGNMENT_STATUS } from "./schema";
import { validDate } from "./attendance";

/** Teacher authorization: must hold an active allocation for class+subject+year. */
async function assertTeacherAuthorized(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  userId: Id<"users">,
  academicYearId: Id<"academicYears">,
  classSectionId: Id<"classSections">,
  subjectId: Id<"subjects">,
): Promise<Id<"staff">> {
  const staff = await ctx.db
    .query("staff")
    .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
    .collect();
  const mine = staff.find((s) => s.userId === userId && s.employmentStatus === "active");
  if (!mine) throw new ConvexError("Your staff record is not linked to your account.");
  const allocs = await ctx.db
    .query("teacherAllocations")
    .withIndex("by_staff", (q) => q.eq("staffId", mine._id))
    .collect();
  const ok = allocs.some(
    (a) =>
      a.status === "active" &&
      a.academicYearId === academicYearId &&
      a.classSectionId === classSectionId &&
      a.subjectId === subjectId,
  );
  if (!ok) {
    throw new ConvexError("You are not allocated to this class for this subject.");
  }
  return mine._id;
}

const createArgs = {
  academicYearId: v.id("academicYears"),
  termId: v.id("terms"),
  classSectionId: v.id("classSections"),
  subjectId: v.id("subjects"),
  title: v.string(),
  instructions: v.optional(v.string()),
  issueDate: v.string(),
  dueDate: v.string(),
  maxMarks: v.optional(v.number()),
  isGraded: v.optional(v.boolean()),
};

export const create = mutation({
  args: { ...createArgs, teacherAllocationId: v.optional(v.id("teacherAllocations")) },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "assignments.create");
    const schoolId = session.schoolId as Id<"schools">;
    if (!args.title.trim()) throw new ConvexError("Give the assignment a title.");
    if (!validDate(args.issueDate) || !validDate(args.dueDate)) {
      throw new ConvexError("Invalid issue or due date.");
    }
    if (args.dueDate < args.issueDate) {
      throw new ConvexError("Due date must be on or after the issue date.");
    }
    if (args.maxMarks !== undefined && args.maxMarks <= 0) {
      throw new ConvexError("Maximum marks must be a positive number.");
    }

    // Cross-school integrity (§74): referenced records must belong to this school
    // and hang together (class must belong to the academic year, term to the year).
    const section = await getSchoolRecord(ctx, schoolId, "classSections", args.classSectionId);
    if (section.academicYearId !== args.academicYearId) {
      throw new ConvexError("This class does not belong to the selected academic year.");
    }
    const term = await getSchoolRecord(ctx, schoolId, "terms", args.termId);
    if (term.academicYearId !== args.academicYearId) {
      throw new ConvexError("This term does not belong to the selected academic year.");
    }
    await getSchoolRecord(ctx, schoolId, "subjects", args.subjectId);

    let staffId: Id<"staff">;
    if (session.role.role === "teacher") {
      staffId = await assertTeacherAuthorized(
        ctx, schoolId, session.userId, args.academicYearId, args.classSectionId, args.subjectId,
      );
    } else {
      // Admin/principal creating on behalf of the allocated teacher.
      const allocs = await ctx.db
        .query("teacherAllocations")
        .withIndex("by_class_subject_year", (q) =>
          q
            .eq("classSectionId", args.classSectionId)
            .eq("subjectId", args.subjectId)
            .eq("academicYearId", args.academicYearId),
        )
        .collect();
      const active = allocs.filter((a) => a.status === "active");
      if (active.length === 0) {
        throw new ConvexError("No teacher is allocated to this class and subject yet.");
      }
      staffId = active[0].staffId;
    }

    const id = await ctx.db.insert("assignments", {
      schoolId,
      academicYearId: args.academicYearId,
      termId: args.termId,
      classSectionId: args.classSectionId,
      subjectId: args.subjectId,
      staffId,
      teacherAllocationId: args.teacherAllocationId,
      title: args.title.trim(),
      instructions: args.instructions,
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      maxMarks: args.maxMarks,
      isGraded: args.isGraded ?? false,
      status: "draft",
      createdBy: session.userId,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "assignment.created",
      entityType: "assignments",
      entityId: id,
      description: `Assignment "${args.title}" created (draft)`,
    });
    return id;
  },
});

/** Publish an assignment: validates and snapshots recipients (§26). */
export const publish = mutation({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }) => {
    const session = await requirePermission(ctx, "assignments.publish");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assignments", assignmentId);
    if (a.status !== "draft" && a.status !== "published") {
      throw new ConvexError("Only draft or published assignments can be published.");
    }
    // A graded assignment should link to the unified assessment system (§28):
    // linking happens separately; publishing does not require it.

    // Recipient snapshot: students actively enrolled at publish time.
    const existing = await ctx.db
      .query("assignmentRecipients")
      .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
      .collect();
    if (existing.length === 0) {
      const enrolls = await ctx.db
        .query("enrollments")
        .withIndex("by_class_section", (q) => q.eq("classSectionId", a.classSectionId))
        .collect();
      const active = enrolls.filter((e) => e.status === "active");
      for (const e of active) {
        await ctx.db.insert("assignmentRecipients", {
          schoolId,
          assignmentId,
          studentId: e.studentId,
          enrollmentId: e._id,
        });
      }
    }
    await ctx.db.patch(assignmentId, {
      status: "published",
      publishedAt: a.publishedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    // Phase 4: notify recipients' portal circles (students + parents).
    const recipients = existing.length > 0 ? existing : await ctx.db
      .query("assignmentRecipients")
      .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
      .collect();
    for (const r of recipients) {
      await notifyStudentCircle(ctx, schoolId, r.studentId, {
        type: "assignment",
        title: `New assignment: ${a.title}`,
        body: "A new assignment has been published. Check the portal for details.",
        link: "/portal/assignments",
      });
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "assignment.published",
      entityType: "assignments",
      entityId: assignmentId,
      description: `Assignment "${a.title}" published`,
    });
  },
});

export const update = mutation({
  args: {
    assignmentId: v.id("assignments"),
    title: v.string(),
    instructions: v.optional(v.string()),
    dueDate: v.string(),
    maxMarks: v.optional(v.number()),
    isGraded: v.optional(v.boolean()),
  },
  handler: async (ctx, { assignmentId, ...rest }) => {
    const session = await requirePermission(ctx, "assignments.update");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assignments", assignmentId);
    if (a.status === "archived") throw new ConvexError("Archived assignments cannot be edited.");
    if (session.role.role === "teacher" && a.staffId) {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = staff.find((s) => s.userId === session.userId);
      if (a.staffId !== mine?._id) {
        throw new ConvexError("You can only edit your own assignments.");
      }
    }
    if (rest.dueDate < a.issueDate) {
      throw new ConvexError("Due date must be on or after the issue date.");
    }
    await ctx.db.patch(assignmentId, { ...rest, title: rest.title.trim(), updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "assignment.updated",
      entityType: "assignments",
      entityId: assignmentId,
      description: `Assignment "${rest.title}" updated`,
    });
  },
});

/** Link a graded assignment to an assessment so marks flow into results (§28). */
export const linkAssessment = mutation({
  args: { assignmentId: v.id("assignments"), assessmentId: v.id("assessments") },
  handler: async (ctx, { assignmentId, assessmentId }) => {
    const session = await requirePermission(ctx, "assignments.update");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assignments", assignmentId);
    const as = await getSchoolRecord(ctx, schoolId, "assessments", assessmentId);
    if (a.classSectionId !== as.classSectionId || a.subjectId !== as.subjectId) {
      throw new ConvexError("The assessment must be for the same class and subject as the assignment.");
    }
    await ctx.db.patch(assignmentId, { assessmentId, updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "assignment.linked_assessment",
      entityType: "assignments",
      entityId: assignmentId,
    });
  },
});

export const closeOrArchive = mutation({
  args: { assignmentId: v.id("assignments"), action: v.union(v.literal("close"), v.literal("archive")) },
  handler: async (ctx, { assignmentId, action }) => {
    const session = await requirePermission(ctx, "assignments.update");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assignments", assignmentId);
    if (!ASSIGNMENT_STATUS.includes(action === "close" ? "closed" : "archived")) {
      throw new ConvexError("Unsupported status.");
    }
    if (action === "close" && a.status !== "published") {
      throw new ConvexError("Only published assignments can be closed.");
    }
    await ctx.db.patch(assignmentId, { status: action === "close" ? "closed" : "archived", updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: action === "close" ? "assignment.closed" : "assignment.archived",
      entityType: "assignments",
      entityId: assignmentId,
    });
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export const list = query({
  args: {
    termId: v.optional(v.id("terms")),
    classSectionId: v.optional(v.id("classSections")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { termId, classSectionId, status }) => {
    const session = await requirePermission(ctx, "assignments.view");
    const schoolId = session.schoolId as Id<"schools">;
    let effectiveTermId = termId;
    if (!effectiveTermId) {
      const t = await ctx.db
        .query("terms")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      effectiveTermId = t?._id;
    }
    if (!effectiveTermId) return [];
    let rows = await ctx.db
      .query("assignments")
      .withIndex("by_school_term", (q) => q.eq("schoolId", schoolId).eq("termId", effectiveTermId as Id<"terms">))
      .collect();
    if (classSectionId) rows = rows.filter((r) => r.classSectionId === classSectionId);
    if (status && status !== "all") rows = rows.filter((r) => r.status === status);
    // Teachers see only their own assignments (allocation-scoped view).
    if (session.role.role === "teacher") {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = staff.find((s) => s.userId === session.userId);
      rows = rows.filter((r) => r.staffId === mine?._id);
    }
    const enriched = await Promise.all(
      rows.map(async (a) => {
        const section = await ctx.db.get(a.classSectionId);
        const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
        const subject = await ctx.db.get(a.subjectId);
        const staff = await ctx.db.get(a.staffId);
        return {
          _id: a._id,
          title: a.title,
          status: a.status,
          issueDate: a.issueDate,
          dueDate: a.dueDate,
          maxMarks: a.maxMarks,
          isGraded: a.isGraded ?? false,
          assessmentId: a.assessmentId ?? null,
          classSectionId: a.classSectionId,
          classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
          subjectName: subject?.name ?? "—",
          staffName: staff ? `${staff.firstName} ${staff.lastName}` : "—",
          staffId: a.staffId,
        };
      }),
    );
    return enriched.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  },
});

export const get = query({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, { assignmentId }) => {
    const session = await requirePermission(ctx, "assignments.view");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assignments", assignmentId);
    if (session.role.role === "teacher") {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = staff.find((s) => s.userId === session.userId);
      if (a.staffId !== mine?._id) throw new ConvexError("You can only view your own assignments.");
    }
    const section = await ctx.db.get(a.classSectionId);
    const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
    const subject = await ctx.db.get(a.subjectId);
    const recipients = await ctx.db
      .query("assignmentRecipients")
      .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
      .collect();
    return {
      ...a,
      classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
      subjectName: subject?.name ?? "—",
      recipientCount: recipients.length,
    };
  },
});

/** Allocation options for the create dialog (teacher-scoped). */
export const myAllocationOptions = query({
  args: { academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { academicYearId }) => {
    const session = await requirePermission(ctx, "assignments.view");
    const schoolId = session.schoolId as Id<"schools">;
    let yearId = academicYearId;
    if (!yearId) {
      const y = await ctx.db
        .query("academicYears")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      yearId = y?._id;
    }
    if (!yearId) return [];
    const staff = await ctx.db
      .query("staff")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const mine = staff.find((s) => s.userId === session.userId);
    const isTeacher = session.role.role === "teacher";
    const allocs = await ctx.db
      .query("teacherAllocations")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const filtered = allocs.filter(
      (a) => a.status === "active" && a.academicYearId === yearId && (!isTeacher || a.staffId === mine?._id),
    );
    const enriched = await Promise.all(
      filtered.map(async (a) => {
        const section = await ctx.db.get(a.classSectionId);
        const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
        const subject = await ctx.db.get(a.subjectId);
        return {
          allocationId: a._id,
          staffId: a.staffId,
          classSectionId: a.classSectionId,
          subjectId: a.subjectId,
          label: `${subject?.name ?? "?"} · ${grade?.name ?? ""} ${section?.streamName ?? ""}`.trim(),
        };
      }),
    );
    return enriched.sort((a, b) => a.label.localeCompare(b.label));
  },
});
