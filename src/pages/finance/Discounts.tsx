import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { YearSelect, TermSelect, ScopeBar } from "@/components/ops/Controls";
import { Check, X, Plus, GraduationCap } from "lucide-react";

const DISC_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", applied: "default", rejected: "destructive", cancelled: "secondary",
};

export default function Discounts() {
  const [tab, setTab] = useState("discounts");
  const discounts = useQuery(api.finance.listDiscounts, {});
  const scholarships = useQuery(api.finance.listScholarships, {});

  const approveDiscount = useMutation(api.finance.approveDiscount);
  const rejectDiscount = useMutation(api.finance.rejectDiscount);

  // Request discount dialog
  const [open, setOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const requestDiscount = useMutation(api.finance.requestDiscount);
  const students = useQuery(api.students.list, { paginationOpts: { numItems: 200, cursor: null } });
  const filteredStudents = (students?.page ?? []).filter((s) =>
    `${s.firstName} ${s.lastName} ${s.admissionNumber}`.toLowerCase().includes(studentSearch.toLowerCase()),
  );

  const submitDiscount = async () => {
    setSaving(true);
    try {
      await requestDiscount({
        studentId: studentId as never,
        name,
        discountType,
        value: Number(value),
        reason: reason || undefined,
      });
      toast.success("Discount requested — pending approval");
      setOpen(false);
      setStudentId(""); setName(""); setValue(""); setReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  // Scholarship dialog
  const [schOpen, setSchOpen] = useState(false);
  const [schStudentId, setSchStudentId] = useState("");
  const [schName, setSchName] = useState("");
  const [schType, setSchType] = useState("percentage");
  const [schValue, setSchValue] = useState("");
  const [schYearId, setSchYearId] = useState("");
  const [schTermId, setSchTermId] = useState("");
  const [schReason, setSchReason] = useState("");
  const [schSaving, setSchSaving] = useState(false);
  const requestScholarship = useMutation(api.finance.requestScholarship);

  const submitScholarship = async () => {
    setSchSaving(true);
    try {
      await requestScholarship({
        studentId: schStudentId as never,
        name: schName,
        scholarshipType: schType,
        value: Number(schValue),
        academicYearId: schYearId as never,
        termId: (schTermId || undefined) as never,
        reason: schReason || undefined,
      });
      toast.success("Scholarship approved and recorded");
      setSchOpen(false);
      setSchStudentId(""); setSchName(""); setSchValue(""); setSchReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSchSaving(false);
    }
  };

  const pending = (discounts ?? []).filter((d) => d.status === "pending");

  return (
    <div className="page-shell">
      <PageHeader
        title="Discounts & Scholarships"
        description="Authorized, audited fee adjustments — nothing is modified silently."
        actions={
          <>
            <Can permission="discounts.manage">
              <Button variant="outline" onClick={() => setOpen(true)}><Plus className="size-4" /> Request discount</Button>
            </Can>
            <Can permission="scholarships.manage">
              <Button onClick={() => setSchOpen(true)}><GraduationCap className="size-4" /> New scholarship</Button>
            </Can>
          </>
        }
      />

      {pending.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {pending.length} discount{pending.length > 1 ? "s" : ""} awaiting approval.
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="discounts">Discounts</TabsTrigger>
          <TabsTrigger value="scholarships">Scholarships & bursaries</TabsTrigger>
        </TabsList>

        <TabsContent value="discounts" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Adjustment</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(discounts ?? []).map((d) => (
                    <TableRow key={d._id}>
                      <TableCell className="font-mono text-xs">{d.discountNumber}</TableCell>
                      <TableCell className="font-medium">{d.studentName}</TableCell>
                      <TableCell>{d.name}<p className="text-xs text-muted-foreground">{d.reason ?? ""}</p></TableCell>
                      <TableCell>{d.discountType === "percentage" ? `${d.value}%` : d.value.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-semibold">{d.computedAmount ? d.computedAmount.toLocaleString() : "—"}</TableCell>
                      <TableCell><Badge variant={DISC_VARIANT[d.status] ?? "secondary"}>{d.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        {d.status === "pending" && (
                          <div className="flex justify-end gap-1">
                            <Can permission="discounts.manage">
                              <Button size="sm" variant="outline" onClick={async () => {
                                try {
                                  const res = await approveDiscount({ discountId: d._id as never });
                                  toast.success(`Discount applied: ${res.computedAmount.toLocaleString()} credited`);
                                } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
                              }}>
                                <Check className="size-3.5" /> Approve
                              </Button>
                              <Button size="sm" variant="ghost" onClick={async () => {
                                const r = window.prompt("Rejection reason:");
                                if (!r) return;
                                try {
                                  await rejectDiscount({ discountId: d._id as never, reason: r });
                                  toast.success("Discount rejected");
                                } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
                              }}>
                                <X className="size-3.5" />
                              </Button>
                            </Can>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {discounts && discounts.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">No discounts recorded.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scholarships" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Scholarship</TableHead>
                    <TableHead>Award</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(scholarships ?? []).map((s) => (
                    <TableRow key={s._id}>
                      <TableCell className="font-medium">{s.studentName}</TableCell>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.scholarshipType === "percentage" ? `${s.value}%` : s.value.toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.reason ?? "—"}</TableCell>
                      <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {scholarships && scholarships.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No scholarships recorded.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Request discount dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request discount</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Student</Label>
              <Input placeholder="Search…" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} className="mt-1" />
              <select className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-sm" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Select student…</option>
                {filteredStudents.map((s) => <option key={s._id} value={s._id}>{s.firstName} {s.lastName} — {s.admissionNumber}</option>)}
              </select>
            </div>
            <div>
              <Label>Discount name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sibling discount / Staff child / Custom" className="mt-1" />
            </div>
            <ScopeBar>
              <div>
                <Label className="text-xs text-muted-foreground">Type</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
                  <option value="percentage">Percentage</option>
                  <option value="amount">Fixed amount</option>
                </select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Value</Label>
                <Input type="number" min="1" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1" />
              </div>
            </ScopeBar>
            <div>
              <Label>Reason</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this discount is justified" className="mt-1" />
            </div>
            <p className="text-xs text-muted-foreground">
              Percentage discounts are computed against the student's linked term invoice at approval time. Approval is audited.
            </p>
            <Button onClick={submitDiscount} disabled={saving || !studentId || !name || !value}>
              {saving ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New scholarship dialog */}
      <Dialog open={schOpen} onOpenChange={setSchOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New scholarship / bursary</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Student</Label>
              <Input placeholder="Search…" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} className="mt-1" />
              <select className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-sm" value={schStudentId} onChange={(e) => setSchStudentId(e.target.value)}>
                <option value="">Select student…</option>
                {filteredStudents.map((s) => <option key={s._id} value={s._id}>{s.firstName} {s.lastName} — {s.admissionNumber}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Name</Label>
                <Input value={schName} onChange={(e) => setSchName(e.target.value)} placeholder="Merit Scholarship 50%" className="mt-1" />
              </div>
              <div>
                <Label>Type</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={schType} onChange={(e) => setSchType(e.target.value)}>
                  <option value="percentage">Percentage</option>
                  <option value="amount">Fixed amount</option>
                </select>
              </div>
              <div>
                <Label>Value</Label>
                <Input type="number" min="1" value={schValue} onChange={(e) => setSchValue(e.target.value)} className="mt-1" />
              </div>
              <div />
            </div>
            <ScopeBar>
              <YearSelect yearId={schYearId} onChange={(v) => { setSchYearId(v); setSchTermId(""); }} />
              <TermSelect yearId={schYearId} termId={schTermId} onChange={setSchTermId} />
            </ScopeBar>
            <div>
              <Label>Reason</Label>
              <Input value={schReason} onChange={(e) => setSchReason(e.target.value)} placeholder="Approved by the bursary committee" className="mt-1" />
            </div>
            <Button onClick={submitScholarship} disabled={schSaving || !schStudentId || !schName || !schValue || !schYearId}>
              {schSaving ? "Saving…" : "Approve scholarship"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
