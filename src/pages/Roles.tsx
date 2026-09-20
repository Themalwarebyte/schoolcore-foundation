import { PageHeader } from "@/components/layouts/school-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES, PERMISSIONS, type Role, type Permission } from "@/convex/schema";

const ROLE_TONE: Record<Role, string> = {
  super_admin: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  school_admin: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  principal: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  teacher: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  accountant: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  parent: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  student: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};

const DESCRIPTIONS: Record<Role, string> = {
  super_admin: "Platform-wide access across all schools. Operates above individual schools.",
  school_admin: "Full administrative control within one school, including users and settings.",
  principal: "Broad school oversight of people and academics; no user management or platform access.",
  teacher: "Views students, guardians and academic structure relevant to their work.",
  accountant: "Read access to people and academics, prepared for the future Finance module.",
  parent: "Architecture-ready role. The Parent Portal arrives in a later phase.",
  student: "Architecture-ready role. The Student Portal arrives in a later phase.",
};

function label(permission: string): string {
  const [domain, action] = permission.split(".");
  const domains: Record<string, string> = {
    dashboard: "Dashboard", school: "School", users: "Users", roles: "Roles",
    students: "Students", guardians: "Guardians", staff: "Staff", academics: "Academics",
    subjects: "Subjects", teacher_allocations: "Teacher allocations",
    audit_logs: "Audit logs", settings: "Settings", platform: "Platform",
  };
  const actions: Record<string, string> = {
    view: "view", create: "create", update: "update", disable: "enable/disable",
    manage: "manage", archive: "archive",
  };
  return `${domains[domain] ?? domain} · ${actions[action] ?? action}`;
}

const GROUPED = PERMISSIONS.reduce<Record<string, Permission[]>>((acc, p) => {
  const domain = p.split(".")[0];
  (acc[domain] ??= []).push(p);
  return acc;
}, {});

export default function Roles() {
  return (
    <div className="page-shell max-w-5xl">
      <PageHeader
        title="Roles & permissions"
        description="How roles map to server-enforced permissions in this school."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {ROLES.filter((r) => r !== "super_admin").map((role) => (
          <Card key={role} className="card-soft">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{ROLE_LABELS[role]}</CardTitle>
                <Badge variant="outline" className={`border-transparent ${ROLE_TONE[role]}`}>
                  {ROLE_PERMISSIONS[role].length} permissions
                </Badge>
              </div>
              <CardDescription>{DESCRIPTIONS[role]}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {ROLE_PERMISSIONS[role].map((p) => (
                <span key={p} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {label(p)}
                </span>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="card-soft mt-6">
        <CardHeader>
          <CardTitle className="text-base">Permission matrix</CardTitle>
          <CardDescription>
            Every permission in the system and the roles that hold it. Authorization is enforced
            server-side on every query and mutation; this page is documentation, not configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(GROUPED).map(([domain, perms]) => (
            <div key={domain}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {domain.replace("_", " ")}
              </p>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Permission</th>
                      {ROLES.map((r) => (
                        <th key={r} className="px-2 py-2 text-center font-medium" title={ROLE_LABELS[r]}>
                          {ROLE_LABELS[r].split(" ").map((w) => w[0]).join("")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {perms.map((p) => (
                      <tr key={p} className="border-b last:border-0">
                        <td className="px-3 py-1.5 font-mono text-xs">{p}</td>
                        {ROLES.map((r) => (
                          <td key={r} className="px-2 py-1.5 text-center">
                            {ROLE_PERMISSIONS[r].includes(p) ? (
                              <span className="text-xs text-emerald-600 dark:text-emerald-400">●</span>
                            ) : (
                              <span className="text-xs text-muted-foreground/30">·</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
