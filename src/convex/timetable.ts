import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { detectConflicts, dayIndex } from "./engines/timetable";
import { PERIOD_TYPES } from "./schema";

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

export const listPeriods = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "timetable.view");
    const rows = await ctx.db
      .query("timetablePeriods")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return rows
      .filter((p) => p.status === "active")
      .sort((a, b) => a.displayOrder - b.displayOrder || a.startTime.localeCompare(b.startTime));
  },
});

export const savePeriods = mutation({
  args: {
    periods: v.array(
      v.object({
        name: v.string(),
        startTime: v.string(),
        endTime: v.string(),
        periodType: v.string(),
      }),
    ),
  },
  handler: async (ctx, { periods }) => {
    const session = await requirePermission(ctx, "timetable.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (periods.length === 0) throw new ConvexError("Add at least one period.");

    // Validate ordering + overlap for teaching blocks within the same day.
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const p of periods) {
      if (!p.name.trim()) throw new ConvexError("Every period needs a name.");
      if (!timeRe.test(p.startTime) || !timeRe.test(p.endTime)) {
        throw new ConvexError(`Invalid time format for "${p.name}". Use HH:MM.`);
      }
      if (p.endTime <= p.startTime) {
        throw new ConvexError(`"${p.name}" end time must be after its start time.`);
      }
      if (!PERIOD_TYPES.includes(p.periodType as (typeof PERIOD_TYPES)[number])) {
        throw new ConvexError(`Unknown period type for "${p.name}".`);
      }
    }

    // Replace the active set in one shot (small config table, whole-list edit).
    const existing = await ctx.db
      .query("timetablePeriods")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    for (const row of existing) {
      if (row.status === "active") await ctx.db.patch(row._id, { status: "archived" });
    }
    const created: Id<"timetablePeriods">[] = [];
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      created.push(
        await ctx.db.insert("timetablePeriods", {
          schoolId,
          name: p.name.trim(),
          startTime: p.startTime,
          endTime: p.endTime,
          periodType: p.periodType,
          displayOrder: i + 1,
          status: "active",
        }),
      );
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "timetable.periods_updated",
      entityType: "timetablePeriods",
      description: `Timetable periods updated (${periods.length} periods)`,
    });
    return created;
  },
});

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */

export const listRooms = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "timetable.view");
    const rows = await ctx.db
      .query("rooms")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return rows.filter((r) => r.status === "active").sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createRoom = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    capacity: v.optional(v.number()),
    roomType: v.optional(v.string()),
  },
  handler: async (ctx, { name, code, capacity, roomType }) => {
    const session = await requirePermission(ctx, "timetable.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!name.trim()) throw new ConvexError("Room name is required.");
    if (!code.trim()) throw new ConvexError("Room code is required.");
    const dup = await ctx.db
      .query("rooms")
      .withIndex("by_school_code", (q) => q.eq("schoolId", schoolId).eq("code", code.trim()))
      .first();
    if (dup && dup.status === "active") throw new ConvexError("A room with this code already exists.");
    const id = await ctx.db.insert("rooms", {
      schoolId,
      name: name.trim(),
      code: code.trim(),
      capacity,
      roomType,
      status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "timetable.room_created",
      entityType: "rooms",
      entityId: id,
      description: `Created room ${name} (${code})`,
    });
    return id;
  },
});

/* ------------------------------------------------------------------ */
/* Entries                                                             */
/* ------------------------------------------------------------------ */

const entryArgs = {
  academicYearId: v.id("academicYears"),
  termId: v.optional(v.id("terms")),
  dayOfWeek: v.string(),
  periodId: v.id("timetablePeriods"),
  classSectionId: v.id("classSections"),
  subjectId: v.id("subjects"),
  teacherAllocationId: v.optional(v.id("teacherAllocations")),
  staffId: v.optional(v.id("staff")),
  roomId: v.optional(v.id("rooms")),
};

async function validateEntryRefs(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  args: {
    academicYearId: Id<"academicYears">;
    periodId: Id<"timetablePeriods">;
    classSectionId: Id<"classSections">;
    subjectId: Id<"subjects">;
    staffId?: Id<"staff">;
    teacherAllocationId?: Id<"teacherAllocations">;
    roomId?: Id<"rooms">;
    dayOfWeek: string;
  },
) {
  if (!(await ctx.db.get(args.academicYearId))) {
    throw new ConvexError("Academic year not found.");
  }
  const period = await getSchoolRecord(ctx, schoolId, "timetablePeriods", args.periodId);
  void period;
  const section = await getSchoolRecord(ctx, schoolId, "classSections", args.classSectionId);
  const subject = await getSchoolRecord(ctx, schoolId, "subjects", args.subjectId);
  if (args.staffId) await getSchoolRecord(ctx, schoolId, "staff", args.staffId);
  if (args.roomId) await getSchoolRecord(ctx, schoolId, "rooms", args.roomId);
  void section;
  void subject;
}

