import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Link2, Unlink, UserRound, Phone, Mail, MapPin } from "lucide-react";

export default function GuardianProfile() {
  const { guardianId } = useParams();
  const navigate = useNavigate();
  const guardian = useQuery(api.guardians.get, guardianId ? { guardianId: guardianId as never } : "skip");

  if (guardian === undefined) {
    return <div className="page-shell"><div className="h-40 animate-pulse rounded-xl bg-muted" /></div>;
  }
  if (guardian === null) {
    return <div className="page-shell"><p className="text-sm text-muted-foreground">Guardian not found.</p></div>;
  }

  const fullName = [guardian.firstName, guardian.middleName, guardian.lastName].filter(Boolean).join(" ");

  return (
    <div className="page-shell">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate("/guardians")}>
        <ArrowLeft className="size-4" /> All guardians
      </Button>

      <div className="card-soft mb-6 p-6">
        <div className="flex items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
              {guardian.firstName[0]}{guardian.lastName[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{fullName}</h1>
            <p className="text-sm text-muted-foreground capitalize">{guardian.relationship ?? "Guardian"}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="card-soft lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Contact information</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" />{guardian.phone ?? "—"}</div>
            <div className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" />{guardian.email ?? "—"}</div>
            <div className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" />{guardian.address ?? "—"}</div>
            <div className="flex items-center gap-2"><UserRound className="size-4 text-muted-foreground" />{guardian.occupation ?? "—"}</div>
            <div className="text-muted-foreground">National ID: {guardian.nationalId ?? "—"}</div>
            <div className="text-muted-foreground">Alt. phone: {guardian.altPhone ?? "—"}</div>
          </CardContent>
        </Card>

        <Card className="card-soft">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Children ({guardian.children.length})</CardTitle>
            <Can permission="guardians.update">
              <LinkChildDialog guardianId={guardian._id} />
            </Can>
          </CardHeader>
          <CardContent>
            {guardian.children.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No children linked yet.</p>
            ) : (
              <div className="divide-y">
                {guardian.children.filter((c) => c !== null).map((c) => (
                  <ChildRow key={c.linkId} child={c} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChildRow({ child }: { child: { linkId: string; _id: string; name: string; admissionNumber: string } }) {
  const unlink = useMutation(api.guardians.unlinkStudent);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between py-2.5">
      <div>
        <Link to={`/students/${child._id}`} className="text-sm font-medium hover:underline">{child.name}</Link>
        <p className="text-xs text-muted-foreground">{child.admissionNumber}</p>
      </div>
      <Can permission="guardians.update">
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
          <Unlink className="size-4" />
        </Button>
      </Can>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove link to {child.name}?</AlertDialogTitle>
            <AlertDialogDescription>The guardian and student records are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                try {
                  await unlink({ linkId: child.linkId as never });
                  toast.success("Link removed");
                } catch (err) {
                  toast.error("Unable to remove link.", { description: friendlyError(err) });
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LinkChildDialog({ guardianId }: { guardianId: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const link = useMutation(api.guardians.linkStudent);

  // Simple debounced search against the students list API.
  const students = useQuery(api.students.list, open
    ? { search, paginationOpts: { numItems: 8, cursor: null } }
    : "skip");

  return (      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setSearch(""); } }}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Link2 className="size-4" /> Link student
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a student</DialogTitle>
          <DialogDescription>Attach one of your school's students to this guardian.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Search students…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {(students === undefined ? [] : students.page).map((s) => (
            <button
              key={s._id}
              type="button"
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={async () => {
                try {
                  await link({
                    guardianId: guardianId as never,
                    studentId: s._id as never,
                    relationship: "guardian",
                    isPrimary: false,
                  });
                  toast.success("Student linked", { description: `${s.firstName} ${s.lastName} is now linked to this guardian.` });
                  setOpen(false);
                } catch (err) {
                  toast.error("Unable to link student.", { description: friendlyError(err) });
                }
              }}
            >
              <span>
                {s.firstName} {s.lastName}
                <span className="block text-xs text-muted-foreground">{s.admissionNumber}</span>
              </span>
              <Link2 className="size-4 text-muted-foreground" />
            </button>
          ))}
          {open && students !== undefined && students.page.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No students match.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
