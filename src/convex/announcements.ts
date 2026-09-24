import { ConvexError, v } from "convex/values";
import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";
import { ANNOUNCEMENT_AUDIENCES } from "./schema";
import { notifyStudentCircle, notifySchoolMembers } from "./notify";

/* ================================================================== */
/* Announcement management (staff)                                      */
/* ================================================================== */

export const listAllAnnouncements = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const session = await requirePermission(ctx, "announcements.view");
    const schoolId = session.schoolId as Id<"schools">;
    const all = status
      ? await ctx.db
          .query("announcements")
          .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", status))
          .collect()
      : await ctx.db
          .query("announcements")
          .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
          .collect();
    const out = [];
    for (const a of all.sort((x, y) => (y.publishedAt ?? y.updatedAt ?? 0) - (x.publishedAt ?? x.updatedAt ?? 0))) {
      const classSection = a.classSectionId ? await ctx.db.get(a.classSectionId) : null;
      const grade = a.gradeLevelId ? await ctx.db.get(a.gradeLevelId) : null;
      out.push({
        _id: a._id,
        title: a.title,
        message: a.message,
        audience: a.audience,
        audienceLabel:
          a.audience === "class" && classSection
            ? `Class: ${classSection.streamName}`
            : a.audience === "grade" && grade
              ? `Grade: ${grade.name}`
              : a.audience,
        status: a.status,
        publishDate: a.publishDate ?? null,
        expiryDate: a.expiryDate ?? null,
        publishedAt: a.publishedAt ?? null,
        createdById: a.createdById,
      });
    }
    return { announcements: out };
  },
});

export const createAnnouncement = mutation({
  args: {
    title: v.string(),
    message: v.string(),
    audience: v.string(),
    classSectionId: v.optional(v.id("classSections")),
    gradeLevelId: v.optional(v.id("gradeLevels")),
    publishDate: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
    publishNow: v.optional(v.boolean()),
  },
  handler: async (ctx, { title, message, audience, classSectionId, gradeLevelId, publishDate, expiryDate, publishNow }) => {
    const session = await requirePermission(ctx, "announcements.create");
    const schoolId = session.schoolId as Id<"schools">;
    if (!ANNOUNCEMENT_AUDIENCES.includes(audience as (typeof ANNOUNCEMENT_AUDIENCES)[number])) {
      throw new ConvexError("Unknown audience.");
    }
    if (!title.trim() || !message.trim()) throw new ConvexError("Title and message are required.");
    if (audience === "class") {
      if (!classSectionId) throw new ConvexError("Choose a class for a class announcement.");
      await getSchoolRecord(ctx, schoolId, "classSections", classSectionId);
      // Teachers may only announce to classes they are allocated to.
      if (session.role.role === "teacher") {
        const staff = await ctx.db
          .query("staff")
          .withIndex("by_user", (q) => q.eq("userId", session.userId))
          .first();
        if (!staff) throw new ConvexError("No staff record linked to your account.");
        const allocations = await ctx.db
          .query("teacherAllocations")
          .withIndex("by_staff", (q) => q.eq("staffId", staff._id))
          .collect()
          .then((as) => as.filter((a) => a.status === "active" && a.classSectionId === classSectionId));
        if (allocations.length === 0) {
          throw new ConvexError("You can only post announcements to classes you teach.");
        }
      }
    }
    if (audience === "grade") {
      if (!gradeLevelId) throw new ConvexError("Choose a grade for a grade announcement.");
      await getSchoolRecord(ctx, schoolId, "gradeLevels", gradeLevelId);
      if (session.role.role === "teacher") {
        throw new ConvexError("Teachers can only post to their assigned classes.");
      }
    }
    const id = await ctx.db.insert("announcements", {
      schoolId,
      title: title.trim(),
      message: message.trim(),
      audience,
      classSectionId: audience === "class" ? classSectionId : undefined,
      gradeLevelId: audience === "grade" ? gradeLevelId : undefined,
      status: publishNow ? "published" : "draft",
      publishDate: publishDate ?? new Date().toISOString().slice(0, 10),
      expiryDate,
      createdById: session.userId,
      publishedAt: publishNow ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: publishNow ? "announcement.published" : "announcement.created",
      entityType: "announcements",
      entityId: id,
      description: `Announcement "${title}" ${publishNow ? "published" : "created as draft"} (${audience})`,
    });
    if (publishNow) await fanOutAnnouncement(ctx, schoolId, session.userId, id, title, message);
    return id;
  },
});