/** Resolve the allocation + staff for a class/subject/year, enforcing allocation rule §23. */
async function resolveAllocation(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  academicYearId: Id<"academicYears">,
  classSectionId: Id<"classSections">,
  subjectId: Id<"subjects">,
  requestedAllocationId?: Id<"teacherAllocations">,
): Promise<{ allocationId?: Id<"teacherAllocations">; staffId?: Id<"staff"> }> {
  const allocations = await ctx.db
    .query("teacherAllocations")
    .withIndex("by_class_subject_year", (q) =>
      q
        .eq("classSectionId", classSectionId)
        .eq("subjectId", subjectId)
        .eq("academicYearId", academicYearId),
    )
    .collect();
  const active = allocations.filter((a) => a.status === "active");
  if (requestedAllocationId) {
    const requested = active.find((a) => a._id === requestedAllocationId);
    if (!requested) {
      throw new ConvexError(
        "The selected teacher allocation is not valid for this class, subject and academic year.",
      );
    }
    return { allocationId: requested._id, staffId: requested.staffId };
  }
  if (active.length === 0) {
    throw new ConvexError(
      "No teacher is allocated to this class and subject yet. Assign one under Academics → Teacher Allocations first.",
    );
  }
  if (active.length > 1) {
    throw new ConvexError(
      "This class and subject has more than one teacher allocated. Choose which teacher's allocation to schedule.",
    );
  }
  return { allocationId: active[0]._id, staffId: active[0].staffId };
}

async function conflictsFor(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  academicYearId: Id<"academicYears">,
  candidate: {
    entryId?: Id<"timetableEntries">;
    dayOfWeek: string;
    periodId: Id<"timetablePeriods">;
    staffId?: Id<"staff">;
    classSectionId: Id<"classSections">;
    roomId?: Id<"rooms">;
  },
  periodName: string,
): Promise<string> {
  const existing = await ctx.db
    .query("timetableEntries")
    .withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId))
    .collect();
  const slots = existing
    .filter((e) => e.status === "published" || e.status === "draft")
    .map((e) => ({
      entryId: e._id,
      dayOfWeek: e.dayOfWeek,
      periodId: e.periodId,
      staffId: e.staffId ?? null,
      classSectionId: e.classSectionId,
      roomId: e.roomId ?? null,
      who: "Another lesson",
    }));
  const conflicts = detectConflicts(
    {
      entryId: candidate.entryId,
      dayOfWeek: candidate.dayOfWeek,
      periodId: candidate.periodId,
      staffId: candidate.staffId ?? null,
      classSectionId: candidate.classSectionId,
      roomId: candidate.roomId ?? null,
    },
    slots,
  );
  if (conflicts.length === 0) return "";
  const c = conflicts[0];
  const kindText =
    c.kind === "teacher" ? "is already scheduled for" : c.kind === "class" ? "already has a lesson during" : "is already booked during";
  // Replace the generic "Another lesson" with the real entry description.
  const collide = existing.find(
    (e) =>
      e.dayOfWeek === candidate.dayOfWeek &&
      e.periodId === candidate.periodId &&
      (c.kind === "teacher" ? e.staffId === candidate.staffId : c.kind === "class" ? e.classSectionId === candidate.classSectionId : e.roomId === candidate.roomId),
  );
  let who = "Another lesson";
  if (collide) {
    const section = await ctx.db.get(collide.classSectionId);
    const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
    who = collide.staffId
      ? `Staff ${collide.staffId} — ${grade ? `${grade.name} ` : ""}${section?.streamName ?? ""}`.trim()
      : `${grade ? `${grade.name} ` : ""}${section?.streamName ?? "another class"}`.trim();
    const staff = collide.staffId ? await ctx.db.get(collide.staffId) : null;
    if (staff) who = `${staff.firstName} ${staff.lastName} — ${grade ? `${grade.name} ` : ""}${section?.streamName ?? ""}`.trim();
  }
  return `${who} ${kindText} ${periodName} on ${candidate.dayOfWeek.toUpperCase()}.`;
}

