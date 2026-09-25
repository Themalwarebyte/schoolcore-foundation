import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, UserX, Clock, Users } from "lucide-react";

type Overview = {
  scope: string;
  users: Array<{
    membershipId: string; userId: string; name: string; email: string;
    role: string; roleLabel: string; permissionCount: number;
    isActive: boolean; membershipStatus: string; schoolName: string;
    staffName: string | null; lastLoginAt: number | null; inactiveDays: number | null;
  }>;
  summary: {
    total: number; active: number; inactive: number;
    neverLoggedIn: number; dormant30d: number;
  };
};

export default function AccessManagement() {
  const [roleFilter, setRoleFilter] = useState("all");
  const overview = useQuery(api.phase7.access.accessOverview, {}) as Overview | undefined;
  const pending = useQuery(api.phase7.access.pendingInvitations, {});

  const users = (overview?.users ?? []).filter(
    (u) => roleFilter === "all" || u.role === roleFilter,
  );

  return (
    <>
      <PageHeader
        title="Access Management"
        description="Who has access, to what, and when they last used it. Dormant and inactive accounts are surfaced for review."
        actions={
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="all">All roles</option>
            {["super_admin", "school_admin", "principal", "teacher", "accountant", "parent", "student"].map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
            ))}
          </select>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        {overview && (
          <div className="grid gap-3 sm:grid-cols-5">
            {[
              { label: "Total users", value: overview.summary.total, icon: Users },
              { label: "Active", value: overview.summary.active, icon: ShieldCheck },
              { label: "Inactive", value: overview.summary.inactive, icon: UserX },
              { label: "Never signed in", value: overview.summary.neverLoggedIn, icon: Clock },
              { label: "Dormant 30d+", value: overview.summary.dormant30d, icon: Clock },
            ].map((s) => (
              <Card key={s.label} className="card-soft">
                <CardHeader className="pb-1">
                  <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <s.icon className="size-3.5" /> {s.label}
                  </CardTitle>
                </CardHeader>
                <CardContent><p className="text-2xl font-semibold">{s.value}</p></CardContent>
              </Card>
            ))}
          </div>
        )}

        <DataTable
          columns={[
            { key: "user", header: "User" },
            { key: "school", header: "School" },
            { key: "role", header: "Role" },
            { key: "perms", header: "Permissions" },
            { key: "last", header: "Last sign-in" },
            { key: "status", header: "Status" },
          ]}
          rows={users.map((u) => ({
            _id: u.membershipId,
            user: (
              <div>
                <p className="font-medium">{u.name}</p>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </div>
            ),
            school: u.schoolName,
            role: <Badge variant="outline" className="capitalize">{u.roleLabel}</Badge>,
            perms: <span className="font-mono text-xs text-muted-foreground">{u.permissionCount}</span>,
            last: u.lastLoginAt
              ? <span className="text-xs">{new Date(u.lastLoginAt).toLocaleDateString()}{(u.inactiveDays ?? 0) > 30 ? <span className="ml-1 text-amber-600">({u.inactiveDays}d)</span> : null}</span>
              : <span className="text-xs text-amber-600">never</span>,
            status: <Badge variant={u.isActive && u.membershipStatus === "active" ? "default" : "secondary"}>
              {u.isActive && u.membershipStatus === "active" ? "active" : "inactive"}
            </Badge>,
          }))}
          loading={overview === undefined}
          empty={<><p className="text-sm font-medium">No users</p><p className="text-xs text-muted-foreground">Users with school memberships appear here.</p></>}
          page={0}
          pageSize={20}
          onPageChange={() => undefined}
          hasNextPage={false}
        />

        <Card className="card-soft">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pending invitations</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { key: "email", header: "Email" },
                { key: "role", header: "Role" },
                { key: "invited", header: "Invited" },
                { key: "expires", header: "Expires" },
              ]}
              rows={(pending ?? []).map((i) => ({
                _id: i._id,
                email: i.email,
                role: <Badge variant="outline" className="capitalize">{i.role.replace(/_/g, " ")}</Badge>,
                invited: new Date(i.invitedAt).toLocaleDateString(),
                expires: new Date(i.expiresAt).toLocaleDateString(),
              }))}
              loading={pending === undefined}
              empty={<><p className="text-sm font-medium">No pending invitations</p><p className="text-xs text-muted-foreground">Invited users appear here until they activate their account.</p></>}
              page={0}
              pageSize={10}
              onPageChange={() => undefined}
              hasNextPage={false}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
