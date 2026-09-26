import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/school-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/status";
import { UserPlus, ShieldCheck, Trash2, KeyRound, Users } from "lucide-react";

export default function PortalAccess() {
  const links = useQuery(api.announcements.listPortalLinks, {});

  return (
    <div className="page-shell">
      <PageHeader
        title="Portal Access"
        description="Provision controlled parent and student portal accounts. Accounts are created by the school — there is no public signup."
      />

      <div className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="text-sm">
          <p className="font-medium">Controlled provisioning</p>
          <p className="mt-0.5 text-muted-foreground">
            A parent account links to one guardian record; children already linked to that guardian appear
            automatically. A student account links to one student record. Revoking a link blocks portal sign-in data
            access immediately. All access is enforced server-side by the portal link tables.
          </p>
        </div>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <InviteParentCard />
        <InviteStudentCard />
      </div>

      <Card className="card-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" /> Active portal accounts
          </CardTitle>
          <CardDescription>All parent and student portal links for your school.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {links === undefined ? (
            <div className="h-32 animate-pulse rounded-b-xl bg-muted" />
          ) : links.links.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No portal accounts provisioned yet. Use the invite forms above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Login email</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.links.map((l) => (
                  <TableRow key={l.linkId}>
                    <TableCell className="font-medium">{l.personName}</TableCell>
                    <TableCell>
                      <Badge variant={l.kind === "parent" ? "default" : "secondary"} className="capitalize">
                        {l.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{l.email ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(l.invitedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={l.status === "active" ? "outline" : "destructive"} className="capitalize">
                        {l.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {l.kind === "parent" && l.status === "active" && (
                        <RevokeButton linkId={l.linkId} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RevokeButton({ linkId }: { linkId: string }) {
  const revoke = useMutation(api.announcements.revokePortalLink);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await revoke({ linkId: linkId as never });
          toast.success("Portal access revoked");
        } catch (err) {
          toast.error("Could not revoke access.", { description: friendlyError(err) });
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 className="size-4" /> Revoke
    </Button>
  );
}

function InviteParentCard() {
  const invite = useAction(api.announcements.inviteParent);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card className="card-soft">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="size-4" /> Invite a parent
        </CardTitle>
        <CardDescription>
          Creates a Parent portal account linked to a guardian record. Children linked to that guardian appear
          automatically — including future children.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button className="w-full" onClick={() => { setEmail(""); setPassword(""); setOpen(true); }}>
          <UserPlus className="size-4" /> Choose guardian &amp; create account
        </Button>
      </CardContent>

      <ParentPickerDialog
        open={open}
        onOpenChange={setOpen}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        busy={busy}
        onSubmit={async (guardianId) => {
          setBusy(true);
          try {
            await invite({ guardianId: guardianId as never, email, password });
            toast.success(`Parent account created for ${email}`);
            setOpen(false);
          } catch (err) {
            toast.error("Could not create the parent account.", { description: friendlyError(err) });
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

function InviteStudentCard() {
  const invite = useAction(api.announcements.inviteStudent);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card className="card-soft">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" /> Invite a student
        </CardTitle>
        <CardDescription>
          Creates a Student portal account linked to one student record. The student sees only their own attendance,
          results, assignments, timetable, and report cards.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="w-full" onClick={() => { setEmail(""); setPassword(""); setOpen(true); }}>
          <KeyRound className="size-4" /> Choose student &amp; create account
        </Button>
      </CardContent>

      <StudentPickerDialog
        open={open}
        onOpenChange={setOpen}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        busy={busy}
        onSubmit={async (studentId) => {
          setBusy(true);
          try {
            await invite({ studentId: studentId as never, email, password });
            toast.success(`Student account created for ${email}`);
            setOpen(false);
          } catch (err) {
            toast.error("Could not create the student account.", { description: friendlyError(err) });
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pickers                                                             */
/* ------------------------------------------------------------------ */

function ParentPickerDialog({
  open, onOpenChange, email, setEmail, password, setPassword, busy, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  busy: boolean;
  onSubmit: (guardianId: string) => Promise<void>;
}) {
  const guardians = useQuery(api.guardians.list, { paginationOpts: { numItems: 100, cursor: null } });
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const rows = (guardians?.page ?? []).filter(
    (g) =>
      `${g.firstName} ${g.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      (g.phone ?? "").includes(search),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create parent portal account</DialogTitle>
          <DialogDescription>Pick the guardian record, then set the login email and a temporary password.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Guardian</Label>
            <Input placeholder="Search guardians…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-44 divide-y overflow-y-auto rounded-md border">
              {rows.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {guardians === undefined ? "Loading…" : "No guardians found."}
                </p>
              )}
              {rows.map((g) => (
                <button
                  key={g._id}
                  type="button"
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${
                    selected === g._id ? "bg-accent" : ""
                  }`}
                  onClick={() => setSelected(g._id)}
                >
                  <span>{g.firstName} {g.lastName}</span>
                  <span className="text-xs text-muted-foreground">{g.childrenCount} child(guardian links)</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pa-email">Login email</Label>
            <Input id="pa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pa-pass">Temporary password</Label>
            <Input id="pa-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!selected || !email || password.length < 8 || busy}
            onClick={() => selected && void onSubmit(selected)}
          >
            {busy ? "Creating…" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StudentPickerDialog({
  open, onOpenChange, email, setEmail, password, setPassword, busy, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  busy: boolean;
  onSubmit: (studentId: string) => Promise<void>;
}) {
  const students = useQuery(api.students.list, { paginationOpts: { numItems: 100, cursor: null } });
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const rows = (students?.page ?? []).filter(
    (s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      s.admissionNumber.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create student portal account</DialogTitle>
          <DialogDescription>Pick the student record, then set the login email and a temporary password.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Student</Label>
            <Input placeholder="Search students…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-44 divide-y overflow-y-auto rounded-md border">
              {rows.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {students === undefined ? "Loading…" : "No students found."}
                </p>
              )}
              {rows.map((s) => (
                <button
                  key={s._id}
                  type="button"
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${
                    selected === s._id ? "bg-accent" : ""
                  }`}
                  onClick={() => setSelected(s._id)}
                >
                  <span>{s.firstName} {s.lastName}</span>
                  <span className="text-xs text-muted-foreground">{s.admissionNumber}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="st-email">Login email</Label>
            <Input id="st-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@example.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="st-pass">Temporary password</Label>
            <Input id="st-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!selected || !email || password.length < 8 || busy}
            onClick={() => selected && void onSubmit(selected)}
          >
            {busy ? "Creating…" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
