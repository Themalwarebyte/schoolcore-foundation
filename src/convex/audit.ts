import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Audit logging helper. Never log passwords or secrets — callers must only
 * pass safe metadata (names, codes, statuses).
 */
export async function recordAudit(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    action: string;
    entityType: string;
    entityId?: string | null;
    schoolId?: Id<"schools"> | null;
    description?: string;
    metadata?: Record<string, string>;
  },
): Promise<void> {
  await ctx.db.insert("auditLogs", {
    userId: args.userId,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId ?? undefined,
    schoolId: args.schoolId ?? undefined,
    description: args.description,
    metadata: args.metadata,
  });
}

/** Build a compact before/after description for audits. */
export function changeSummary(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  fields: string[],
): string {
  const parts: string[] = [];
  for (const f of fields) {
    const b = before ? String(before[f] ?? "—") : "—";
    const a = String(after[f] ?? "—");
    if (before === null || b !== a) parts.push(`${f}: ${b} → ${a}`);
  }
  return parts.join(", ");
}