/** Fan out notifications for a newly published announcement. */
async function fanOutAnnouncement(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  actorId: Id<"users">,
  announcementId: Id<"announcements">,
  title: string,
  message: string,
): Promise<void> {
  void actorId;
  const payload = {
    type: "announcement",
    title: `Announcement: ${title}`,
    body: message.slice(0, 160),
    link: "/portal/announcements",
  };
  const a = await ctx.db.get(announcementId);
  if (!a) return;
  if (a.audience === "class" && a.classSectionId) {
    // Parents + students of that class.
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_class_section", (q) => q.eq("classSectionId", a.classSectionId!))
      .collect()
      .then((es) => es.filter((e) => e.status === "active"));
    let count = 0;
    for (const e of enrollments) {
      count += await notifyStudentCircle(ctx, schoolId, e.studentId, payload);
    }
    // Staff teaching that class get it too.
    const allocations = await ctx.db
      .query("teacherAllocations")
      .withIndex("by_class_section", (q) => q.eq("classSectionId", a.classSectionId!))
      .collect()
      .then((as) => as.filter((x) => x.status === "active"));
    const staffUsers = new Set<Id<"users">>();
    for (const al of allocations) {
      const staff = await ctx.db.get(al.staffId);
      if (staff?.userId) staffUsers.add(staff.userId);
    }
    for (const userId of staffUsers) {
      await ctx.db.insert("appNotifications", {
        schoolId,
        userId,
        type: "announcement",
        title: payload.title,
        body: payload.body,
        link: "/announcements",
        createdAt: Date.now(),
      });
      count++;
    }
    void actorId;
    return;
  }
  if (a.audience === "grade" && a.gradeLevelId) {
    const sections = await ctx.db
      .query("classSections")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ss) => ss.filter((s) => s.gradeLevelId === a.gradeLevelId && s.status === "active"));
    const enrollments = [];
    for (const s of sections) {
      enrollments.push(
        ...(await ctx.db
          .query("enrollments")
          .withIndex("by_class_section", (q) => q.eq("classSectionId", s._id))
          .collect()
          .then((es) => es.filter((e) => e.status === "active"))),
      );
    }
    let count = 0;
    for (const e of enrollments) {
      count += await notifyStudentCircle(ctx, schoolId, e.studentId, payload);
    }
    void count;
    return;
  }
  if (a.audience === "teachers") {
    await notifySchoolMembers(ctx, schoolId, { ...payload, link: "/announcements" }, ["teacher"]);
    return;
  }
  // "all", "parents", "students": school-wide fan-out is the base; role
  // filtering happens on read for portal views. Parents/students without
  // accounts simply have no membership row.
  await notifySchoolMembers(ctx, schoolId, { ...payload, link: "/portal/announcements" });
}

/* ================================================================== */
/* Announcement lifecycle                                               */
/* ================================================================== */

export const publishAnnouncement = mutation({
  args: { announcementId: v.id("announcements") },
  handler: async (ctx, { announcementId }) => {
    const session = await requirePermission(ctx, "announcements.publish");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "announcements", announcementId);
    if (a.status === "published") throw new ConvexError("Announcement is already published.");
    if (a.status === "archived") throw new ConvexError("Archived announcements cannot be republished.");
    await ctx.db.patch(announcementId, {
      status: "published",
      publishedAt: Date.now(),
      publishDate: a.publishDate ?? new Date().toISOString().slice(0, 10),
      updatedAt: Date.now(),
    });
    await fanOutAnnouncement(ctx, schoolId, session.userId, announcementId, a.title, a.message);
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "announcement.published",
      entityType: "announcements",
      entityId: announcementId,
      description: `Announcement "${a.title}" published (${a.audience})`,
    });
    return { ok: true };
  },
});

