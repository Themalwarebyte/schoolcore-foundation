/**
 * Phase 7 — invitation creation core (plain function, not a Convex function).
 *
 * Shared by phase7/invitations.inviteUser (admin UI) and phase7/onboarding
 * (wizard step 3). Contains no `internal`/`api` handle references so the
 * generated api object never needs this module's in-flight types (that was
 * the source of tsc TS7022 circular-inference errors).
 */
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { recordAudit } from "../audit";
import { randomToken } from "../phase6/constants";
import { ROLES, type Role } from "../schema";
import type { Session } from "../session";

export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const SCHOOL_ASSIGNABLE: Role[] = ["school_admin", "principal", "teacher", "accountant", "parent", "student"];

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create (or reactivate) a pending invitation with a one-time activation
 * token for an email+school. Never creates a password. Returns the raw token
 * (to hand to the admin UI; production relays it via the queued email).
 */
export async function createInvitationCore(
  ctx: MutationCtx,
  opts: {
    session: Session;
    schoolId: Id<"schools">;
    email: string;
    name?: string;
    role: string;
    guardianId?: Id<"guardians">;
    studentId?: Id<"students">;
  },
): Promise<{ invitationId: Id<"invitations">; userId: Id<"users">; existed: boolean; token: string }> {
  const { session, schoolId, role, guardianId, studentId } = opts;
  const normalized = opts.email.trim().toLowerCase();
  if (!normalized.includes("@")) throw new ConvexError("Enter a valid email address.");
  if (!ROLES.includes(role as Role) || !SCHOOL_ASSIGNABLE.includes(role as Role)) {
    throw new ConvexError("This role cannot be invited within a school.");
  }
  if (role === "school_admin" && !session.isPlatform && session.role.role !== "school_admin") {
    throw new ConvexError("Only an administrator can invite school administrators.");
  }

  // Find-or-create the user row (no password account yet — the activation
  // code creates it when redeemed).
  const existing = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", normalized))
    .collect();
  let userId: Id<"users">;
  let existed: boolean;
  if (existing.length > 0) {
    userId = existing[0]._id;
    existed = true;
  } else {
    userId = await ctx.db.insert("users", {
      email: normalized,
      name: opts.name?.trim() || normalized.split("@")[0],
      isActive: true,
    });
    existed = false;
  }

  const membership = await ctx.db
    .query("schoolMemberships")
    .withIndex("by_user_school", (q) => q.eq("userId", userId).eq("schoolId", schoolId))
    .unique();
  if (membership) {
    await ctx.db.patch(membership._id, { role, status: "active" });
  } else {
    await ctx.db.insert("schoolMemberships", {
      userId,
      schoolId,
      role,
      status: "active",
      createdById: session.userId,
    });
  }

  // Parent/student portal links ride along on invitation (Phase 4 model).
  if (role === "parent" && guardianId) {
    await ctx.db.insert("guardianPortalLinks", {
      schoolId,
      guardianId,
      userId,
      invitedById: session.userId,
      invitedAt: Date.now(),
      status: "active",
    });
  }
  if (role === "student" && studentId) {
    await ctx.db.insert("studentPortalLinks", {
      schoolId,
      studentId,
      userId,
      invitedById: session.userId,
      invitedAt: Date.now(),
      status: "active",
    });
  }

  // Supersede pending invitations for the same email+school.
  const stale = await ctx.db
    .query("invitations")
    .withIndex("by_email", (q) => q.eq("email", normalized))
    .collect();
  for (const s of stale) {
    if (s.schoolId === schoolId && s.status === "pending") {
      await ctx.db.patch(s._id, { status: "revoked" });
    }
  }

  const rawToken = randomToken();
  const tokenHash = await sha256Hex(rawToken);
  const now = Date.now();
  const invitationId = await ctx.db.insert("invitations", {
    schoolId,
    email: normalized,
    name: opts.name?.trim(),
    role,
    status: "pending",
    invitedById: session.userId,
    invitedAt: now,
    expiresAt: now + INVITE_TTL_MS,
  });
  await ctx.db.insert("activationTokens", {
    userId,
    schoolId,
    kind: "invitation",
    tokenHash,
    status: "pending",
    createdById: session.userId,
    createdAt: now,
    expiresAt: now + INVITE_TTL_MS,
  });

  await ctx.db.insert("commMessages", {
    schoolId,
    channel: "email",
    event: "portal_invite",
    recipientKind: "custom",
    recipientUserId: userId,
    recipientAddress: normalized,
    body: `You have been invited to SchoolCore\n\nSet your password to activate your ${role} account. Your one-time activation code: ${rawToken}`,
    status: "queued",
    attempts: 0,
    queuedAt: Date.now(),
  });

  await recordAudit(ctx, {
    userId: session.userId, schoolId, action: "invitation.created",
    entityType: "invitations", entityId: invitationId,
    description: `Invited ${normalized} as ${role}${existed ? " (existing account)" : ""}`,
    metadata: { role, email: normalized },
  });
  return { invitationId, userId, existed, token: rawToken };
}
