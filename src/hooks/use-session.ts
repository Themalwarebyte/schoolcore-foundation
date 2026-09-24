import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import type { Id } from "@/convex/_generated/dataModel";

export type SessionRole =
  | "super_admin"
  | "school_admin"
  | "principal"
  | "teacher"
  | "accountant"
  | "parent"
  | "student";

export interface ActiveMembership {
  role: SessionRole;
  schoolId: Id<"schools"> | null;
  schoolName: string | null;
}

export interface SessionInfo {
  userId: Id<"users">;
  name: string | null;
  email: string | null;
  isSuperAdmin: boolean;
  memberships: ActiveMembership[];
}

/** Client session: user + memberships + role helpers. */
export function useSession() {
  const { isLoading, isAuthenticated } = useAuth();
  const me = useQuery(api.team.me);

  const session: SessionInfo | null =
    isAuthenticated && me
      ? {
          userId: me.userId,
          name: me.name,
          email: me.email,
          isSuperAdmin: me.isSuperAdmin,
          memberships: (me.memberships ?? []).map((m) => ({
            role: m.role as SessionRole,
            schoolId: m.schoolId ?? null,
            schoolName: m.schoolName ?? null,
          })),
        }
      : null;

  /** The school membership this browser is currently working in. */
  const schoolMembership: ActiveMembership | null =
    session?.memberships.find((m) => m.schoolId) ?? null;

  return {
    isLoading: isLoading || (isAuthenticated && me === undefined),
    isAuthenticated,
    session,
    schoolMembership,
    role: schoolMembership?.role ?? (session?.isSuperAdmin ? "super_admin" : null),
  };
}

const ROLE_LABEL: Record<SessionRole, string> = {
  super_admin: "Super Admin",
  school_admin: "School Admin",
  principal: "Principal",
  teacher: "Teacher",
  accountant: "Accountant",
  parent: "Parent",
  student: "Student",
};

export function roleLabel(role: SessionRole): string {
  return ROLE_LABEL[role] ?? role;
}

/** Client-side permission mirror (server remains the source of truth). */
const ROLE_PERMISSIONS: Record<SessionRole, string[]> = {
  super_admin: ["*"],
  school_admin: [
    "dashboard.view", "school.view", "school.update", "users.view", "users.create",
    "users.update", "users.disable", "roles.manage", "students.view", "students.create",
    "students.update", "students.archive", "guardians.view", "guardians.create",
    "guardians.update", "staff.view", "staff.create", "staff.update", "staff.archive",
    "academics.view", "academics.manage", "subjects.view", "subjects.manage",
    "teacher_allocations.view", "teacher_allocations.manage", "audit_logs.view",
    "settings.view", "settings.manage",
    // Phase 2: academic operations
    "attendance.view", "attendance.take", "attendance.edit", "attendance.manage",
    "timetable.view", "timetable.manage", "timetable.publish",
    "assignments.view", "assignments.create", "assignments.update", "assignments.publish",
    "assessments.view", "assessments.create", "assessments.update", "assessments.manage",
    "marks.view", "marks.enter", "marks.update", "marks.submit",
    "grading.view", "grading.manage",
    "results.view", "results.review", "results.approve", "results.publish",
    "report_cards.view", "report_cards.generate", "report_cards.publish",
    "academic_analytics.view",
    // Phase 3: finance
    "finance.view", "finance.manage", "fees.manage",
    "billing.view", "billing.create",
    "payments.create", "payments.approve",
    "receipts.view", "receipts.print",
    "discounts.manage", "scholarships.manage",
    "expenses.create", "expenses.approve",
    "financial_reports.view",
  ],
  principal: [
    "dashboard.view", "school.view", "school.update", "students.view", "students.create",
    "students.update", "students.archive", "guardians.view", "guardians.create",
    "guardians.update", "staff.view", "staff.create", "staff.update", "staff.archive",
    "academics.view", "academics.manage", "subjects.view", "subjects.manage",
    "teacher_allocations.view", "teacher_allocations.manage", "audit_logs.view",
    "settings.view",
    // Phase 2: academic operations
    "attendance.view", "attendance.take", "attendance.edit", "attendance.manage",
    "timetable.view", "timetable.manage", "timetable.publish",
    "assignments.view", "assignments.create", "assignments.update", "assignments.publish",
    "assessments.view", "assessments.create", "assessments.update", "assessments.manage",
    "marks.view", "marks.enter", "marks.update", "marks.submit",
    "grading.view", "grading.manage",
    "results.view", "results.review", "results.approve", "results.publish",
    "report_cards.view", "report_cards.generate", "report_cards.publish",
    "academic_analytics.view",
    // Phase 4: portals & communication
    "announcements.view", "announcements.create", "announcements.publish", "announcements.manage",
    "notifications.view", "profile.view", "profile.update",
    "finance.view", "billing.view", "receipts.view", "financial_reports.view",
    "discounts.manage", "scholarships.manage", "expenses.approve",
  ],
  teacher: [
    "dashboard.view", "school.view", "students.view", "guardians.view",
    "academics.view", "subjects.view", "teacher_allocations.view", "settings.view",
    // Phase 2: day-to-day teaching operations
    "attendance.view", "attendance.take", "attendance.edit",
    "timetable.view",
    "assignments.view", "assignments.create", "assignments.update", "assignments.publish",
    "assessments.view", "assessments.create", "assessments.update",
    "marks.view", "marks.enter", "marks.update", "marks.submit",
    "grading.view",
    "results.view",
    "report_cards.view",
    "academic_analytics.view",
    // Phase 4: communication
    "announcements.view", "announcements.create", "notifications.view", "profile.view",
  ],
  accountant: [
    "dashboard.view", "school.view", "students.view", "guardians.view",
    "staff.view", "academics.view", "settings.view",
    // Phase 3: finance — primary finance user
    "finance.view", "fees.manage",
    "billing.view", "billing.create",
    "payments.create", "payments.approve",
    "receipts.view", "receipts.print",
    "discounts.manage", "scholarships.manage",
    "expenses.create",
    "financial_reports.view",
    // Phase 4
    "announcements.view", "notifications.view", "profile.view",
  ],
  parent: [
    // Phase 4: parent portal (read-only views scoped server-side to own children)
    "dashboard.view", "school.view", "portal.parent", "announcements.view",
    "notifications.view", "profile.view", "profile.update",
  ],
  student: [
    // Phase 4: student portal (own records only)
    "dashboard.view", "school.view", "portal.student", "announcements.view",
    "notifications.view", "profile.view",
  ],
};

export function usePermissions() {
  const { role } = useSession();
  const perms = role ? ROLE_PERMISSIONS[role] : [];
  return {
    role,
    can: (permission: string) =>
      !!role && (perms.includes("*") || perms.includes(permission)),
  };
}
