import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getSession } from "./session";

/** School-wide search across people. Permission- and tenant-safe. */
export const globalSearch = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { query: q, limit }) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return [];
    const session = await getSession(ctx);
    if (!session.schoolId) return [];
    const schoolId = session.schoolId as Id<"schools">;
    const needle = trimmed.toLowerCase();
    const max = limit ?? 12;

    type Hit = {
      type: "student" | "guardian" | "staff";
      id: string;
      title: string;
      subtitle: string;
      href: string;
    };
    const hits: Hit[] = [];

    const canStudents = session.role.role === "super_admin" || session.role.role === "school_admin" || session.role.role === "principal" || session.role.role === "teacher" || session.role.role === "accountant";
    const canGuardians = canStudents;
    const canStaff = canStudents;

    if (canStudents) {
      const students = await ctx.db
        .query("students")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      for (const s of students) {
        const full = `${s.firstName} ${s.middleName ?? ""} ${s.lastName}`.toLowerCase();
        if (full.includes(needle) || s.admissionNumber.toLowerCase().includes(needle)) {
          hits.push({
            type: "student",
            id: s._id,
            title: `${s.firstName} ${s.lastName}`,
            subtitle: `Student · ${s.admissionNumber}`,
            href: `/students/${s._id}`,
          });
          if (hits.length >= max) break;
        }
      }
    }
    if (canGuardians && hits.length < max) {
      const guardians = await ctx.db
        .query("guardians")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      for (const g of guardians) {
        const full = `${g.firstName} ${g.lastName}`.toLowerCase();
        if (full.includes(needle) || (g.phone ?? "").includes(needle) || (g.email ?? "").toLowerCase().includes(needle)) {
          hits.push({
            type: "guardian",
            id: g._id,
            title: `${g.firstName} ${g.lastName}`,
            subtitle: `Guardian${g.phone ? ` · ${g.phone}` : ""}`,
            href: `/guardians/${g._id}`,
          });
          if (hits.length >= max) break;
        }
      }
    }
    if (canStaff && hits.length < max) {
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      for (const s of staff) {
        const full = `${s.firstName} ${s.lastName}`.toLowerCase();
        if (full.includes(needle) || s.employeeNumber.toLowerCase().includes(needle)) {
          hits.push({
            type: "staff",
            id: s._id,
            title: `${s.firstName} ${s.lastName}`,
            subtitle: `Staff · ${s.employeeNumber}${s.jobTitle ? ` · ${s.jobTitle}` : ""}`,
            href: `/staff/${s._id}`,
          });
          if (hits.length >= max) break;
        }
      }
    }
    return hits.slice(0, max);
  },
});
