import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSession, requireSchoolSession } from "./session";
import { recordAudit } from "./audit";

/* ------------------------------------------------------------------ */
/* Super admin: school management                                      */
/* ------------------------------------------------------------------ */

export const listSchools = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, { search, status }) => {
    const session = await requirePermission(ctx, "platform.schools.view");
    if (!session.isPlatform) {
      // School users may only see their own school record.
      if (session.schoolId) {
        const school = await ctx.db.get(session.schoolId);
        return school && (!status || school.status === status) ? [school] : [];
      }
      return [];
    }
    let schools = await ctx.db.query("schools").order("desc").collect();
    if (status) schools = schools.filter((s) => s.status === status);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      schools = schools.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          s.slug.includes(q),
      );
    }
    // Counts for the platform table.
    return await Promise.all(
      schools.map(async (school) => {
        const students = await ctx.db
          .query("students")
          .withIndex("by_school", (q) => q.eq("schoolId", school._id))
          .collect();
        const staff = await ctx.db
          .query("staff")
          .withIndex("by_school", (q) => q.eq("schoolId", school._id))
          .collect();
        const members = await ctx.db
          .query("schoolMemberships")
          .withIndex("by_school", (q) => q.eq("schoolId", school._id))
          .collect();
        return {
          ...school,
          studentCount: students.length,
          staffCount: staff.length,
          userCount: members.length,
        };
      }),
    );
  },
});

export const getSchool = query({
  args: { schoolId: v.id("schools") },
  handler: async (ctx, { schoolId }) => {
    const session = await getSession(ctx, { schoolId });
    if (!session.isPlatform && session.schoolId !== schoolId) {
      throw new ConvexError("You do not have access to this school.");
    }
    return await ctx.db.get(schoolId);
  },
});

export const createSchool = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    county: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    curriculum: v.optional(v.string()),
    adminEmail: v.string(),
    adminName: v.string(),
    adminPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "platform.schools.manage");
    const name = args.name.trim();
    const code = args.code.trim();
    if (!name) throw new ConvexError("School name is required.");
    if (!/^[A-Za-z0-9-]{2,20}$/.test(code)) {
      throw new ConvexError("School code must be 2-20 letters, numbers or dashes.");
    }
    if (args.adminPassword.length < 8) {
      throw new ConvexError("Administrator password must be at least 8 characters.");
    }
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const existingSlug = await ctx.db
      .query("schools")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existingSlug) throw new ConvexError("A school with a similar name already exists.");
    const existingCode = await ctx.db
      .query("schools")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (existingCode) throw new ConvexError("A school with this code already exists.");

    const email = args.adminEmail.trim().toLowerCase();
    if (!email.includes("@")) throw new ConvexError("A valid admin email is required.");

    const schoolId = await ctx.db.insert("schools", {
      name,
      code,
      slug,
      status: "active",
      phone: args.phone,
      email: args.email,
      website: args.website,
      county: args.county,
      country: args.country,
      timezone: args.timezone,
      curriculum: args.curriculum,
      createdBy: session.userId,
    });

    // Create/reuse the admin user + membership. The password account is
    // provisioned by a follow-up action from the client (ensureAdminAccount).
    let userId: Id<"users">;
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (existingUser) {
      userId = existingUser._id;
    } else {
      userId = await ctx.db.insert("users", { email, name: args.adminName, isActive: true });
    }
    const dupe = await ctx.db
      .query("schoolMemberships")
      .withIndex("by_user_school", (q) => q.eq("userId", userId).eq("schoolId", schoolId))
      .unique();
    if (!dupe) {
      await ctx.db.insert("schoolMemberships", {
        userId,
        schoolId,
        role: "school_admin",
        status: "active",
        createdById: session.userId,
      });
    }
    await recordAudit(ctx, {
      userId: session.userId,
      action: "school.created",
      entityType: "schools",
      entityId: schoolId,
      description: `Created school ${name} (${code}) with admin ${email}`,
      metadata: { name, code },
    });
    return { schoolId, adminEmail: email, adminPassword: args.adminPassword };
  },
});