export const archiveAnnouncement = mutation({
  args: { announcementId: v.id("announcements") },
  handler: async (ctx, { announcementId }) => {
    const session = await requirePermission(ctx, "announcements.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "announcements", announcementId);
    await ctx.db.patch(announcementId, { status: "archived", archivedAt: Date.now(), updatedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "announcement.archived",
      entityType: "announcements",
      entityId: announcementId,
      description: `Announcement "${a.title}" archived`,
    });
    return { ok: true };
  },
});

export const updateAnnouncement = mutation({
  args: {
    announcementId: v.id("announcements"),
    title: v.optional(v.string()),
    message: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
  },
  handler: async (ctx, { announcementId, title, message, expiryDate }) => {
    const session = await requirePermission(ctx, "announcements.create");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "announcements", announcementId);
    if (
      a.createdById !== session.userId &&
      session.role.role !== "school_admin" &&
      session.role.role !== "super_admin"
    ) {
      throw new ConvexError("Only the author or an administrator can edit this announcement.");
    }
    await ctx.db.patch(announcementId, {
      title: title ?? a.title,
      message: message ?? a.message,
      expiryDate: expiryDate ?? a.expiryDate,
      updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "announcement.updated",
      entityType: "announcements",
      entityId: announcementId,
      description: `Announcement "${title ?? a.title}" updated`,
    });
    return { ok: true };
  },
});

/* ================================================================== */
/* Portal account provisioning (school admin controlled)                */
/* ================================================================== */

/* --- internal validation / completion steps for the invite actions --- */

export const validateParentInviteInternal = internalQuery({
  args: { schoolId: v.id("schools"), guardianId: v.id("guardians") },
  handler: async (ctx, { schoolId, guardianId }) => {
    const guardian = await ctx.db.get(guardianId);
    if (!guardian || guardian.schoolId !== schoolId) throw new ConvexError("Guardian not found in your school.");
    if (guardian.status !== "active") throw new ConvexError("Guardian record is not active.");
    const existingLink = await ctx.db
      .query("guardianPortalLinks")
      .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
      .collect()
      .then((ls) => ls.filter((l) => l.status === "active"));
    if (existingLink.length > 0) {
      throw new ConvexError("This guardian already has an active portal account.");
    }
    return { guardianName: [guardian.firstName, guardian.lastName].filter(Boolean).join(" ") };
  },
});

export const validateStudentInviteInternal = internalQuery({
  args: { schoolId: v.id("schools"), studentId: v.id("students") },
  handler: async (ctx, { schoolId, studentId }) => {
    const student = await ctx.db.get(studentId);
    if (!student || student.schoolId !== schoolId) throw new ConvexError("Student not found in your school.");
    if (student.studentStatus !== "active") throw new ConvexError("Student record is not active.");
    const existingLink = await ctx.db
      .query("studentPortalLinks")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect()
      .then((ls) => ls.filter((l) => l.status === "active"));
    if (existingLink.length > 0) {
      throw new ConvexError("This student already has an active portal account.");
    }
    return {
      studentName: [student.firstName, student.lastName].filter(Boolean).join(" "),
      admissionNumber: student.admissionNumber,
    };
  },
});

