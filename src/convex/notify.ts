import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/**
 * Notification fan-out helpers. Channel-agnostic by design: the in-app
 * appNotifications table is written here, and future channels (SMS/email)
 * attach at these call sites without touching feature code.
 */

/**
 * Notify a student's circle — the student's own portal account (if any) plus
 * every parent account linked to the student's guardians.
 */
export async function notifyStudentCircle(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  studentId: Id<"students">,
  payload: { type: string; title: string; body?: string; link?: string },
): Promise<number> {
  const now = Date.now();
  const recipients = new Set<Id<"users">>();

  const studentLinks = await ctx.db
    .query("studentPortalLinks")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect()
    .then((ls) => ls.filter((l) => l.status === "active" && l.schoolId === schoolId));
  for (const l of studentLinks) recipients.add(l.userId);

  const guardianLinks = await ctx.db
    .query("guardianStudents")
    .withIndex("by_student", (q) => q.eq("studentId", studentId))
    .collect();
  for (const gl of guardianLinks) {
    const portalLinks = await ctx.db
      .query("guardianPortalLinks")
      .withIndex("by_guardian", (q) => q.eq("guardianId", gl.guardianId))
      .collect()
      .then((ls) => ls.filter((l) => l.status === "active" && l.schoolId === schoolId));
    for (const pl of portalLinks) recipients.add(pl.userId);
  }

  for (const userId of recipients) {
    await ctx.db.insert("appNotifications", {
      schoolId,
      userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      createdAt: now,
    });
  }
  return recipients.size;
}

/** Notify every active member of a school (optionally filtered by role). */
export async function notifySchoolMembers(
  ctx: MutationCtx,
  schoolId: Id<"schools">,
  payload: { type: string; title: string; body?: string; link?: string },
  roles?: string[],
): Promise<number> {
  const memberships = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
    .collect()
    .then((ms) => ms.filter((m) => m.status === "active" && (!roles || roles.includes(m.role))));
  for (const m of memberships) {
    await ctx.db.insert("appNotifications", {
      schoolId,
      userId: m.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      createdAt: Date.now(),
    });
  }
  return memberships.length;
}
