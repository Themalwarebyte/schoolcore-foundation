import {
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  roleHasPermission,
  rolePermissions,
  type Permission,
  type Role,
} from "./schema";

export {
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  roleHasPermission,
  rolePermissions,
};
export type { Permission, Role };

/** Resolved caller context used for permission checks. */
export type SessionRole =
  | { kind: "platform"; role: Role }
  | { kind: "school"; role: Role; schoolId: string };

export function can(role: SessionRole, permission: Permission): boolean {
  const effective = role.role;
  if (effective === "super_admin") return true; // platform role sees everything
  if (permission.startsWith("platform.")) return false; // school roles never get platform perms
  if (!ROLE_PERMISSIONS[effective]?.includes(permission)) return false;
  if (role.kind === "platform") {
    // Super admin acting inside a school context uses school-level checks; all pass.
    return true;
  }
  return true;
}

/** Labels for enum values shown in the UI. */
export const LABELS = {
  studentStatus: {
    active: "Active",
    inactive: "Inactive",
    graduated: "Graduated",
    transferred: "Transferred",
    withdrawn: "Withdrawn",
    archived: "Archived",
  },
  employmentStatus: {
    active: "Active",
    on_leave: "On Leave",
    suspended: "Suspended",
    terminated: "Terminated",
    retired: "Retired",
    archived: "Archived",
  },
  employmentType: {
    permanent: "Permanent",
    contract: "Contract",
    part_time: "Part-time",
    temporary: "Temporary",
  },
  relationship: {
    mother: "Mother",
    father: "Father",
    guardian: "Guardian",
    sibling: "Sibling",
    grandparent: "Grandparent",
    aunt_uncle: "Aunt / Uncle",
    other: "Other",
  },
  entityStatus: {
    active: "Active",
    inactive: "Inactive",
    archived: "Archived",
  },
  gender: {
    male: "Male",
    female: "Female",
    other: "Other",
  },
  boarding: {
    day: "Day",
    boarding: "Boarding",
  },
} as const;

export function labelFor(
  group: keyof typeof LABELS,
  value: string | undefined | null,
): string {
  if (!value) return "—";
  const map = LABELS[group] as Record<string, string> | undefined;
  return map?.[value] ?? value;
}