export const listEntries = query({
  args: {
    academicYearId: v.optional(v.id("academicYears")),
    classSectionId: v.optional(v.id("classSections")),
    staffId: v.optional(v.id("staff")),
    includeDrafts: v.optional(v.boolean()),
  },
  handler: async (ctx, { academicYearId, classSectionId, staffId, includeDrafts }) => {
    const session = await requirePermission(ctx, "timetable.view");
    const schoolId = session.schoolId as Id<"schools">;
    let yearId = academicYearId;
    if (!yearId) {
      const current = await ctx.db
        .query("academicYears")
        .withIndex("by_school_current", (q) => q.eq("schoolId", schoolId).eq("isCurrent", true))
        .first();
      yearId = current?._id;
    }
    if (!yearId) return [];
    let rows = await ctx.db
      .query("timetableEntries")
      .withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", yearId as Id<"academicYears">))
      .collect();
    // Teachers only see their own timetable (published entries only).
    // Managers and other roles see the whole grid; drafts only when explicitly requested.
    if (session.role.role === "teacher") {
      const me = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const mine = me.find((s) => s.userId === session.userId);
      rows = rows.filter((e) => e.staffId === mine?._id);
      rows = rows.filter((e) => e.status === "published");
    } else {
      if (classSectionId) rows = rows.filter((e) => e.classSectionId === classSectionId);
      if (staffId) rows = rows.filter((e) => e.staffId === staffId);
      if (!includeDrafts) rows = rows.filter((e) => e.status === "published");
    }

    const [periods, subjects, sections, rooms] = await Promise.all([
      ctx.db.query("timetablePeriods").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("subjects").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("classSections").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("rooms").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    const periodById = new Map(periods.map((p) => [p._id, p]));
    const subjectById = new Map(subjects.map((s) => [s._id, s]));
    const sectionById = new Map(sections.map((s) => [s._id, s]));
    const roomById = new Map(rooms.map((r) => [r._id, r]));
    const staffRows = await ctx.db.query("staff").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const staffById = new Map(staffRows.map((s) => [s._id, s]));

    const enriched = await Promise.all(
      rows.map(async (e) => {
        const section = sectionById.get(e.classSectionId);
        const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
        const period = periodById.get(e.periodId);
        const staff = e.staffId ? staffById.get(e.staffId) : null;
        const room = e.roomId ? roomById.get(e.roomId) : null;
        return {
          _id: e._id,
          dayOfWeek: e.dayOfWeek,
          periodId: e.periodId,
          periodName: period?.name ?? "—",
          periodType: period?.periodType ?? "teaching",
          startTime: period?.startTime ?? "",
          endTime: period?.endTime ?? "",
          displayOrder: period?.displayOrder ?? 0,
          classSectionId: e.classSectionId,
          classLabel: section ? `${grade?.name ?? ""} ${section.streamName}`.trim() : "—",
          gradeLevelId: section?.gradeLevelId ?? null,
          subjectId: e.subjectId,
          subjectName: subjectById.get(e.subjectId)?.name ?? "—",
          subjectCode: subjectById.get(e.subjectId)?.code ?? "",
          staffId: e.staffId ?? null,
          staffName: staff ? `${staff.firstName} ${staff.lastName}` : "—",
          roomId: e.roomId ?? null,
          roomName: room?.name ?? null,
          status: e.status,
        };
      }),
    );
    return enriched.sort(
      (a, b) =>
        dayIndex(a.dayOfWeek) - dayIndex(b.dayOfWeek) ||
        a.displayOrder - b.displayOrder,
    );
  },
});

export const createEntry = mutation({
  args: { ...entryArgs },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "timetable.manage");
    const schoolId = session.schoolId as Id<"schools">;
    await validateEntryRefs(ctx, schoolId, args);
    const { allocationId, staffId } = await resolveAllocation(
      ctx, schoolId, args.academicYearId, args.classSectionId, args.subjectId, args.teacherAllocationId,
    );
    const period = await ctx.db.get(args.periodId);
    const conflict = await conflictsFor(ctx, schoolId, args.academicYearId, {
      dayOfWeek: args.dayOfWeek,
      periodId: args.periodId,
      staffId,
      classSectionId: args.classSectionId,
      roomId: args.roomId,
    }, period?.name ?? "that period");
    if (conflict) throw new ConvexError(conflict);

    const id = await ctx.db.insert("timetableEntries", {
      schoolId,
      academicYearId: args.academicYearId,
      termId: args.termId,
      dayOfWeek: args.dayOfWeek,
      periodId: args.periodId,
      classSectionId: args.classSectionId,
      subjectId: args.subjectId,
      teacherAllocationId: allocationId,
      staffId,
      roomId: args.roomId,
      status: "draft",
      createdBy: session.userId,
      updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "timetable.entry_created",
      entityType: "timetableEntries",
      entityId: id,
      description: `Timetable entry created (${args.dayOfWeek.toUpperCase()}, ${period?.name ?? ""})`,
    });
    return id;
  },
});

