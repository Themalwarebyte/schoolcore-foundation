import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { retrieveAccount } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

/** INTERNAL: every users row sharing an email. */
export const usersByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .collect();
    return rows.map((u) => ({
      userId: u._id as string,
      name: u.name ?? null,
      email: u.email ?? null,
    }));
  },
});

/** INTERNAL: memberships (with school name) for one user id. */
export const membershipsOf = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return Promise.all(
      rows.map(async (m) => {
        const school = m.schoolId ? await ctx.db.get(m.schoolId) : null;
        return {
          membershipId: m._id as string,
          role: m.role,
          status: m.status,
          schoolId: (m.schoolId as string | undefined) ?? null,
          schoolName: school?.name ?? null,
        };
      }),
    );
  },
});

/**
 * INTERNAL-ONLY diagnostic (no auth guard by design; internal functions are
 * not callable from the network). Reports, for a demo email:
 *   - normalized email
 *   - whether a password authAccount exists
 *   - the canonical authenticated userId (what sign-in resolves to)
 *   - how many users rows share that email (legacy duplicates)
 *   - the canonical user's memberships: role, schoolId, status, school name
 *   - the user's active state
 * No password hashes, tokens, or secrets are returned or logged.
 *
 * Run: bunx convex run diagnostics:accountAudit '{"email":"admin@schoolcore.dev"}'
 */
interface AuditMembership {
  membershipId: string;
  role: string;
  status: string;
  schoolId: string | null;
  schoolName: string | null;
}

interface AuditResult {
  email: string;
  passwordAccountExists: boolean;
  canonicalUserId: string | null;
  usersRowCount: number;
  canonicalUserActive: boolean | null;
  membershipsOnCanonicalUser: AuditMembership[];
  allUserRows: Array<{
    userId: string;
    name: string | null;
    isCanonical: boolean;
    memberships: Array<Omit<AuditMembership, "membershipId">>;
  }>;
}

export const accountAudit = internalAction({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<AuditResult> => {
    const normalized = email.trim().toLowerCase();

    // 1. Resolve the password authAccount → canonical user id. This is the
    //    exact user record a successful sign-in resolves to.
    const account = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: normalized },
    }).catch(() => null);

    // 2. All users rows with this email (duplicate detection).
    const allRows = await ctx.runQuery(internal.diagnostics.usersByEmail, {
      email: normalized,
    });

    // 3. Memberships on the canonical user.
    let memberships: AuditMembership[] = [];
    let canonicalUserId: string | null = null;
    let canonicalActive: boolean | null = null;

    if (account) {
      canonicalUserId = account.user._id as string;
      memberships = await ctx.runQuery(internal.diagnostics.membershipsOf, {
        userId: canonicalUserId as Id<"users">,
      });
      canonicalActive = await ctx.runQuery(internal.accounts.isUserActive, {
        userId: canonicalUserId as Id<"users">,
      });
    }

    // 4. Duplicate rows' memberships (for divergence diagnosis).
    const rowsWithMemberships = [] as Array<{
      userId: string;
      name: string | null;
      isCanonical: boolean;
      memberships: Array<{ role: string; status: string; schoolId: string | null; schoolName: string | null }>;
    }>;
    for (const row of allRows) {
      rowsWithMemberships.push({
        userId: row.userId,
        name: row.name,
        isCanonical: row.userId === canonicalUserId,
        memberships: await ctx.runQuery(internal.diagnostics.membershipsOf, {
          userId: row.userId as Id<"users">,
        }),
      });
    }

    return {
      email: normalized,
      passwordAccountExists: account !== null,
      canonicalUserId,
      usersRowCount: allRows.length,
      canonicalUserActive: canonicalActive,
      membershipsOnCanonicalUser: memberships,
      allUserRows: rowsWithMemberships,
    };
  },
});
