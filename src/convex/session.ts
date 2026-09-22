import { ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Auth } from "convex/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { can, type Permission, type SessionRole } from "./access";
import type { Doc, Id } from "./_generated/dataModel";

/** The resolved security context of the caller. */
export interface Session {
  userId: Id<"users">;
  user: Doc<"users">;
  role: SessionRole;
  /** Present when the caller is a super admin who has entered a school context. */
  schoolId: Id<"schools"> | null;
  isPlatform: boolean;
}

interface AuthLikeCtx {
  auth: Auth;
}

async function loadUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"users">> {
  const user = await ctx.db.get(userId);
  if (!user) throw new ConvexError("Your account no longer exists.");
  if (user.isActive === false) {
    throw new ConvexError(
      "Your account has been disabled. Contact your administrator.",
    );
  }
  return user;
}

/**
 * Resolve the caller's session: platform super admin, or a school-scoped role.
 * Throws if the user is not signed in or has no active memberships.
 */
export async function getSession(
  ctx: QueryCtx | MutationCtx,
  opts: { schoolId?: string | null } = {},
): Promise<Session> {
  const userId = await getAuthUserId(ctx as unknown as AuthLikeCtx);
  if (!userId) throw new ConvexError("You are not signed in.");
  const user = await loadUser(ctx, userId);

  const memberships = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const active = memberships.filter((m) => m.status === "active");

  const superMembership = active.find((m) => m.role === "super_admin");
  if (superMembership) {
    // Super admin: platform role, optionally entering a school context.
    const requested =
      opts.schoolId && opts.schoolId.length > 0 ? opts.schoolId : null;
    if (requested) {
      const school = await ctx.db.get(requested as Id<"schools">);
      if (!school) throw new ConvexError("School not found.");
      return {
        userId,
        user,
        role: { kind: "school", role: "super_admin", schoolId: school._id },
        schoolId: school._id,
        isPlatform: true,
      };
    }
    return {
      userId,
      user,
      role: { kind: "platform", role: "super_admin" },
      schoolId: null,
      isPlatform: true,
    };
  }

  // School-scoped user: pick the requested school or their only membership.
  let membership = active[0];
  if (!membership) {
    throw new ConvexError(
      "Your account is not linked to any school yet. Ask your administrator to assign you.",
    );
  }
  if (opts.schoolId && opts.schoolId.length > 0) {
    const found = active.find((m) => m.schoolId === opts.schoolId);
    if (!found) {
      throw new ConvexError("You do not have access to this school.");
    }
    membership = found;
  }

  return {
    userId,
    user,
    role: {
      kind: "school",
      role: membership.role as import("./schema").Role,
      schoolId: membership.schoolId as Id<"schools">,
    },
    schoolId: membership.schoolId as Id<"schools">,
    isPlatform: false,
  };
}

/** Session that must include a school context. */
export async function requireSchoolSession(
  ctx: QueryCtx | MutationCtx,
  opts: { schoolId?: string | null } = {},
): Promise<Session & { schoolId: Id<"schools">; role: { kind: "school"; role: import("./schema").Role; schoolId: Id<"schools"> } }> {
  const session = await getSession(ctx, opts);
  if (!session.schoolId) {
    throw new ConvexError("Select a school to continue.");
  }
  return session as Session & {
    schoolId: Id<"schools">;
    role: { kind: "school"; role: import("./schema").Role; schoolId: Id<"schools"> };
  };
}

export async function requirePlatformSession(
  ctx: QueryCtx | MutationCtx,
): Promise<Session & { role: { kind: "platform"; role: "super_admin" } }> {
  const session = await getSession(ctx);
  if (!session.isPlatform) {
    throw new ConvexError("You do not have platform access.");
  }
  return session as Session & { role: { kind: "platform"; role: "super_admin" } };
}

export async function requirePermission(
  ctx: QueryCtx | MutationCtx,
  permission: Permission,
  opts: { schoolId?: string | null } = {},
): Promise<Session> {
  const session = await getSession(ctx, opts);
  if (!can(session.role, permission)) {
    throw new ConvexError("You do not have permission to perform this action.");
  }
  return session;
}

/* ------------------------------------------------------------------ */
/* Tenant-safe record access                                           */
/* ------------------------------------------------------------------ */

type SchoolScopedTable =
  | "students"
  | "guardians"
  | "staff"
  | "academicYears"
  | "terms"
  | "gradeLevels"
  | "classSections"
  | "subjects"
  | "teacherAllocations"
  | "enrollments"
  | "guardianStudents"
  | "timetablePeriods"
  | "rooms"
  | "timetableEntries"
  | "attendanceSessions"
  | "attendanceRecords"
  | "assignments"
  | "assignmentRecipients"
  | "assessmentTypes"
  | "assessments"
  | "assessmentScores"
  | "gradingSchemes"
  | "gradeBands"
  | "subjectResults"
  | "reportCards"
  | "feeCategories"
  | "paymentMethods"
  | "ledgerAccounts"
  | "feeStructures"
  | "feeItems"
  | "studentAccounts"
  | "invoices"
  | "invoiceItems"
  | "ledgerTransactions"
  | "ledgerEntries"
  | "payments"
  | "receipts"
  | "discounts"
  | "scholarships"
  | "refunds"
  | "expenses";

/**
 * Fetch a school-scoped record by ID and verify it belongs to the caller's
 * school. This is the single choke point that blocks cross-tenant reads and
 * writes by forged IDs.
 */
export async function getSchoolRecord<T extends SchoolScopedTable>(
  ctx: QueryCtx | MutationCtx,
  schoolId: Id<"schools">,
  table: T,
  id: string,
): Promise<Doc<T>> {
  const record = await ctx.db.get(id as Id<T>);
  if (!record) throw new ConvexError("Record not found.");
  const recordSchoolId = (record as Record<string, unknown>).schoolId;
  if (recordSchoolId !== schoolId) {
    throw new ConvexError("You do not have access to this record.");
  }
  return record as Doc<T>;
}

/** Human-readable name for audit trails. */
export function userDisplayName(user: Doc<"users"> | null): string {
  if (!user) return "Unknown user";
  return user.name ?? user.email ?? "User";
}
