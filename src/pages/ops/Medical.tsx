import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Stethoscope, AlertTriangle, CalendarPlus, ShieldAlert, Plus } from "lucide-react";
import { Pill, FormDialog, Field, EntityPicker } from "@/components/ops/shared";

export default function MedicalPage() {
  const dash = useQuery(api.medical.medicalDashboard, {});
  const visits = useQuery(api.medical.listVisits, { limit: 50 });
  const [profileStudent, setProfileStudent] = useState<{ id: string; label: string; sub?: string } | null>(null);
  const students = useQuery(api.students.list, { paginationOpts: { numItems: 300, cursor: null } });
  const profile = useQuery(api.medical.getMedicalProfile, profileStudent ? { studentId: profileStudent.id as never } : "skip");
  const auditAccess = useMutation(api.medical.auditMedicalAccess);

  return (
    <div>
      <PageHeader
        title="Clinic & Medical"
        description="Sensitive medical records — every access is restricted and audited."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Medical profiles" value={dash?.profileCount ?? "—"} icon={Stethoscope} />
        <MiniStat label="Recorded allergies" value={dash?.allergyCount ?? "—"} icon={AlertTriangle} tone={dash?.allergyCount ? "warn" : undefined} />
        <MiniStat label="Visits this month" value={dash?.visitsThisMonth ?? "—"} icon={CalendarPlus} />
        <MiniStat label="Hospital referrals" value={dash?.hospitalReferred ?? "—"} icon={ShieldAlert} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex justify-end">
            <Can permission="medical.manage">
              <RecordVisitDialog />
            </Can>
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Recent clinic visits</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead>Complaint</TableHead>
                    <TableHead className="hidden md:table-cell">Disposition</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(visits ?? []).map((v) => (
                    <TableRow key={v._id}>
                      <TableCell className="font-medium">{v.studentName}<span className="block text-xs text-muted-foreground">{v.admissionNumber}</span></TableCell>
                      <TableCell className="hidden sm:table-cell text-xs">{v.visitDate}</TableCell>
                      <TableCell className="text-sm">{v.complaint}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {v.disposition ? <Pill tone={v.disposition === "sent_to_hospital" || v.disposition === "referred" ? "red" : "slate"}>{v.disposition.replace(/_/g, " ")}</Pill> : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {visits && visits.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No clinic visits recorded.</TableCell></TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Student medical profile</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <EntityPicker
              options={(students?.page ?? []).map((s) => ({ id: s._id, label: `${s.firstName} ${s.lastName}`, sub: s.admissionNumber }))}
              value={profileStudent}
              onChange={(o) => { setProfileStudent(o); }}
              placeholder="Search students…"
            />
            {profile && profileStudent ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium">{profile.student.name} <span className="text-xs text-muted-foreground">({profile.student.admissionNumber})</span></p>
                {profile.profile ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Blood group</span>
                      <span className="font-mono">{profile.profile.bloodGroup ?? "—"}</span>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Allergies</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {profile.profile.allergies.length ? profile.profile.allergies.map((a) => <Pill key={a} tone="amber">{a}</Pill>) : <span className="text-xs">None recorded</span>}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Conditions</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {profile.profile.conditions.length ? profile.profile.conditions.map((c) => <Pill key={c} tone="blue">{c}</Pill>) : <span className="text-xs">None recorded</span>}
                      </div>
                    </div>
                    {profile.profile.emergencyNotes ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Emergency notes</p>
                        <p className="mt-1 rounded-md border bg-muted/40 p-2 text-xs">{profile.profile.emergencyNotes}</p>
                      </div>
                    ) : null}
                    <Can permission="medical.manage">
                      <EditProfileDialog studentId={profileStudent.id} studentName={profile.student.name} current={profile.profile} />
                    </Can>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No medical profile for this student yet.</p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone?: "warn" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className={`mt-2 text-2xl font-bold tabular-nums ${tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */

function RecordVisitDialog() {
  const recordVisit = useMutation(api.medical.recordVisit);
  const students = useQuery(api.students.list, { paginationOpts: { numItems: 300, cursor: null } });
  const [student, setStudent] = useState<{ id: string; label: string; sub?: string } | null>(null);
  return (
    <FormDialog
      title="Record clinic visit"
      trigger={<Button size="sm"><Plus />Record visit</Button>}
      onSubmit={async (data) => {
        if (!student) throw new Error("Choose a student.");
        await recordVisit({
          studentId: student.id as never,
          visitDate: data.visitDate,
          complaint: data.complaint,
          assessment: data.assessment || undefined,
          treatment: data.treatment || undefined,
          provider: data.provider || undefined,
          disposition: data.disposition || undefined,
          notes: data.notes || undefined,
        });
        toast.success("Clinic visit recorded");
      }}
    >
      {(set) => (
        <>
          <Field label="Student">
            <EntityPicker
              options={(students?.page ?? []).map((s) => ({ id: s._id, label: `${s.firstName} ${s.lastName}`, sub: s.admissionNumber }))}
              value={student}
              onChange={setStudent}
              placeholder="Search students…"
            />
          </Field>
          <Field label="Visit date"><Input type="date" onChange={(e) => set("visitDate", e.target.value)} /></Field>
          <Field label="Complaint"><Input onChange={(e) => set("complaint", e.target.value)} placeholder="e.g. Fever, headache" /></Field>
          <Field label="Assessment"><Input onChange={(e) => set("assessment", e.target.value)} /></Field>
          <Field label="Treatment given"><Input onChange={(e) => set("treatment", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider"><Input onChange={(e) => set("provider", e.target.value)} placeholder="Nurse / Doctor" /></Field>
            <Field label="Disposition">
              <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("disposition", e.target.value)} defaultValue="returned_to_class">
                <option value="returned_to_class">Returned to class</option>
                <option value="sent_home">Sent home</option>
                <option value="sent_to_hospital">Sent to hospital</option>
                <option value="referred">Referred</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <Field label="Notes"><Textarea rows={2} onChange={(e) => set("notes", e.target.value)} /></Field>
        </>
      )}
    </FormDialog>
  );
}

function EditProfileDialog({
  studentId, studentName, current,
}: {
  studentId: string;
  studentName: string;
  current: { bloodGroup: string | null; allergies: string[]; conditions: string[]; emergencyNotes: string | null } | null;
}) {
  const upsert = useMutation(api.medical.upsertMedicalProfile);
  return (
    <FormDialog
      title={`Medical profile — ${studentName}`}
      trigger={<Button size="sm" variant="outline" className="w-full">Edit profile</Button>}
      onSubmit={async (data) => {
        await upsert({
          studentId: studentId as never,
          bloodGroup: data.bloodGroup || undefined,
          allergies: data.allergies ? data.allergies.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
          conditions: data.conditions ? data.conditions.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
          emergencyNotes: data.emergencyNotes || undefined,
        });
        toast.success("Medical profile updated");
      }}
    >
      {(set) => (
        <>
          <Field label="Blood group">
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("bloodGroup", e.target.value)} defaultValue={current?.bloodGroup ?? ""}>
              <option value="">— unknown —</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Allergies (comma-separated)"><Input onChange={(e) => set("allergies", e.target.value)} placeholder="Peanuts, Penicillin" /></Field>
          <Field label="Conditions (comma-separated)"><Input onChange={(e) => set("conditions", e.target.value)} placeholder="Asthma, Epilepsy" /></Field>
          <Field label="Emergency notes"><Textarea rows={3} onChange={(e) => set("emergencyNotes", e.target.value)} /></Field>
        </>
      )}
    </FormDialog>
  );
}
