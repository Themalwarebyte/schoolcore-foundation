import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UserPlus, ClipboardCheck, Check, X, RefreshCw } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  submitted: "secondary",
  under_review: "outline",
  assessment: "outline",
  accepted: "default",
  rejected: "destructive",
  waitlisted: "secondary",
  enrolled: "default",
  withdrawn: "outline",
};

type AppRow = {
  _id: string;
  applicationNumber: string;
  studentName: string;
  gender: string | null;
  guardianName: string;
  guardianPhone: string;
  appliedGrade: string | null;
  status: string;
  assessmentScore: number | null;
  submittedAt: number;
  convertedStudentId: string | null;
};

type ListResult = {
  applications: AppRow[];
  counts: {
    total: number; submitted: number; underReview: number; assessment: number;
    accepted: number; rejected: number; enrolled: number;
  };
};

export default function Admissions() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [decideId, setDecideId] = useState<{ id: string; decision: string } | null>(null);
  const [convertId, setConvertId] = useState<string | null>(null);

  // form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [previousSchool, setPreviousSchool] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [assessmentScore, setAssessmentScore] = useState("");
  const [assessmentNotes, setAssessmentNotes] = useState("");
  const [decisionNotes, setDecisionNotes] = useState("");
  // conversion state
  const [convClassId, setConvClassId] = useState("");
  const [convYearId, setConvYearId] = useState("");
  const [convTermId, setConvTermId] = useState("");
  const [convAmount, setConvAmount] = useState("");

  const listResult = useQuery(api.phase7.admissions.listApplications, {
    status: statusFilter === "all" ? undefined : statusFilter,
  }) as ListResult | undefined;
  const gradeLevels = useQuery(api.academics.listGradeLevels, {});
  const classSections = useQuery(api.academics.listClassSections, {});
  const academicYears = useQuery(api.academics.listYears, {});
  const terms = useQuery(api.academics.listTerms,
    convYearId ? { academicYearId: convYearId as never } : "skip");
  const detail = useQuery(api.phase7.admissions.applicationDetail,
    detailId ? { applicationId: detailId as never } : "skip");
  const convertApplicant = useQuery(
    api.phase7.admissions.applicationDetail,
    convertId ? { applicationId: convertId as never } : "skip",
  );

  const submitApplication = useMutation(api.phase7.admissions.submitApplication);
  const moveToReview = useMutation(api.phase7.admissions.moveToReview);
  const recordAssessment = useMutation(api.phase7.admissions.recordAssessment);
  const decideApplication = useMutation(api.phase7.admissions.decideApplication);
  const convertApplication = useMutation(api.phase7.admissions.convertApplication);

  const applications = listResult?.applications ?? [];
  const counts = listResult?.counts;

  const rows = applications.map((a) => ({
    _id: a._id,
    number: <span className="font-mono text-xs">{a.applicationNumber}</span>,
    applicant: (
      <div>
        <p className="font-medium">{a.studentName}</p>
        <p className="text-xs text-muted-foreground">{a.guardianName} · {a.guardianPhone}</p>
      </div>
    ),
    grade: a.appliedGrade ?? "—",
    status: <Badge variant={STATUS_VARIANT[a.status] ?? "outline"} className="capitalize">{a.status.replace("_", " ")}</Badge>,
    submitted: new Date(a.submittedAt).toLocaleDateString(),
    actions: (
      <div className="flex gap-1">
        {a.status === "submitted" && (
          <Button size="sm" variant="outline" onClick={async () => {
            try { await moveToReview({ applicationId: a._id as never }); toast.success("Moved to review"); }
            catch (e) { toast.error(String(e)); }
          }}>Review</Button>
        )}
        {["under_review", "assessment"].includes(a.status) && (
          <Button size="sm" variant="outline" onClick={() => { setAssessmentScore(""); setAssessmentNotes(""); setAssessmentId(a._id); }}>
            <ClipboardCheck className="size-3.5" /> Assessment
          </Button>
        )}
        {["assessment", "under_review"].includes(a.status) && (
          <>
            <Button size="sm" variant="outline" className="text-green-700" onClick={() => { setDecisionNotes(""); setDecideId({ id: a._id, decision: "accept" }); }}>
              <Check className="size-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="text-red-700" onClick={() => { setDecisionNotes(""); setDecideId({ id: a._id, decision: "reject" }); }}>
              <X className="size-3.5" />
            </Button>
          </>
        )}
        {a.status === "accepted" && (
          <Button size="sm" onClick={() => { setConvClassId(""); setConvYearId(""); setConvTermId(""); setConvAmount(""); setConvertId(a._id); }}>
            <RefreshCw className="size-3.5" /> Enroll
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setDetailId(a._id)}>View</Button>
      </div>
    ),
  }));

  const resetForm = () => {
    setFirstName(""); setLastName(""); setGender(""); setDateOfBirth(""); setPreviousSchool("");
    setGuardianName(""); setGuardianPhone(""); setGuardianEmail(""); setGradeLevelId("");
  };

  return (
    <>
      <PageHeader
        title="Admissions"
        description="Applications → review → assessment → decision → enrollment. Accepted applicants convert into Student + Guardian + Enrollment + Invoice without re-entering data."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus className="size-4" /> New Application
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {counts && [
            { label: "Received", value: counts.submitted, tone: "text-muted-foreground" },
            { label: "Pending review", value: counts.underReview + counts.assessment, tone: "text-amber-600" },
            { label: "Accepted", value: counts.accepted, tone: "text-green-600" },
            { label: "Rejected", value: counts.rejected, tone: "text-red-600" },
            { label: "Enrolled", value: counts.enrolled, tone: "text-primary" },
          ].map((s) => (
            <Card key={s.label} className="card-soft">
              <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle></CardHeader>
              <CardContent><p className={`text-2xl font-semibold ${s.tone}`}>{s.value}</p></CardContent>
            </Card>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {["submitted", "under_review", "assessment", "accepted", "rejected", "waitlisted", "enrolled", "withdrawn"].map((s) => (
                <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={[
            { key: "number", header: "No." },
            { key: "applicant", header: "Applicant" },
            { key: "grade", header: "Grade" },
            { key: "status", header: "Status" },
            { key: "submitted", header: "Submitted" },
            { key: "actions", header: "", className: "w-10" },
          ]}
          rows={rows}
          loading={listResult === undefined}
          empty={<><p className="text-sm font-medium">No applications</p><p className="text-xs text-muted-foreground">Applications appear here as prospective families apply.</p></>}
          page={0}
          pageSize={15}
          onPageChange={() => undefined}
          hasNextPage={false}
        />
      </div>

      {/* Create application */}
      <Dialog open={createOpen} onOpenChange={(open) => !open && (setCreateOpen(false), resetForm())}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New admission application</DialogTitle>
            <DialogDescription>Capture the applicant and guardian details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>First name *</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
              <div className="space-y-1"><Label>Last name *</Label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Date of birth</Label><Input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Applying for grade</Label>
              <Select value={gradeLevelId} onValueChange={setGradeLevelId}>
                <SelectTrigger><SelectValue placeholder="Select grade" /></SelectTrigger>
                <SelectContent>
                  {(gradeLevels ?? []).map((g) => <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Previous school</Label><Input value={previousSchool} onChange={(e) => setPreviousSchool(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Guardian name *</Label><Input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} /></div>
              <div className="space-y-1"><Label>Guardian phone *</Label><Input value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Guardian email</Label><Input type="email" value={guardianEmail} onChange={(e) => setGuardianEmail(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!firstName.trim() || !lastName.trim() || !guardianName.trim() || !guardianPhone.trim()}
              onClick={async () => {
                try {
                  await submitApplication({
                    firstName: firstName.trim(), lastName: lastName.trim(),
                    gender: gender || undefined, dateOfBirth: dateOfBirth || undefined,                    previousSchool: previousSchool || undefined,
                    guardianName: guardianName.trim(), guardianPhone: guardianPhone.trim(),
                    guardianEmail: guardianEmail || undefined,
                    appliedGradeLevelId: gradeLevelId || undefined,
                  } as never);
                  toast.success("Application submitted");
                  setCreateOpen(false); resetForm();
                } catch (e) { toast.error(String(e)); }
              }}
            >Submit application</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assessment */}
      <Dialog open={!!assessmentId} onOpenChange={(open) => !open && setAssessmentId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record assessment</DialogTitle>
            <DialogDescription>Interview / assessment outcome for this applicant.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Score</Label><Input type="number" value={assessmentScore} onChange={(e) => setAssessmentScore(e.target.value)} /></div>
            <div className="space-y-1"><Label>Notes</Label><Textarea rows={3} value={assessmentNotes} onChange={(e) => setAssessmentNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssessmentId(null)}>Cancel</Button>
            <Button onClick={async () => {
              try {
                await recordAssessment({
                  applicationId: assessmentId as never,
                  score: assessmentScore ? Number(assessmentScore) : undefined,
                  notes: assessmentNotes || "Assessment recorded",
                });
                toast.success("Assessment recorded"); setAssessmentId(null);
              } catch (e) { toast.error(String(e)); }
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Decision */}
      <Dialog open={!!decideId} onOpenChange={(open) => !open && setDecideId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decideId?.decision === "accept" ? "Accept" : "Reject"} application</DialogTitle>
            <DialogDescription>
              {decideId?.decision === "accept"
                ? "The applicant becomes eligible for conversion to a full student record."
                : "Rejected applications remain on file for reporting."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1"><Label>Decision notes</Label><Textarea rows={3} value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecideId(null)}>Cancel</Button>
            <Button
              variant={decideId?.decision === "accept" ? "default" : "destructive"}
              onClick={async () => {
                try {
                  await decideApplication({
                    applicationId: decideId!.id as never,
                    decision: decideId!.decision === "accept" ? "accepted" : "rejected",
                    notes: decisionNotes || undefined,
                  });
                  toast.success("Decision recorded"); setDecideId(null); setDecisionNotes("");
                } catch (e) { toast.error(String(e)); }
              }}
            >Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert / enroll */}
      <Dialog open={!!convertId} onOpenChange={(open) => !open && setConvertId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll accepted applicant</DialogTitle>
            <DialogDescription>
              Creates the Student, Guardian, Enrollment and an optional admission invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Academic year *</Label>
              <Select value={convYearId} onValueChange={(v) => { setConvYearId(v); setConvTermId(""); }}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {(academicYears ?? []).map((y) => <SelectItem key={y._id} value={y._id}>{y.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Term *</Label>
              <Select value={convTermId} onValueChange={setConvTermId}>
                <SelectTrigger><SelectValue placeholder="Select term" /></SelectTrigger>
                <SelectContent>
                  {(terms ?? []).map((t) => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Class *</Label>
              <Select value={convClassId} onValueChange={setConvClassId}>
                <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                <SelectContent>
                  {(classSections ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>{c.gradeName} {c.streamName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Admission invoice amount (optional)</Label>
              <Input type="number" value={convAmount} onChange={(e) => setConvAmount(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertId(null)}>Cancel</Button>
            <Button
              disabled={!convYearId || !convTermId || !convClassId}
              onClick={async () => {
                try {
                  const res = await convertApplication({
                    applicationId: convertId as never,
                    classSectionId: convClassId as never,
                    academicYearId: convYearId as never,
                    termId: convTermId as never,
                    invoiceAmount: convAmount ? Number(convAmount) : undefined,
                  });
                  toast.success(res.invoiceId ? "Enrolled with admission invoice" : "Enrolled");
                  setConvertId(null);
                } catch (e) { toast.error(String(e)); }
              }}
            >Convert & enroll</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.application.firstName} {detail?.application.lastName}</DialogTitle>
            <DialogDescription>
              <Badge variant={STATUS_VARIANT[detail?.application.status ?? ""] ?? "outline"} className="capitalize">
                {detail?.application.status.replace("_", " ")}
              </Badge>
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Application:</span> {detail.application.applicationNumber}</p>
              <p><span className="text-muted-foreground">Guardian:</span> {detail.application.guardianName} · {detail.application.guardianPhone}</p>
              <p><span className="text-muted-foreground">Previous school:</span> {detail.application.previousSchool ?? "—"}</p>
              <p><span className="text-muted-foreground">Applied grade:</span> {detail.appliedGrade ?? "—"}</p>
              {detail.application.assessmentScore !== undefined && (
                <p><span className="text-muted-foreground">Assessment:</span> {detail.application.assessmentScore}</p>
              )}
              {detail.application.studentId && <p className="text-green-700">Converted to student record.</p>}
              {detail.application.decisionNotes && (
                <p className="rounded-md bg-muted/50 p-3"><span className="font-medium">Decision notes:</span> {detail.application.decisionNotes}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