export const completeParentInviteInternal = internalMutation({
  args: {
    schoolId: v.id("schools"),
    guardianId: v.id("guardians"),
    userId: v.id("users"),
    actorId: v.id("users"),
    email: v.string(),
    guardianName: v.string(),
  },
  handler: async (ctx, { schoolId, guardianId, userId, actorId, email, guardianName }) => {
    await ctx.db.insert("schoolMemberships", {
      userId,
      schoolId,
      role: "parent",
      status: "active",
      createdById: actorId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("guardianPortalLinks", {
      schoolId,
      guardianId,
      userId,
      invitedById: actorId,
      invitedAt: Date.now(),
      status: "active",
    });
    await ctx.db.insert("auditLogs", {
      schoolId,
      userId: actorId,
      action: "parent.invited",
      entityType: "guardianPortalLinks",
      entityId: userId,
      description: `Parent portal account created for ${email} (guardian ${guardianName})`,
    });
    await ctx.db.insert("appNotifications", {
      schoolId,
      userId,
      type: "welcome",
      title: "Welcome to the Parent Portal",
      body: "Your account is ready. Your children are already linked.",
      link: "/portal",
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const completeStudentInviteInternal = internalMutation({
  args: {
    schoolId: v.id("schools"),
    studentId: v.id("students"),
    userId: v.id("users"),
    actorId: v.id("users"),
    email: v.string(),
    studentLabel: v.string(),
  },
  handler: async (ctx, { schoolId, studentId, userId, actorId, email, studentLabel }) => {
    await ctx.db.insert("schoolMemberships", {
      userId,
      schoolId,
      role: "student",
      status: "active",
      createdById: actorId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("studentPortalLinks", {
      schoolId,
      studentId,
      userId,
      invitedById: actorId,
      invitedAt: Date.now(),
      status: "active",
    });
    await ctx.db.insert("auditLogs", {
      schoolId,
      userId: actorId,
      action: "student.invited",
      entityType: "studentPortalLinks",
      entityId: userId,
      description: `Student portal account created for ${email} (${studentLabel})`,
    });
    await ctx.db.insert("appNotifications", {
      schoolId,
      userId,
      type: "welcome",
      title: "Welcome to the Student Portal",
      body: "Your account is ready.",
      link: "/student",
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Invite a guardian to the parent portal: creates the password account under
 * the given email and links it to the guardian record. Runs through the same
 * auth framework as staff account creation (team.createUser). No public
 * signup exists — only school admins reach this.
 */
export const inviteParent = action({
  args: {
    guardianId: v.id("guardians"),
    email: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { guardianId, email, password, name }) => {
    const session = await ctx.runQuery(internal.accounts.sessionInfo, { permission: "users.create" });
    const schoolId = session.schoolId;
    if (!schoolId) throw new ConvexError("Select a school to continue.");
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) throw new ConvexError("Enter a valid email address.");
    if (password.length < 8) throw new ConvexError("Password must be at least 8 characters.");
    const { guardianName } = await ctx.runQuery(internal.announcements.validateParentInviteInternal, {
      schoolId,
      guardianId,
    });
    const { createAccount, retrieveAccount } = await import("@convex-dev/auth/server");
    const existingAccount = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: normalized },
    }).catch(() => null);
    if (existingAccount) {
      throw new ConvexError("An account with this email already exists. Reset its password instead.");
    }
    await createAccount(ctx, {
      provider: "password",
      account: { id: normalized, secret: password },
      profile: { email: normalized, name: name ?? guardianName },
    });
    const account = await retrieveAccount(ctx, { provider: "password", account: { id: normalized } });
    if (!account) throw new ConvexError("Could not create the user account.");
    const userId = account.user._id as Id<"users">;
    await ctx.runMutation(internal.announcements.completeParentInviteInternal, {
      schoolId,
      guardianId,
      userId,
      actorId: session.userId,
      email: normalized,
      guardianName,
    });
    return { userId, email: normalized };
  },
});

/** Invite a student to the student portal (same controlled workflow). */
export const inviteStudent = action({
  args: {
    studentId: v.id("students"),
    email: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { studentId, email, password, name }) => {
    const session = await ctx.runQuery(internal.accounts.sessionInfo, { permission: "users.create" });
    const schoolId = session.schoolId;
    if (!schoolId) throw new ConvexError("Select a school to continue.");
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) throw new ConvexError("Enter a valid email address.");
    if (password.length < 8) throw new ConvexError("Password must be at least 8 characters.");
    const { studentName, admissionNumber } = await ctx.runQuery(internal.announcements.validateStudentInviteInternal, {
      schoolId,
      studentId,
    });
    const { createAccount, retrieveAccount } = await import("@convex-dev/auth/server");
    const existingAccount = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: normalized },
    }).catch(() => null);
    if (existingAccount) {
      throw new ConvexError("An account with this email already exists. Reset its password instead.");
    }
    await createAccount(ctx, {
      provider: "password",
      account: { id: normalized, secret: password },
      profile: { email: normalized, name: name ?? studentName },
    });
    const account = await retrieveAccount(ctx, { provider: "password", account: { id: normalized } });
    if (!account) throw new ConvexError("Could not create the user account.");
    const userId = account.user._id as Id<"users">;
    await ctx.runMutation(internal.announcements.completeStudentInviteInternal, {
      schoolId,
      studentId,
      userId,
      actorId: session.userId,
      email: normalized,
      studentLabel: admissionNumber,
    });
    return { userId, email: normalized };
  },
});

/** Revoke a portal link (parents or students). Sessions die on next check. */
export const revokePortalLink = mutation({
  args: { linkId: v.id("guardianPortalLinks") },
  handler: async (ctx, { linkId }) => {
    const session = await requirePermission(ctx, "users.disable");
    const schoolId = session.schoolId as Id<"schools">;
    const link = await getSchoolRecord(ctx, schoolId, "guardianPortalLinks", linkId);
    if (link.status === "revoked") throw new ConvexError("Link is already revoked.");
    await ctx.db.patch(linkId, { status: "revoked" });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "parent.portal_revoked",
      entityType: "guardianPortalLinks",
      entityId: linkId,
      description: "Parent portal access revoked",
    });
    return { ok: true };
  },
});

/** List portal links for the admin UI. */
export const listPortalLinks = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "users.view");
    const schoolId = session.schoolId as Id<"schools">;
    const guardianLinks = await ctx.db
      .query("guardianPortalLinks")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const studentLinks = await ctx.db
      .query("studentPortalLinks")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const out = [];
    for (const l of guardianLinks) {
      const guardian = await ctx.db.get(l.guardianId);
      const user = await ctx.db.get(l.userId);
      out.push({
        kind: "parent" as const,
        linkId: l._id,
        status: l.status,
        personName: guardian ? [guardian.firstName, guardian.lastName].filter(Boolean).join(" ") : "Guardian",
        email: user?.email ?? null,
        invitedAt: l.invitedAt,
      });
    }
    for (const l of studentLinks) {
      const student = await ctx.db.get(l.studentId);
      const user = await ctx.db.get(l.userId);
      out.push({
        kind: "student" as const,
        linkId: l._id,
        status: l.status,
        personName: student ? [student.firstName, student.lastName].filter(Boolean).join(" ") : "Student",
        email: user?.email ?? null,
        invitedAt: l.invitedAt,
      });
    }
    return { links: out };
  },
});

