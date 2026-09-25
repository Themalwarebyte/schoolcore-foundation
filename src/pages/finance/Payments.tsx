import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/lib/status";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScopeBar } from "@/components/ops/Controls";
import { buildReceiptPdf, downloadPdf } from "@/lib/financePdf";
import { Plus, Undo2, Printer } from "lucide-react";

export default function Payments() {
  const [studentFilter, setStudentFilter] = useState("");
  const payments = useQuery(api.finance.listPayments, {});
  const methods = useQuery(api.finance.listPaymentMethods, {});

  const [open, setOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const recordPayment = useMutation(api.finance.recordPayment);
  const reversePayment = useMutation(api.finance.reversePayment);

  const students = useQuery(api.students.list, { paginationOpts: { numItems: 200, cursor: null } });
  const filteredStudents = (students?.page ?? []).filter((s) =>
    `${s.firstName} ${s.lastName} ${s.admissionNumber}`.toLowerCase().includes(studentSearch.toLowerCase()),
  );

  const visible = (payments ?? []).filter((p) =>
    `${p.studentName} ${p.admissionNumber} ${p.paymentNumber}`.toLowerCase().includes(studentFilter.toLowerCase()),
  );

  const submit = async () => {
    setSaving(true);
    try {
      const res = await recordPayment({
        studentId: studentId as never,
        amount: Number(amount),
        paymentDate,
        method,
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
      });
      toast.success(`Payment recorded — receipt ${res.receiptNumber} issued (balance ${res.balanceAfter.toLocaleString()})`);
      setOpen(false);
      setStudentId("");
      setAmount("");
      setReferenceNumber("");
      setNotes("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  const printReceipt = async (paymentId: string) => {
    try {
      const detail = (await fetchPaymentDetail(paymentId)) as {
        payment: { paymentNumber: string; amount: number; paymentDate: string; method: string; referenceNumber: string | null };
        student: { name: string; admissionNumber: string } | null;
        receipt: { receiptNumber: string; balanceAfter: number } | null;
        invoice: { invoiceNumber: string } | null;
        school: { name: string; county: string | null; phone: string | null; email: string | null; postalAddress: string | null };
        receivedBy: string | null;
      } | null;
      if (!detail || !detail.student) {
        toast.error("Payment details unavailable");
        return;
      }
      const doc = buildReceiptPdf({
        school: detail.school,
        receiptNumber: detail.receipt?.receiptNumber ?? "PENDING",
        paymentNumber: detail.payment.paymentNumber,
        student: detail.student,
        amount: detail.payment.amount,
        method: detail.payment.method,
        referenceNumber: detail.payment.referenceNumber,
        paymentDate: detail.payment.paymentDate,
        receivedBy: detail.receivedBy,
        balanceAfter: detail.receipt?.balanceAfter ?? null,
        invoiceNumber: detail.invoice?.invoiceNumber ?? null,
      });
      downloadPdf(doc, `${detail.receipt?.receiptNumber ?? detail.payment.paymentNumber}.pdf`);
      toast.success("Receipt PDF downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to build receipt");
    }
  };

  // paymentDetail is a query — invoke through useQuery once a receipt is targeted.
  const [receiptTarget, setReceiptTarget] = useState<string | null>(null);
  const detail = useQuery(
    api.finance.paymentDetail,
    receiptTarget ? { paymentId: receiptTarget as never } : "skip",
  );
  async function fetchPaymentDetail(paymentId: string) {
    setReceiptTarget(paymentId);
    // The query resolves asynchronously; wait a tick for the reactive result.
    for (let i = 0; i < 50; i++) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
      if (detail && (detail as { payment?: { _id?: string } }).payment?._id === paymentId) return detail;
      if (detail === null) return null;
    }
    return detail;
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Payments & Receipts"
        description="Record payments, issue numbered receipts and reverse mistakes with a full audit trail."
        actions={
          <Can permission="payments.create">
            <Button onClick={() => setOpen(true)}><Plus className="size-4" /> Record payment</Button>
          </Can>
        }
      />

      <ScopeBar>
        <div>
          <Label className="text-xs text-muted-foreground">Search student or payment #</Label>
          <Input value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)} placeholder="Amina / PAY-2026-…" className="mt-1" />
        </div>
      </ScopeBar>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payment</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((p) => (
              <TableRow key={p._id}>
                <TableCell className="font-mono text-xs">{p.paymentNumber}</TableCell>
                <TableCell className="font-medium">{p.studentName}<p className="text-xs text-muted-foreground">{p.admissionNumber}</p></TableCell>
                <TableCell>{p.paymentDate}</TableCell>
                <TableCell>{p.method}</TableCell>
                <TableCell className="text-xs">{p.referenceNumber ?? "—"}</TableCell>
                <TableCell className="text-right font-semibold">{p.amount.toLocaleString()}</TableCell>
                <TableCell><StatusBadge status={p.status === "confirmed" ? "active" : p.status === "reversed" ? "archived" : "inactive"} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Can permission="receipts.print">
                      <Button size="sm" variant="outline" onClick={() => printReceipt(p._id)}>
                        <Printer className="size-3.5" /> Receipt
                      </Button>
                    </Can>
                    {p.status === "confirmed" && (
                      <Can permission="payments.approve">
                        <Button size="sm" variant="ghost" onClick={async () => {
                          const reason = window.prompt("Reversal reason (required, audited):");
                          if (!reason) return;
                          try {
                            await reversePayment({ paymentId: p._id as never, reason });
                            toast.success("Payment reversed and receipt voided");
                          } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
                        }}>
                          <Undo2 className="size-3.5" />
                        </Button>
                      </Can>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {payments && payments.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <p className="text-sm font-medium">No payments recorded yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Record a payment against an invoice to see it (and its receipt) here.
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Record payment dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Student</Label>
              <Input placeholder="Search name or admission no…" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} className="mt-1" />
              <select className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-sm" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Select student…</option>
                {filteredStudents.map((s) => (
                  <option key={s._id} value={s._id}>{s.firstName} {s.lastName} — {s.admissionNumber}</option>
                ))}
              </select>
            </div>
            <ScopeBar>
              <div>
                <Label className="text-xs text-muted-foreground">Amount</Label>
                <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Payment date</Label>
                <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="mt-1" />
              </div>
            </ScopeBar>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Method</Label>
                <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="">Select method…</option>
                  {(methods ?? []).map((m) => <option key={m._id} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Reference (optional)</Label>
                <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="M-Pesa code / cheque no." className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
            </div>
            <div className="flex items-center justify-between">
              <Badge variant="outline">Generates numbered receipt</Badge>
              <Button onClick={submit} disabled={saving || !studentId || !amount || !method}>
                {saving ? "Recording…" : "Record payment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
