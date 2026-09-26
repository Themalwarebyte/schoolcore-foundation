import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/platform-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, MoreHorizontal, UserCheck, UserX } from "lucide-react";
import { roleLabel, type SessionRole } from "@/hooks/use-session";

const PAGE_SIZE = 20;
const ALL_ROLES: SessionRole[] = ["super_admin", "school_admin", "principal", "teacher", "accountant", "parent", "student"];

export default function PlatformUsers() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");

  if (search !== debounced) {
    setTimeout(() => setDebounced(search), 300);
  }

  const users = useQuery(api.platform.listPlatformUsers, {
    search: debounced || undefined,
    role,
    status,
  });

  const setUserActive = useMutation(api.platform.setUserActive);

  const rows = users?.map((u) => ({
    _id: u._id,
    name: (
      <div>
        <p className="text-sm font-medium">{u.name}</p>
        <p className="text-xs text-muted-foreground">{u.email}</p>
      </div>
    ),
    role: (
      <Badge variant={u.role === "super_admin" ? "default" : "secondary"} className="font-medium">
        {roleLabel(u.role as SessionRole)}
      </Badge>
    ),
    school: u.schoolName ?? <span className="text-xs text-muted-foreground">Platform</span>,
    isActive: u.isActive ? (
      <Badge variant="default">Active</Badge>
    ) : (
      <Badge variant="destructive">Disabled</Badge>
    ),
    actions: u.role !== "super_admin" ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {u.isActive ? (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() =>
                setUserActive({ userId: u.userId as never, isActive: false })
                  .then(() => toast.success("Account disabled"))
                  .catch((e) => toast.error("Unable to disable.", { description: friendlyError(e) }))
              }
            >
              <UserX className="mr-2 size-4" /> Disable account
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                setUserActive({ userId: u.userId as never, isActive: true })
                  .then(() => toast.success("Account enabled"))
                  .catch((e) => toast.error("Unable to enable.", { description: friendlyError(e) }))
              }
            >
              <UserCheck className="mr-2 size-4" /> Enable account
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    ),
  }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Platform users"
        description="Every account across the platform, with their role and school."
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ALL_ROLES.map((r) => (
              <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Disabled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={[
          { key: "name", header: "User" },
          { key: "role", header: "Role" },
          { key: "school", header: "School" },
          { key: "isActive", header: "Status" },
          { key: "actions", header: "", className: "w-10" },
        ]}
        rows={rows}
        loading={users === undefined}
        empty={<><p className="text-sm font-medium">No users found</p><p className="text-xs text-muted-foreground">Users appear here as schools create accounts.</p></>}
        page={0}
        pageSize={PAGE_SIZE}
        onPageChange={() => undefined}
        hasNextPage={false}
      />
    </div>
  );
}