/* ================================================================== */
/* Internal seed helpers                                                */
/* ================================================================== */

export const seedLinkInternal = internalMutation({
  args: {
    guardianId: v.id("guardians"),
    userId: v.id("users"),
    schoolId: v.id("schools"),
  },
  handler: async (ctx, { guardianId, userId, schoolId }) => {
    const existing = await ctx.db
      .query("guardianPortalLinks")
      .withIndex("by_guardian", (q) => q.eq("guardianId", guardianId))
      .collect()
      .then((ls) => ls.find((l) => l.status === "active"));
    if (existing) return existing._id;
    return ctx.db.insert("guardianPortalLinks", {
      schoolId,
      guardianId,
      userId,
      invitedById: userId,
      invitedAt: Date.now(),
      status: "active",
    });
  },
});

export const seedStudentLinkInternal = internalMutation({
  args: {
    studentId: v.id("students"),
    userId: v.id("users"),
    schoolId: v.id("schools"),
  },
  handler: async (ctx, { studentId, userId, schoolId }) => {
    const existing = await ctx.db
      .query("studentPortalLinks")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect()
      .then((ls) => ls.find((l) => l.status === "active"));
    if (existing) return existing._id;
    return ctx.db.insert("studentPortalLinks", {
      schoolId,
      studentId,
      userId,
      invitedById: userId,
      invitedAt: Date.now(),
      status: "active",
    });
  },
});

export const seedAnnouncementInternal = internalMutation({
  args: {
    schoolId: v.id("schools"),
    createdById: v.id("users"),
    title: v.string(),
    message: v.string(),
    audience: v.string(),
    classSectionId: v.optional(v.id("classSections")),
    gradeLevelId: v.optional(v.id("gradeLevels")),
  },
  handler: async (ctx, { schoolId, createdById, title, message, audience, classSectionId, gradeLevelId }) => {
    const existing = await ctx.db
      .query("announcements")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((as) => as.find((a) => a.title === title));
    if (existing) return existing._id;
    return ctx.db.insert("announcements", {
      schoolId,
      title,
      message,
      audience,
      classSectionId,
      gradeLevelId,
      status: "published",
      publishDate: new Date().toISOString().slice(0, 10),
      createdById,
      publishedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