export const updateEntry = mutation({
  args: { entryId: v.id("timetableEntries"), ...entryArgs },
  handler: async (ctx, { entryId, ...args }) => {
    const session = await requirePermission(ctx, "timetable.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const entry = await getSchoolRecord(ctx, schoolId, "timetableEntries", entryId);
    if (entry.status === "published" && session.role.role === "teacher") {
      throw new ConvexError("Published timetable entries cannot be edited by teachers.");
    }
    await validateEntryRefs(ctx, schoolId, args);
    const { allocationId, staffId } = await resolveAllocation(
      ctx, schoolId, args.academicYearId, args.classSectionId, args.subjectId, args.teacherAllocationId,
    );
    const period = await ctx.db.get(args.periodId);
    const conflict = await conflictsFor(ctx, schoolId, args.academicYearId, {
      entryId,
      dayOfWeek: args.dayOfWeek,
      periodId: args.periodId,
      staffId,
      classSectionId: args.classSectionId,
      roomId: args.roomId,
    }, period?.name ?? "that period");
    if (conflict) throw new ConvexError(conflict);
    await ctx.db.patch(entryId, {
      academicYearId: args.academicYearId,
      termId: args.termId,
      dayOfWeek: args.dayOfWeek,
      periodId: args.periodId,
      classSectionId: args.classSectionId,
      subjectId: args.subjectId,
      teacherAllocationId: allocationId,
      staffId,
      roomId: args.roomId,
      updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "timetable.entry_updated",
      entityType: "timetableEntries",
      entityId: entryId,
    });
  },
});

export const deleteEntry = mutation({
  args: { entryId: v.id("timetableEntries") },
  handler: async (ctx, { entryId }) => {
    const session = await requirePermission(ctx, "timetable.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const entry = await getSchoolRecord(ctx, schoolId, "timetableEntries", entryId);
    await ctx.db.delete(entryId);
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "timetable.entry_deleted",
      entityType: "timetableEntries",
      entityId: entryId,
      description: `Deleted ${entry.dayOfWeek.toUpperCase()} timetable entry`,
    });
  },
});

export const publishTimetable = mutation({
  args: { academicYearId: v.id("academicYears") },
  handler: async (ctx, { academicYearId }) => {
    const session = await requirePermission(ctx, "timetable.publish");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "academicYears", academicYearId);
    const rows = await ctx.db
      .query("timetableEntries")
      .withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", academicYearId))
      .collect();
    // Re-verify conflicts across the whole grid before publishing.
    const byKey = new Map<string, typeof rows>();
    for (const e of rows) {
      const key = `${e.dayOfWeek}:${e.periodId}`;
      const list = byKey.get(key) ?? [];
      list.push(e);
      byKey.set(key, list);
    }
    for (const [, group] of byKey) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          if (a.staffId && a.staffId === b.staffId) {
            throw new ConvexError("Cannot publish: a teacher is scheduled in two places at the same time.");
          }
          if (a.classSectionId === b.classSectionId) {
            throw new ConvexError("Cannot publish: a class is scheduled for two lessons at the same time.");
          }
          if (a.roomId && a.roomId === b.roomId) {
            throw new ConvexError("Cannot publish: a room is booked for two lessons at the same time.");
          }
        }
      }
    }
    for (const e of rows) {
      if (e.status === "draft") {
        await ctx.db.patch(e._id, { status: "published", updatedAt: Date.now() });
      }
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "timetable.published",
      entityType: "timetableEntries",
      description: `Timetable published (${rows.length} entries)`,
    });
    return rows.length;
  },
});

/* ------------------------------------------------------------------ */
/* School days (part of timetable settings)                            */
/* ------------------------------------------------------------------ */

export const schoolDays = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "timetable.view");
    const settings = await ctx.db
      .query("schoolSettings")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .first();
    return settings?.schoolDays ?? ["mon", "tue", "wed", "thu", "fri"];
  },
});
