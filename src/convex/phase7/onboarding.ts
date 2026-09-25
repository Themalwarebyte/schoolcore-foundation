/**
 * Phase 7 — school onboarding wizard.
 *
 * Steps: profile → academics → initial users → import → activate.
 * Writes the wizard state onto the onboardingRecords row created at approval
 * time. Initial users are created through the invitation flow (phase7/
 * invitations) — never with plaintext passwords. Activation flips the school
 * status to "active" and mirrors it on the originating request.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requirePermission } from "../session";
import { recordAudit } from "../audit";

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export const getStatus = query({
  args: { schoolId: v.optional(v.id("schools")) },
  handler: async (ctx, { schoolId }) => {
    const session = await requirePermission(ctx, "onboarding.view", { schoolId });
    if (!session.schoolId) throw new ConvexError("Select a school to continue.");
    const sid = session.schoolId;
    let record = await ctx.db
      .query("onboardingRecords")
      .withIndex("by_school", (q) => q.eq("schoolId", sid))
      .first();
    const school = await ctx.db.get(session.schoolId);
    return {
      record: record
        ? {
            profileDone: record.profileDone,
            academicsDone: record.academicsDone,
            usersDone: record.usersDone,
            importDone: record.importDone,
            activated: record.activated,
            activatedAt: record.activatedAt ?? null,
            requestId: record.requestId ?? null,
          }
        : null,
      schoolStatus: school?.status ?? null,
      schoolName: school?.name ?? null,
    };
  },
});

/** Platform view of every school's onboarding progress (super admin). */
export const platformList = query({
  args: {},
  handler: async (ctx) => {
    const { requirePlatformSession } = await import("../session");
    await requirePlatformSession(ctx);
    const rows = await ctx.db.query("onboardingRecords").collect();
    return Promise.all(
      rows.map(async (r) => {
        const school = await ctx.db.get(r.schoolId);
        const request = r.requestId ? await ctx.db.get(r.requestId) : null;
        return {
          _id: r._id,
          schoolId: r.schoolId,
          schoolName: school?.name ?? "—",
          schoolCode: school?.code ?? "",
          schoolStatus: school?.status ?? null,
          contactEmail: request?.contactEmail ?? null,
          profileDone: r.profileDone,
          academicsDone: r.academicsDone,
          usersDone: r.usersDone,
          importDone: r.importDone,
          activated: r.activated,
        };
      }),
    );
  },
});

/* ------------------------------------------------------------------ */
/* Step 1 — profile                                                    */
/* ------------------------------------------------------------------ */

