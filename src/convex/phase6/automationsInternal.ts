import { internalMutation } from "../_generated/server";
import { processEventById } from "./automations";
import type { Id } from "../_generated/dataModel";

/** Drain pending automation events (called by scheduled sweep). */
export const processPendingEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db
      .query("automationEvents")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(200);
    let processed = 0;
    for (const e of events) {
      await processEventById(ctx, e._id as Id<"automationEvents">);
      processed++;
    }
    return { processed };
  },
});
