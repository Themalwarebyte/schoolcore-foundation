import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePermissions, roleLabel, type SessionRole } from "@/hooks/use-session";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, MoreHorizontal, KeyRound, UserCheck, UserX } from "lucide-react";

const PAGE_SIZE = 15;
const ASSIGNABLE: SessionRole[] = ["school_admin", "principal", "teacher", "accountant", "parent", "student"];

export default function Users() {
  const { can } = usePermissions();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ userId: string; name: string } | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const users = useQuery(api.team.list, {
    search: search || undefined,
    role,
    status,
    paginationOpts: { numItems: PAGE_SIZE, cursor: page === 0 ? null : String(page) },
  });

  const createUserAction = useAction(api.team.createUser);
  const changeRole = useMutation(api.team.changeRole);
  const setActive = useMutation(api.team.setActive);
  const resetAction = useAction(api.accounts.adminResetPasswordAction);
  const rows = users?.page.filter((u) => u !== null).map((u) => ({
    _id: u.membershipId,
    name: (
      <div>
        <p className="text-sm font-medium">{u.name}</p>
        <p className="text-xs text-muted-foreground">{u.email}</p>
      </div>
    ),
    role: (
      <Select
        value={u.role}
        onValueChange={(v) =>
          changeRole({ membershipId: u.membershipId as never, role: v })
            .then(() => toast.success("Role updated"))
            .catch((e) => toast.error("Unable to change role.", { description: e instanceof Error ? e.message : undefined }))
        }
        disabled={!can("users.update") || u.role === "super_admin"}
      >
        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ASSIGNABLE.map((r) => (
            <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
    isActive: u.isActive ? (
      <Badge variant="default">Active</Badge>
    ) : (
      <Badge variant="destructive">Disabled</Badge>
    ),
    staffName: u.staffName ?? <span className="text-muted-foreground">—</span>,
    actions: u.role !== "super_admin" ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8"><MoreHorizontal className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can("users.update") && (
            <DropdownMenuItem
              onClick={() => {
                const pw = window.prompt(`New password for ${u.name} (min 8 chars)`);
                if (pw) setResetTarget({ userId: u.userId, name: u.name });
                if (pw) setResetPassword(pw);
              }}
            >
              <KeyRound className="mr-2 size-4" /> Reset password
            </DropdownMenuItem>
          )}
          {can("users.disable") && (
            u.isActive ? (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() =>
                  setActive({ userId: u.userId as never, isActive: false })
                    .then(() => toast.success("Account disabled"))
                    .catch((e) => toast.error("Unable to disable.", { description: e instanceof Error ? e.message : undefined }))
                }
              >
                <UserX className="mr-2 size-4" /> Disable account
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() =>
                  setActive({ userId: u.userId as never, isActive: true })
                    .then(() => toast.success("Account enabled"))
                    .catch((e) => toast.error("Unable to enable.", { description: e instanceof Error ? e.message : undefined }))
                }
              >
                <UserCheck className="mr-2 size-4" /> Enable account
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <span className="text-xs text-muted-foreground">Platform</span>
    ),
  }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Users"
        description="Accounts and roles for people working at your school."
        actions={
          <Can permission="users.create">
            <Button onClick={() => setAddOpen(true)}><Plus className="size-4" /> Add user</Button>
          </Can>
        }
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
            {ASSIGNABLE.map((r) => (
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
          { key: "isActive", header: "Status" },
          { key: "staffName", header: "Linked staff" },
          { key: "actions", header: "", className: "w-10" },
        ]}
        rows={rows}
        loading={users === undefined}
        empty={<><p className="text-sm font-medium">No users found</p><p className="text-xs text-muted-foreground">Add users to give your team access.</p></>}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        hasNextPage={(users?.page.length ?? 0) === PAGE_SIZE}
      />

      <CreateUserDialog open={addOpen} onOpenChange={setAddOpen} />

      <AlertDialog open={!!resetTarget} onOpenChange={(v) => { if (!v) { setResetTarget(null); setResetPassword(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset password for {resetTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their sessions are signed out and the new password takes effect immediately. Share it securely.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label>New password</Label>
            <Input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="Min 8 characters" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetPassword.length < 8}
              onClick={async () => {
                if (!resetTarget) return;
                try {
                  await resetAction({ userId: resetTarget.userId as never, newPassword: resetPassword });
                  toast.success("Password reset");
                } catch (e) {
                  toast.error("Unable to reset password.", { description: e instanceof Error ? e.message : undefined });
                } finally {
                  setResetTarget(null);
                  setResetPassword("");
                }
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const createUserAction = useAction(api.team.createUser);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "teacher", password: "" });

  const handleCreate = async () => {
    setSaving(true);
    try {
      await createUserAction(form);
      toast.success("User created", { description: `${form.email} can now sign in.` });
      onOpenChange(false);
      setForm({ name: "", email: "", role: "teacher", password: "" });
    } catch (err) {
      toast.error("Unable to create the user.", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Creates an account with a working password. They can sign in immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Full name *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Role *</Label>
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSIGNABLE.map((r) => (
                  <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Temporary password *</Label>
            <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Min 8 characters" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !form.name || !form.email || form.password.length < 8}>
            {saving ? "Creating…" : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