/** After createSchool, provision the admin's password credentials (action ctx). */
export const ensureAdminAccount = mutation({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx) => {
    void ctx;
    throw new ConvexError("Internal use only; see ensureAdminAccountAction.");
  },
});

export const updateSchoolStatus = mutation({
  args: {
    schoolId: v.id("schools"),
    status: v.union(v.literal("active"), v.literal("inactive")),
  },
  handler: async (ctx, { schoolId, status }) => {
    const session = await requirePermission(ctx, "platform.schools.manage");
    const school = await ctx.db.get(schoolId);
    if (!school) throw new ConvexError("School not found.");
    await ctx.db.patch(schoolId, { status });
    await recordAudit(ctx, {
      userId: session.userId,
      action: "school.status_changed",
      entityType: "schools",
      entityId: schoolId,
      description: `${school.name}: status → ${status}`,
    });
    return null;
  },
});

/** Super admin updates basic school identity fields. */
export const updateSchoolByPlatform = mutation({
  args: {
    schoolId: v.id("schools"),
    name: v.string(),
    code: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    county: v.optional(v.string()),
    country: v.optional(v.string()),
    curriculum: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "platform.schools.manage");
    const school = await ctx.db.get(args.schoolId);
    if (!school) throw new ConvexError("School not found.");
    await ctx.db.patch(args.schoolId, {
      name: args.name.trim() || school.name,
      code: args.code.trim() || school.code,
      phone: args.phone,
      email: args.email,
      website: args.website,
      county: args.county,
      country: args.country,
      curriculum: args.curriculum,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      action: "school.updated",
      entityType: "schools",
      entityId: args.schoolId,
      description: `Updated school ${school.name}`,
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* School settings (School Admin / Principal)                          */
/* ------------------------------------------------------------------ */

export const getMySchool = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireSchoolSession(ctx);
    return await ctx.db.get(session.schoolId as Id<"schools">);
  },
});

export const updateMySchool = mutation({
  args: {
    name: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    postalAddress: v.optional(v.string()),
    physicalAddress: v.optional(v.string()),
    county: v.optional(v.string()),
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    dateFormat: v.optional(v.string()),
    language: v.optional(v.string()),
    currency: v.optional(v.string()),
    curriculum: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requirePermission(ctx, "school.update");
    if (!session.schoolId) throw new ConvexError("No school context.");
    const school = await ctx.db.get(session.schoolId);
    if (!school) throw new ConvexError("School not found.");
    const name = args.name.trim();
    if (!name) throw new ConvexError("School name is required.");
    await ctx.db.patch(session.schoolId, {
      name,
      phone: args.phone,
      email: args.email,
      website: args.website,
      postalAddress: args.postalAddress,
      physicalAddress: args.physicalAddress,
      county: args.county,
      country: args.country,
      timezone: args.timezone,
      dateFormat: args.dateFormat,
      language: args.language,
      currency: args.currency,
      curriculum: args.curriculum,
    });
    await recordAudit(ctx, {
      userId: session.userId,
      schoolId: session.schoolId,
      action: "school.settings_updated",
      entityType: "schools",
      entityId: session.schoolId,
      description: `Updated school settings for ${name}`,
      metadata: {
        name: school.name !== name ? `${school.name} → ${name}` : name,
      },
    });
    return null;
  },
});

/* ------------------------------------------------------------------ */
/* Platform stats                                                      */
/* ------------------------------------------------------------------ */

export const platformStats = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "platform.dashboard.view");
    const schools = await ctx.db.query("schools").collect();
    const activeSchools = schools.filter((s) => s.status === "active");
    let totalStudents = 0;
    let totalStaff = 0;
    for (const school of schools) {
      const students = await ctx.db
        .query("students")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .collect();
      totalStudents += students.filter((s) => s.studentStatus === "active").length;
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", school._id))
        .collect();
      totalStaff += staff.filter((s) => s.employmentStatus === "active").length;
    }
    const recentSchools = [...schools]
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 5)
      .map((s) => ({ _id: s._id, name: s.name, code: s.code, status: s.status }));
    return {
      totalSchools: schools.length,
      activeSchools: activeSchools.length,
      totalStudents,
      totalStaff,
      recentSchools,
    };
  },
});

export { internal } from "./_generated/api";