export const saveProfile = mutation({
  args: {
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    physicalAddress: v.optional(v.string()),
    postalAddress: v.optional(v.string()),
    county: v.optional(v.string()),
    country: v.optional(v.string()),
    currency: v.optional(v.string()),
    curriculum: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "onboarding.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const school = await ctx.db.get(schoolId);
    if (!school) throw new ConvexError("School not found.");
    await ctx.db.patch(schoolId, {
      phone: args.phone ?? school.phone,
      email: args.email ?? school.email,
      website: args.website ?? school.website,
      physicalAddress: args.physicalAddress ?? school.physicalAddress,
      postalAddress: args.postalAddress ?? school.postalAddress,
      county: args.county ?? school.county,
      country: args.country ?? school.country,
      currency: args.currency ?? school.currency,
      curriculum: args.curriculum ?? school.curriculum,
    });
    const record = await ctx.db
      .query("onboardingRecords")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    if (record) {
      await ctx.db.patch(record._id, { profileDone: true, updatedAt: Date.now() });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "onboarding.profile_saved",
      entityType: "onboardingRecords", entityId: record?._id ?? null,
      description: "Onboarding step 1 (school profile) completed",
    });
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------------ */
/* Step 2 — academics: years, terms, grades, classes, subjects         */
/* ------------------------------------------------------------------ */

export const setupAcademics = mutation({
  args: {
    yearName: v.string(),
    yearStart: v.string(),
    yearEnd: v.string(),
    termCount: v.number(),
    gradeNames: v.array(v.string()),
    streams: v.array(v.string()),
    subjectNames: v.array(v.string()),
  },
  handler: async (ctx, { yearName, yearStart, yearEnd, termCount, gradeNames, streams, subjectNames }) => {
    const session = await requirePermission(ctx, "onboarding.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!yearName.trim()) throw new ConvexError("Academic year name is required.");
    if (yearEnd <= yearStart) throw new ConvexError("The academic year must end after it starts.");
    if (termCount < 1 || termCount > 4) throw new ConvexError("Term count must be between 1 and 4.");
    const gradeList = gradeNames.map((g) => g.trim()).filter(Boolean);
    if (gradeList.length === 0) throw new ConvexError("Add at least one grade level.");
    const streamList = streams.map((s) => s.trim()).filter(Boolean);
    if (streamList.length === 0) streamList.push("A");

    // Reuse an existing year with the same name, otherwise create it.
    const years = await ctx.db.query("academicYears").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    let year: Doc<"academicYears"> | undefined = years.find((y) => y.name.trim() === yearName.trim());
    if (!year) {
      const yearId = await ctx.db.insert("academicYears", {
        schoolId, name: yearName.trim(), startDate: yearStart, endDate: yearEnd,
        status: "active", isCurrent: years.every((y) => !y.isCurrent),
      });
      year = (await ctx.db.get(yearId)) ?? undefined;
    }
    if (!year) throw new ConvexError("Could not create the academic year.");

    // Terms spread evenly across the year window.
    const existingTerms = await ctx.db.query("terms").withIndex("by_academic_year", (q) => q.eq("academicYearId", year._id)).collect();
    if (existingTerms.length === 0) {
      const span = new Date(yearEnd).getTime() - new Date(yearStart).getTime();
      for (let t = 0; t < termCount; t++) {
        const startMs = new Date(yearStart).getTime() + (span * t) / termCount;
        const endMs = new Date(yearStart).getTime() + (span * (t + 1)) / termCount - 24 * 3600 * 1000;
        const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
        await ctx.db.insert("terms", {
          schoolId, academicYearId: year._id, name: `Term ${t + 1}`,
          startDate: iso(startMs), endDate: iso(endMs), status: "active",
          isCurrent: t === 0, displayOrder: t + 1,
        });
      }
    }

    // Grade levels (reuse by name) and one class per grade × stream.
    const existingGrades = await ctx.db.query("gradeLevels").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
    const existingClasses = await ctx.db.query("classSections").withIndex("by_school_year", (q) => q.eq("schoolId", schoolId).eq("academicYearId", year._id)).collect();
    const existingSubjects = await ctx.db.query("subjects").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();

    for (let i = 0; i < gradeList.length; i++) {
      const name = gradeList[i];
      let grade: Doc<"gradeLevels"> | undefined = existingGrades.find((g) => g.name.trim() === name);
      if (!grade) {
        const gid = await ctx.db.insert("gradeLevels", {
          schoolId, name, displayOrder: i + 1, status: "active",
        });
        grade = (await ctx.db.get(gid)) ?? undefined;
      }
      if (!grade) continue;
      for (const stream of streamList) {
        const label = stream.toLowerCase();
        const exists = existingClasses.some(
          (c) => c.gradeLevelId === grade!._id && c.streamName.toLowerCase() === label,
        );
        if (!exists) {
          await ctx.db.insert("classSections", {
            schoolId, academicYearId: year._id, gradeLevelId: grade._id,
            streamName: stream, status: "active",
          });
        }
      }
    }

    for (const subject of subjectNames) {
      const name = subject.trim();
      if (!name) continue;
      const code = name.slice(0, 4).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
      await ctx.db.insert("subjects", { schoolId, name, code, status: "active" });
    }

    const record = await ctx.db
      .query("onboardingRecords")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    if (record) await ctx.db.patch(record._id, { academicsDone: true, updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "onboarding.academics_saved",
      entityType: "onboardingRecords", entityId: record?._id ?? null,
      description: `Onboarding step 2 (academics) completed: ${gradeList.length} grades, ${streamList.length} streams`,
    });
    return { ok: true as const, academicYearId: year._id };
  },
});

/* ------------------------------------------------------------------ */
/* Step 3 — initial users (via invitations, no orphan users)           */
/* ------------------------------------------------------------------ */

/**
 * Queues the initial administrator trio (school_admin / principal /
 * accountant) as invitations. Every invitee gets User + SchoolMembership +
 * Role at ACTIVATION time — never an orphan user row.
 */
export const inviteInitialUsers = mutation({
  args: {
    users: v.array(v.object({
      email: v.string(),
      name: v.string(),
      role: v.union(v.literal("school_admin"), v.literal("principal"), v.literal("accountant")),
    })),
  },
  handler: async (ctx, { users }) => {
    const session = await requirePermission(ctx, "onboarding.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (users.length === 0) throw new ConvexError("Add at least one initial user.");
    const { inviteUser } = await import("./invitations");
    const results: Array<{ email: string; invitationId: Id<"invitations"> }> = [];
    for (const u of users) {
      const id = await inviteUser(ctx, {
        session, schoolId,
        email: u.email, name: u.name, role: u.role,
      });
      results.push({ email: u.email, invitationId: id });
    }
    const record = await ctx.db
      .query("onboardingRecords")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    if (record) await ctx.db.patch(record._id, { usersDone: true, updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "onboarding.users_invited",
      entityType: "onboardingRecords", entityId: record?._id ?? null,
      description: `Onboarding step 3: ${users.length} initial user invitation(s) sent`,
    });
    return { invited: results };
  },
});

/* ------------------------------------------------------------------ */
/* Step 5 — activate                                                   */
/* ------------------------------------------------------------------ */

export const activateSchool = mutation({
  args: { confirmName: v.string() },
  handler: async (ctx, { confirmName }) => {
    const session = await requirePermission(ctx, "onboarding.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const school = await ctx.db.get(schoolId);
    if (!school) throw new ConvexError("School not found.");
    const record = await ctx.db
      .query("onboardingRecords")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    if (!record) throw new ConvexError("No onboarding record — approve a school request first.");
    if (record.activated) throw new ConvexError("This school is already activated.");
    if (!record.profileDone) throw new ConvexError("Complete the school profile step first.");
    if (!record.academicsDone) throw new ConvexError("Complete the academic setup step first.");
    if (!record.usersDone) throw new ConvexError("Invite the initial administrators first.");
    if (confirmName.trim() !== school.name) {
      throw new ConvexError("Type the school name exactly to confirm activation.");
    }

    const now = Date.now();
    await ctx.db.patch(record._id, { activated: true, activatedAt: now, activatedById: session.userId, updatedAt: now });
    await ctx.db.patch(schoolId, { status: "active" });
    if (record.requestId) {
      const request = await ctx.db.get(record.requestId);
      if (request && request.status !== "active") {
        await ctx.db.patch(record.requestId, { status: "active", updatedAt: now });
      }
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "onboarding.activated",
      entityType: "schools", entityId: schoolId,
      description: `School "${school.name}" activated — onboarding complete`,
    });
    return { ok: true as const };
  },
});

/** Marks the import step done (called by the bulk import engine on confirm). */
export const markImportDone = mutation({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "onboarding.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const record = await ctx.db
      .query("onboardingRecords")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .first();
    if (record) await ctx.db.patch(record._id, { importDone: true, updatedAt: Date.now() });
    return { ok: true as const };
  },
});
