import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/school-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, Circle, UserPlus } from "lucide-react";

type Status = {
  record: {
    profileDone: boolean; academicsDone: boolean; usersDone: boolean;
    importDone: boolean; activated: boolean; activatedAt: number | null;
  } | null;
  schoolStatus: string | null;
  schoolName: string | null;
};

export default function Onboarding() {
  const status = useQuery(api.phase7.onboarding.getStatus, {}) as Status | undefined;

  const [profileOpen, setProfileOpen] = useState(false);
  const [academicsOpen, setAcademicsOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [physical, setPhysical] = useState("");
  const [postal, setPostal] = useState("");
  const [county, setCounty] = useState("");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("KES");

  const [yearName, setYearName] = useState("2026");
  const [yearStart, setYearStart] = useState("2026-01-05");
  const [yearEnd, setYearEnd] = useState("2026-11-20");
  const [termCount, setTermCount] = useState("3");
  const [gradeNames, setGradeNames] = useState("Grade 1, Grade 2, Grade 3, Grade 4, Grade 5, Grade 6");
  const [streams, setStreams] = useState("Blue, Green");
  const [subjectNames, setSubjectNames] = useState("Mathematics, English, Kiswahili, Science, Social Studies");

  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [principalEmail, setPrincipalEmail] = useState("");
  const [principalName, setPrincipalName] = useState("");
  const [accountantEmail, setAccountantEmail] = useState("");
  const [accountantName, setAccountantName] = useState("");
  const [confirmName, setConfirmName] = useState("");

  const saveProfile = useMutation(api.phase7.onboarding.saveProfile);
  const setupAcademics = useMutation(api.phase7.onboarding.setupAcademics);
  const inviteInitialUsers = useMutation(api.phase7.onboarding.inviteInitialUsers);
  const activateSchool = useMutation(api.phase7.onboarding.activateSchool);

  const record = status?.record;
  const steps = [
    { key: "profile", label: "1. School profile", done: record?.profileDone },
    { key: "academics", label: "2. Academic setup", done: record?.academicsDone },
    { key: "users", label: "3. Initial users (admin, principal, accountant)", done: record?.usersDone },
    { key: "import", label: "4. Import students, guardians & staff", done: record?.importDone },
    { key: "activate", label: "5. Activate school", done: record?.activated },
  ];
  const allDone = record?.profileDone && record?.academicsDone && record?.usersDone;

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Guided school setup. Each step provisions real configuration — no orphan users: every invite creates User + School Membership + Role on acceptance."
        actions={status && <Badge variant={record?.activated ? "default" : "secondary"}>{record?.activated ? "Active" : "Onboarding"}</Badge>}
      />

      <div className="p-4 sm:p-6 space-y-4">
        <Card className="card-soft">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Setup checklist — {status?.schoolName ?? ""}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {steps.map((s) => (
              <div key={s.key} className="flex items-center justify-between rounded-md border border-border/60 p-3">
                <div className="flex items-center gap-2.5">
                  {s.done
                    ? <Check className="size-4 text-green-600" />
                    : <Circle className="size-4 text-muted-foreground" />}
                  <span className={`text-sm ${s.done ? "text-muted-foreground line-through" : "font-medium"}`}>{s.label}</span>
                </div>
                {!s.done && s.key === "profile" && (
                  <Button size="sm" onClick={() => setProfileOpen(true)}>Complete</Button>
                )}
                {!s.done && s.key === "academics" && (
                  <Button size="sm" onClick={() => setAcademicsOpen(true)}>Configure</Button>
                )}
                {!s.done && s.key === "users" && (
                  <Button size="sm" onClick={() => setUsersOpen(true)}><UserPlus className="size-3.5" /> Invite</Button>
                )}
                {!s.done && s.key === "import" && (
                  <span className="text-xs text-muted-foreground">Use Students → Import (marks this step complete)</span>
                )}
                {!s.done && s.key === "activate" && (
                  <Button size="sm" disabled={!allDone} onClick={() => setActivateOpen(true)}>Activate</Button>
                )}
                {s.done && s.key === "activate" && record?.activatedAt && (
                  <span className="text-xs text-muted-foreground">{new Date(record.activatedAt).toLocaleString()}</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {record && !record.activated && (
          <p className="text-xs text-muted-foreground">
            Note: importing data through the bulk importer automatically marks step 4 complete.
          </p>
        )}
      </div>

      {/* Step 1: profile */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Step 1 — School profile</DialogTitle>
            <DialogDescription>Contacts and location details for your school.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="space-y-1"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="space-y-1"><Label>Website</Label><Input value={website} onChange={(e) => setWebsite(e.target.value)} /></div>
            <div className="space-y-1"><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></div>
            <div className="space-y-1 col-span-2"><Label>Physical address</Label><Input value={physical} onChange={(e) => setPhysical(e.target.value)} /></div>
            <div className="space-y-1 col-span-2"><Label>Postal address</Label><Input value={postal} onChange={(e) => setPostal(e.target.value)} /></div>
            <div className="space-y-1"><Label>County / state</Label><Input value={county} onChange={(e) => setCounty(e.target.value)} /></div>
            <div className="space-y-1"><Label>Country</Label><Input value={country} onChange={(e) => setCountry(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              try {
                await saveProfile({
                  phone: phone || undefined, email: email || undefined, website: website || undefined,
                  physicalAddress: physical || undefined, postalAddress: postal || undefined,
                  county: county || undefined, country: country || undefined,
                  currency: currency || undefined,
                });
                toast.success("Profile saved — step 1 complete"); setProfileOpen(false);
              } catch (e) { toast.error(String(e)); }
            }}>Save profile</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2: academics */}
      <Dialog open={academicsOpen} onOpenChange={setAcademicsOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Step 2 — Academic setup</DialogTitle>
            <DialogDescription>Creates the academic year, terms, grade levels, classes (per stream) and subjects in one pass.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label>Year name *</Label><Input value={yearName} onChange={(e) => setYearName(e.target.value)} /></div>
              <div className="space-y-1"><Label>Start *</Label><Input type="date" value={yearStart} onChange={(e) => setYearStart(e.target.value)} /></div>
              <div className="space-y-1"><Label>End *</Label><Input type="date" value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Number of terms</Label><Input type="number" value={termCount} onChange={(e) => setTermCount(e.target.value)} /></div>
            <div className="space-y-1"><Label>Grades (comma-separated) *</Label><Input value={gradeNames} onChange={(e) => setGradeNames(e.target.value)} /></div>
            <div className="space-y-1"><Label>Streams (comma-separated)</Label><Input value={streams} onChange={(e) => setStreams(e.target.value)} /></div>
            <div className="space-y-1"><Label>Subjects (comma-separated) *</Label><Input value={subjectNames} onChange={(e) => setSubjectNames(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcademicsOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              try {
                await setupAcademics({
                  yearName: yearName.trim(), yearStart, yearEnd,
                  termCount: Number(termCount) || 3,
                  gradeNames: gradeNames.split(",").map((s) => s.trim()).filter(Boolean),
                  streams: streams.split(",").map((s) => s.trim()).filter(Boolean),
                  subjectNames: subjectNames.split(",").map((s) => s.trim()).filter(Boolean),
                });
                toast.success("Academic setup complete — step 2 done"); setAcademicsOpen(false);
              } catch (e) { toast.error(String(e)); }
            }}>Configure academics</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 3: initial users */}
      <Dialog open={usersOpen} onOpenChange={setUsersOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Step 3 — Initial users</DialogTitle>
            <DialogDescription>
              Invitations are emailed; each recipient sets their own password via a one-time activation link. No temporary passwords.
            </DialogDescription></DialogHeader>
          <div className="space-y-3">
            {[
              { role: "school_admin", label: "School administrator *", email: adminEmail, name: adminName, setEmail: setAdminEmail, setName: setAdminName },
              { role: "principal", label: "Principal", email: principalEmail, name: principalName, setEmail: setPrincipalEmail, setName: setPrincipalName },
              { role: "accountant", label: "Accountant", email: accountantEmail, name: accountantName, setEmail: setAccountantEmail, setName: setAccountantName },
            ].map((u) => (
              <div key={u.role} className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label>{u.label} email</Label><Input type="email" value={u.email} onChange={(e) => u.setEmail(e.target.value)} /></div>
                <div className="space-y-1"><Label>Name</Label><Input value={u.name} onChange={(e) => u.setName(e.target.value)} /></div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUsersOpen(false)}>Cancel</Button>
            <Button
              disabled={!adminEmail.trim()}
              onClick={async () => {
                try {
                  const users = [
                    { email: adminEmail.trim(), name: adminName.trim() || "Administrator", role: "school_admin" as const },
                    ...(principalEmail.trim() ? [{ email: principalEmail.trim(), name: principalName.trim() || "Principal", role: "principal" as const }] : []),
                    ...(accountantEmail.trim() ? [{ email: accountantEmail.trim(), name: accountantName.trim() || "Accountant", role: "accountant" as const }] : []),
                  ];
                  const res = await inviteInitialUsers({ users });
                  toast.success(`${res.invited} invitation(s) sent — step 3 done`);
                  setUsersOpen(false);
                } catch (e) { toast.error(String(e)); }
              }}
            >Send invitations</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 5: activate */}
      <AlertDialog open={activateOpen} onOpenChange={setActivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate this school?</AlertDialogTitle>
            <AlertDialogDescription>
              Activation flips the school from onboarding to fully active. Type the school name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={status?.schoolName ?? ""} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmName !== status?.schoolName}
              onClick={async (e) => {
                e.preventDefault();
                try {
                  await activateSchool({ confirmName });
                  toast.success("School is now active"); setActivateOpen(false); setConfirmName("");
                } catch (err) { toast.error(String(err)); }
              }}
            >Activate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
