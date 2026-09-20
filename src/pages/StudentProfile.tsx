import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { StatusBadge, formatDate } from "@/lib/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, CalendarDays, GraduationCap, Users, History, StickyNote, Link2, Unlink, Trash2,
} from "lucide-react";

export default function StudentProfile() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const student = useQuery(api.students.get, studentId ? { studentId: studentId as never } : "skip");
  const history = useQuery(api.enrollments.forStudent, studentId ? { studentId: studentId as never } : "skip");
  const guardianQuery = useQuery(api.guardians.get, { guardianId: "__none__" as never });
  void guardianQuery;

  if (student === undefined) {
    return <div className="page-shell"><div className="h-40 animate-pulse rounded-xl bg-muted" /></div>;
  }
  if (student === null) {
    return (
      <div className="page-shell">
        <p className="text-sm text-muted-foreground">Student not found or you do not have access.</p>
      </div>
    );
  }

  const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
  const initials = `${student.firstName[0] ?? ""}${student.lastName[0] ?? ""}`.toUpperCase();

  return (
    <div className="page-shell">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate("/students")}>
        <ArrowLeft className="size-4" /> All students
      </Button>

      <div className="card-soft mb-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar className="size-16">
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{fullName}</h1>
              <StatusBadge status={student.studentStatus} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {student.admissionNumber} · Admitted {formatDate(student.admissionDate)}
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview" className="gap-1.5"><GraduationCap className="size-4" /> Overview</TabsTrigger>
          <TabsTrigger value="guardians" className="gap-1.5"><Users className="size-4" /> Guardians</TabsTrigger>
          <TabsTrigger value="enrollment" className="gap-1.5"><History className="size-4" /> Enrollment History</TabsTrigger>
          <TabsTrigger value="notes" className="gap-1.5"><StickyNote className="size-4" /> Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card className="card-soft">
            <CardHeader><CardTitle className="text-base">Core information</CardTitle></CardHeader>
            <CardContent className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Detail label="Full name" value={fullName} />
              <Detail label="Preferred name" value={student.preferredName} />
              <Detail label="Gender" value={student.gender ? student.gender.charAt(0).toUpperCase() + student.gender.slice(1) : undefined} />
              <Detail label="Date of birth" value={formatDate(student.dateOfBirth)} />
              <Detail label="Nationality" value={student.nationality} />
              <Detail label="Boarding status" value={student.boardingStatus === "boarding" ? "Boarding" : student.boardingStatus === "day" ? "Day" : undefined} />
              <Detail label="Admission date" value={formatDate(student.admissionDate)} />
              <Detail label="Previous school" value={student.previousSchool} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="guardians">
          <GuardiansTab studentId={student._id} />
        </TabsContent>

        <TabsContent value="enrollment">
          <EnrollmentTab studentId={student._id} history={history ?? []} />
        </TabsContent>

        <TabsContent value="notes">
          <Card className="card-soft">
            <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
            <CardContent>
              {student.notes ? (
                <p className="whitespace-pre-wrap text-sm">{student.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No notes recorded.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{value || "—"}</p>
    </div>
  );
}

function GuardiansTab({ studentId }: { studentId: string }) {
  const links = useQuery(api.guardians.forStudentGuardians, studentId as never);
  const unlink = useMutation(api.guardians.unlinkStudent);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <Card className="card-soft">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Linked guardians</CardTitle>
        <Can permission="guardians.update">
          <LinkGuardianDialog studentId={studentId} />
        </Can>
      </CardHeader>
      <CardContent>
        {links === undefined ? (
          <div className="h-24 animate-pulse rounded-lg bg-muted" />
        ) : links.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No guardians linked yet. Link a guardian to record contact information.
          </p>
        ) : (
          <div className="divide-y">
            {links.filter((g) => g !== null).map((g) => (
              <div key={g.linkId} className="flex items-center justify-between py-3">
                <div className="min-w-0">
                  <Link to={`/guardians/${g.guardianId}`} className="text-sm font-medium hover:underline">
                    {g.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {g.relationshipLabel}
                    {g.isPrimary ? " · Primary" : ""}
                    {g.isEmergencyContact ? " · Emergency contact" : ""}
                    {g.phone ? ` · ${g.phone}` : ""}
                  </p>
                </div>
                <Can permission="guardians.update">
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmId(g.linkId)}>
                    <Unlink className="size-4" /> Unlink
                  </Button>
                </Can>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <AlertDialog open={!!confirmId} onOpenChange={(v) => !v && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove guardian link?</AlertDialogTitle>
            <AlertDialogDescription>
              The guardian record remains and can be linked again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!confirmId) return;
                try {
                  await unlink({ linkId: confirmId as never });
                  toast.success("Guardian unlinked");
                } catch (err) {
                  toast.error("Unable to unlink.", { description: err instanceof Error ? err.message : undefined });
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function LinkGuardianDialog({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const candidates = useQuery(api.guardians.searchForLinking, open ? { search } : "skip");
  const link = useMutation(api.guardians.linkStudent);
  const [relationship, setRelationship] = useState("guardian");
  const [isPrimary, setIsPrimary] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Link2 className="size-4" /> Link guardian
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a guardian</DialogTitle>
          <DialogDescription>Choose an existing guardian to avoid duplicates.</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search guardians by name, phone or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {candidates === undefined && <div className="h-16 animate-pulse rounded bg-muted" />}
          {candidates?.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No guardians match your search.</p>
          )}
          {candidates?.map((g) => (
            <button
              key={g._id}
              type="button"
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              onClick={async () => {
                try {
                  await link({
                    guardianId: g._id as never,
                    studentId: studentId as never,
                    relationship,
                    isPrimary,
                  });
                  toast.success("Guardian linked", { description: `${g.name} is now linked.` });
                  setOpen(false);
                } catch (err) {
                  toast.error("Unable to link guardian.", { description: err instanceof Error ? err.message : undefined });
                }
              }}
            >
              <span>
                {g.name}
                <span className="block text-xs text-muted-foreground">{g.phone ?? g.relationship ?? ""}</span>
              </span>
              <Link2 className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Relationship</Label>
            <Select value={relationship} onValueChange={setRelationship}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["mother", "father", "guardian", "sibling", "grandparent", "aunt_uncle", "other"].map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">{r.replace("_", " / ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="mb-1">Primary contact</Label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="size-4 rounded border-input"
              />
              Set as primary guardian
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EnrollmentTab({
  studentId, history,
}: {
  studentId: string;
  history: Array<{
    _id: string; yearName: string; classLabel: string; status: string; enrollmentDate: string; exitDate?: string;
  }>;
}) {
  const options = useQuery(api.enrollments.options);
  const enroll = useMutation(api.enrollments.enroll);
  const remove = useMutation(api.enrollments.remove);
  const [open, setOpen] = useState(false);
  const [yearId, setYearId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState(new Date().toISOString().slice(0, 10));

  const yearSections = options?.sections.filter((s) => s.academicYearId === yearId) ?? [];

  return (
    <Card className="card-soft">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Enrollment history</CardTitle>
        <Can permission="students.update">
          <Button size="sm" onClick={() => setOpen(true)}>
            <CalendarDays className="size-4" /> Enroll / re-enroll
          </Button>
        </Can>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No enrollment history yet. Enroll this student into a class for the academic year.
          </p>
        ) : (
          <div className="divide-y">
            {history.map((e) => (
              <div key={e._id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">{e.classLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.yearName} · Enrolled {formatDate(e.enrollmentDate)}
                    {e.exitDate ? ` · Exited ${formatDate(e.exitDate)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={e.status} />
                  {e.status !== "active" && (
                    <Button
                      variant="ghost" size="icon" className="size-8 text-destructive"
                      aria-label="Delete enrollment"
                      onClick={async () => {
                        try {
                          await remove({ enrollmentId: e._id as never });
                          toast.success("Enrollment record removed");
                        } catch (err) {
                          toast.error("Unable to remove.", { description: err instanceof Error ? err.message : undefined });
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enroll into a class</DialogTitle>
            <DialogDescription>
              One active enrollment per academic year. Historical placements are preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Academic year</Label>
              <Select
                value={yearId}
                onValueChange={(v) => { setYearId(v); setSectionId(""); }}
              >
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {options?.years.map((y) => (
                    <SelectItem key={y._id} value={y._id}>
                      {y.name}{y.isCurrent ? " (current)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Class section</Label>
              <Select value={sectionId} onValueChange={setSectionId} disabled={!yearId}>
                <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {yearSections.map((s) => (
                    <SelectItem key={s._id} value={s._id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Enrollment date</Label>
              <Input type="date" value={enrollmentDate} onChange={(e) => setEnrollmentDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!yearId || !sectionId || !enrollmentDate}
              onClick={async () => {
                try {
                  await enroll({
                    studentId: studentId as never,
                    academicYearId: yearId as never,
                    classSectionId: sectionId as never,
                    enrollmentDate,
                  });
                  toast.success("Student enrolled");
                  setOpen(false);
                } catch (err) {
                  toast.error("Unable to enroll.", { description: err instanceof Error ? err.message : undefined });
                }
              }}
            >
              Enroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
