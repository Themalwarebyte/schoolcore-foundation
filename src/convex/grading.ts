import { ConvexError, v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

/** Validate that bands don't overlap and cover a sane range (§38). */
export function validateBands(
  bands: { label: string; minPercent: number; maxPercent: number }[],
): string | null {
  if (bands.length === 0) return "Add at least one grade band.";
  const sorted = [...bands].sort((a, b) => a.minPercent - b.minPercent);
  for (const b of sorted) {
    if (!b.label.trim()) return "Every band needs a label.";
    if (b.minPercent < 0 || b.maxPercent > 100) return "Band percentages must be within 0–100.";
    if (b.minPercent > b.maxPercent) return `Band "${b.label}" has an inverted range.`;
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minPercent <= sorted[i - 1].maxPercent) {
      return `Bands "${sorted[i - 1].label}" and "${sorted[i].label}" overlap.`;
    }
  }
  return null;
}

export const listSchemes = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "grading.view");
    const schoolId = session.schoolId as Id<"schools">;
    const schemes = await ctx.db
      .query("gradingSchemes")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const bands = await ctx.db
      .query("gradeBands")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return schemes
      .filter((s) => s.status === "active")
      .map((s) => ({
        _id: s._id,
        name: s.name,
        description: s.description,
        bands: bands
          .filter((b) => b.schemeId === s._id)
          .sort((a, b) => b.minPercent - a.minPercent)
          .map((b) => ({
            _id: b._id,
            label: b.label,
            minPercent: b.minPercent,
            maxPercent: b.maxPercent,
            descriptor: b.descriptor,
            points: b.points,
            isPass: b.isPass,
          })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Create or replace a scheme with its bands atomically. */
export const saveScheme = mutation({
  args: {
    schemeId: v.optional(v.id("gradingSchemes")),
    name: v.string(),
    description: v.optional(v.string()),
    bands: v.array(
      v.object({
        label: v.string(),
        minPercent: v.number(),
        maxPercent: v.number(),
        descriptor: v.optional(v.string()),
        points: v.optional(v.number()),
        isPass: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { schemeId, name, description, bands }) => {
    const session = await requirePermission(ctx, "grading.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!name.trim()) throw new ConvexError("Scheme name is required.");
    const err = validateBands(bands);
    if (err) throw new ConvexError(err);

    let id = schemeId;
    if (id) {
      await getSchoolRecord(ctx, schoolId, "gradingSchemes", id);
      const old = await ctx.db
        .query("gradeBands")
        .withIndex("by_scheme", (q) => q.eq("schemeId", id as Id<"gradingSchemes">))
        .collect();
      for (const b of old) await ctx.db.delete(b._id);
      await ctx.db.patch(id, { name: name.trim(), description });
    } else {
      id = await ctx.db.insert("gradingSchemes", {
        schoolId,
        name: name.trim(),
        description,
        status: "active",
      });
    }
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      await ctx.db.insert("gradeBands", {
        schoolId,
        schemeId: id,
        label: b.label.trim(),
        minPercent: b.minPercent,
        maxPercent: b.maxPercent,
        descriptor: b.descriptor,
        points: b.points,
        isPass: b.isPass,
        displayOrder: i + 1,
      });
    }
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "grading.scheme_saved",
      entityType: "gradingSchemes",
      entityId: id,
      description: `Grading scheme "${name}" saved with ${bands.length} bands`,
    });
    return id;
  },
});

export const archiveScheme = mutation({
  args: { schemeId: v.id("gradingSchemes") },
  handler: async (ctx, { schemeId }) => {
    const session = await requirePermission(ctx, "grading.manage");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "gradingSchemes", schemeId);
    await ctx.db.patch(schemeId, { status: "archived" });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId,
      action: "grading.scheme_archived",
      entityType: "gradingSchemes",
      entityId: schemeId,
    });
  },
});

/** Internal: bands for a school's first active scheme (used by results + reports). */
export const activeBandsInternal = internalQuery({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, { schoolId }) => {
    const schemes = await ctx.db
      .query("gradingSchemes")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const active = schemes.filter((s) => s.status === "active");
    if (active.length === 0) return null;
    const bands = await ctx.db
      .query("gradeBands")
      .withIndex("by_scheme", (q) => q.eq("schemeId", active[0]._id))
      .collect();
    return bands.map((b) => ({
      label: b.label,
      minPercent: b.minPercent,
      maxPercent: b.maxPercent,
      isPass: b.isPass,
    }));
  },
});
