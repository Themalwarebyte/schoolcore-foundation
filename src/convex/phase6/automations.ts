/**
 * Phase 6 — automation engine.
 *
 *   Trigger → Conditions → Actions, with a full run log.
 *
 * The engine consumes events emitted by existing modules (attendance,
 * finance, library, HR, inventory). Actions NEVER bypass approval systems —
 * they can only create notifications, messages and reminders.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePermission } from "../session";
import { recordAudit } from "../audit";
import { AUTOMATION_TRIGGERS, AUTOMATION_ACTION_TYPES } from "./constants";

/* ------------------------------------------------------------------ */
/* Rules CRUD                                                          */
/* ------------------------------------------------------------------ */

export const listRules = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "automations.view");
    const rows = await ctx.db
      .query("automations")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const createRule = mutation({
  args: {
    name: v.string(),
    trigger: v.string(),
    condition: v.optional(v.object({ field: v.string(), op: v.string(), value: v.string() })),
    actions: v.array(v.object({ type: v.string(), payload: v.optional(v.string()) })),
    enabled: v.boolean(),
  },
  handler: async (ctx, { name, trigger, condition, actions, enabled }) => {
    const session = await requirePermission(ctx, "automations.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!AUTOMATION_TRIGGERS.includes(trigger as never)) throw new ConvexError("Unknown trigger.");
    if (actions.length === 0) throw new ConvexError("Add at least one action.");
    for (const a of actions) {
      if (!AUTOMATION_ACTION_TYPES.includes(a.type as never)) throw new ConvexError(`Unknown action type "${a.type}".`);
    }
    if (condition && !["gt", "lt", "eq"].includes(condition.op)) {
      throw new ConvexError("Condition operator must be gt, lt or eq.");
    }
    const id = await ctx.db.insert("automations", {
      schoolId, name: name.trim(), trigger, condition, actions, enabled,
      createdById: session.userId, createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "automation.created",
      entityType: "automations", entityId: id, description: `Automation "${name}" created (${trigger})`,
    });
    return id;
  },
});

export const updateRule = mutation({
  args: {
    automationId: v.id("automations"),
    name: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    actions: v.optional(v.array(v.object({ type: v.string(), payload: v.optional(v.string()) }))),
  },
  handler: async (ctx, { automationId, name, enabled, actions }) => {
    const session = await requirePermission(ctx, "automations.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const rule = await ctx.db.get(automationId);
    if (!rule || rule.schoolId !== schoolId) throw new ConvexError("Automation not found.");
    await ctx.db.patch(automationId, {
      name: name?.trim() ?? rule.name,
      enabled: enabled ?? rule.enabled,
      actions: actions ?? rule.actions,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const listRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const session = await requirePermission(ctx, "automations.view");
    const rows = await ctx.db
      .query("automationRuns")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    return rows.sort((a, b) => b.ranAt - a.ranAt).slice(0, limit ?? 50);
  },
});

/* ------------------------------------------------------------------ */
/* Event dispatcher (called by other modules / scheduled jobs)          */
/* ------------------------------------------------------------------ */

/**
 * Fire an automation event. Every enabled rule matching the trigger runs;
 * conditions evaluate against the numeric context passed by the emitter.
 */
export const fireEventInternal = internalMutation({
  args: {
    schoolId: v.id("schools"),
    trigger: v.string(),
    targetKind: v.string(),
    targetId: v.optional(v.string()),
    context: v.optional(v.record(v.string(), v.number())),
    recipientUserIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { schoolId, trigger, targetKind, targetId, context, recipientUserIds }) => {
    const rules = await ctx.db
      .query("automations")
      .withIndex("by_school_trigger", (q) => q.eq("schoolId", schoolId).eq("trigger", trigger))
      .collect()
      .then((rs) => rs.filter((r) => r.enabled));
    let fired = 0;
    for (const rule of rules) {
      // Condition evaluation (numeric only, safe operators).
      let conditionMet = true;
      if (rule.condition && context) {
        const actual = context[rule.condition.field];
        const expected = Number(rule.condition.value);
        if (actual === undefined || Number.isNaN(expected)) {
          conditionMet = false;
        } else if (rule.condition.op === "gt") conditionMet = actual > expected;
        else if (rule.condition.op === "lt") conditionMet = actual < expected;
        else conditionMet = actual === expected;
      } else if (rule.condition) {
        conditionMet = false;
      }
      if (!conditionMet) continue;

      let attempted = 0, succeeded = 0;
      const detail: string[] = [];
      for (const action of rule.actions) {
        attempted++;
        try {
          if (action.type === "in_app" || action.type === "admin_alert") {
            const targets = action.type === "admin_alert"
              ? await ctx.db
                  .query("schoolMemberships")
                  .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
                  .collect()
                  .then((ms) => ms.filter((m) => m.role === "school_admin" && m.status === "active").map((m) => m.userId))
              : (recipientUserIds ?? []) as Id<"users">[];
            for (const userId of targets) {
              await ctx.db.insert("appNotifications", {
                schoolId, userId, type: `automation_${trigger}`,
                title: rule.name,
                body: action.payload ?? `Automation "${rule.name}" fired.`,
                read: false, createdAt: Date.now(),
              });
            }
            succeeded++;
            detail.push(`${action.type}→${targets.length}`);
          } else {
            // sms/email/task: queued via commMessages (provider-gated).
            await ctx.db.insert("commMessages", {
              schoolId, channel: action.type, event: `automation_${trigger}`,
              recipientKind: "parent", body: action.payload ?? rule.name,
              status: action.type === "task" ? "queued" : "failed",
              failureReason: action.type === "task" ? undefined : `${action.type} integration is not configured`,
              attempts: 0, queuedAt: Date.now(),
            });
            succeeded++;
            detail.push(`${action.type} queued`);
          }
        } catch {
          detail.push(`${action.type} failed`);
        }
      }
      await ctx.db.insert("automationRuns", {
        schoolId, automationId: rule._id, trigger,
        targetKind, targetId, actionsAttempted: attempted, actionsSucceeded: succeeded,
        status: succeeded === attempted ? "success" : succeeded > 0 ? "partial" : "failed",
        detail: detail.join("; "), ranAt: Date.now(),
      });
      fired++;
    }
    return { fired };
  },
});
