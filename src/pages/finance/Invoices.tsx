import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { Link } from "react-router";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { HelpHint } from "@/components/shared/help-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { TermSelect, ScopeBar } from "@/components/ops/Controls";
import { Plus, Trash2, Ban, Send, FileText } from "lucide-react";

interface ItemDraft { description: string; category: string; quantity: string; amount: string }

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", issued: "secondary", partially_paid: "secondary", paid: "default", overdue: "destructive", cancelled: "destructive",
};

export function InvoiceStatusBadge({ status }: { status: string }) {
  const meta: Record<string, string> = {
    draft: "Draft", issued: "Issued", partially_paid: "Partially Paid",
    paid: "Paid", overdue: "Overdue", cancelled: "Cancelled",
  };
  return <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{meta[status] ?? status}</Badge>;
}

import { Badge } from "@/components/ui/badge";

export default function Invoices() {
  const [termId, setTermId] = useState("");
  const [status, setStatus] = useState("all");

  const invoices = useQuery(api.finance.listInvoices, { status });
  const categories = useQuery(api.finance.listCategories, {});
  const terms = useQuery(api.academics.listTerms, termId ? { academicYearId: undefined as never } : "skip");

  // Create dialog
  const [open, setOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentId, setStudentId] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ description: "", category: "Tuition", quantity: "1", amount: "" }]);
  const [issueNow, setIssueNow] = useState(true);
  const [saving, setSaving] = useState(false);

  const createInvoice = useMutation(api.finance.createInvoice);
  const cancelInvoice = useMutation(api.finance.cancelInvoice);
  const issueInvoice = useMutation(api.finance.issueInvoice);

  const students = useQuery(api.students.list, {
    paginationOpts: { numItems: 200, cursor: null },
  });
  const filteredStudents = (students?.page ?? []).filter((s) =>
    `${s.firstName} ${s.lastName} ${s.admissionNumber}`.toLowerCase().includes(studentSearch.toLowerCase()),
  );

  const submit = async () => {
    setSaving(true);
    try {
      await createInvoice({
        studentId: studentId as never,
        termId: termId as never,
        issueDate,
        dueDate: dueDate || issueDate,
        items: items.map((i) => ({ description: i.description, category: i.category, quantity: Number(i.quantity) || 1, amount: Number(i.amount) })),
        issueNow,
      });
      toast.success(issueNow ? "Invoice issued and posted to the ledger" : "Draft invoice saved");
      setOpen(false);
      setStudentId("");
      setItems([{ description: "", category: "Tuition", quantity: "1", amount: "" }]);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.amount) || 0), 0);

  return (
    <div className="page-shell">
      <PageHeader
        title="Invoices"
        description="Student fee invoices — issued invoices post to the financial ledger."
        actions={
          <Can permission="billing.create">
            <Button onClick={() => setOpen(true)}><Plus className="size-4" /> New invoice</Button>
          </Can>
        }
      />

      <ScopeBar>
        <div>
          <Label className="text-xs text-muted-foreground">Term filter</Label>
          <TermSelect
            yearId=""
            termId={termId}
            onChange={setTermId}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"].map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </div>
      </ScopeBar>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(invoices ?? []).map((inv) => (
              <TableRow key={inv._id}>
                <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                <TableCell>
                  <Link to={`/students/${inv.studentId}`} className="font-medium hover:underline">{inv.studentName}</Link>
                  <p className="text-xs text-muted-foreground">{inv.admissionNumber}</p>
                </TableCell>
                <TableCell>{inv.issueDate}</TableCell>
                <TableCell>{inv.dueDate}</TableCell>
                <TableCell className="text-right font-semibold">{inv.totalAmount.toLocaleString()}</TableCell>
                <TableCell><InvoiceStatusBadge status={inv.status} /></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {inv.status === "draft" && (
                      <Can permission="billing.create">
                        <Button size="sm" variant="outline" onClick={async () => {
                          try {
                            await issueInvoice({ invoiceId: inv._id as never });
                            toast.success("Invoice issued");
                          } catch (err) { toast.error(friendlyError(err)); }
                        }}>
                          <Send className="size-3.5" /> Issue
                        </Button>
                      </Can>
                    )}
                    {inv.status !== "cancelled" && inv.status !== "paid" && (
                      <Can permission="billing.create">
                        <Button size="sm" variant="ghost" onClick={async () => {
                          const reason = window.prompt("Cancellation reason (required, audited):");
                          if (!reason) return;
                          try {
                            await cancelInvoice({ invoiceId: inv._id as never, reason });
                            toast.success("Invoice cancelled with audit trail");
                          } catch (err) { toast.error(friendlyError(err)); }
                        }}>
                          <Ban className="size-3.5" />
                        </Button>
                      </Can>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {invoices && invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <p className="text-sm font-medium">No invoices yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create your first invoice, or run a billing cycle under Fees &amp; Billing.
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create invoice dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">New invoice <HelpHint text="Choose the student and term, then add line items. Each item's category maps to a fee votehead used for payment allocation and reports." /></DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Student</Label>
                <Input
                  placeholder="Search name or admission no…"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  className="mt-1"
                />
                <select
                  className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                >
                  <option value="">Select student…</option>
                  {filteredStudents.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.firstName} {s.lastName} — {s.admissionNumber}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="flex items-center gap-1.5">Term <HelpHint text="Only terms in an academic year are listed. Set the current year on the Fees page if this is empty." /></Label>
                <TermSelect yearId="" termId={termId} onChange={setTermId} className="mt-1" />
                {terms === undefined && <p className="mt-1 text-xs text-muted-foreground">Pick a year first on the Fees page context if empty.</p>}
              </div>
              <div>
                <Label>Issue date</Label>
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Due date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Invoice items</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, { description: "", category: "Tuition", quantity: "1", amount: "" }])}>
                  <Plus className="size-3.5" /> Add item
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_120px_60px_100px_auto] items-center gap-2">
                    <Input value={item.description} onChange={(e) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} placeholder="Tuition fee" />
                    <select className="h-9 rounded-md border bg-background px-2 text-sm" value={item.category} onChange={(e) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, category: e.target.value } : x)))}>
                      {(categories ?? []).map((c) => <option key={c._id} value={c.name}>{c.name}</option>)}
                    </select>
                    <Input type="number" min="1" value={item.quantity} onChange={(e) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))} />
                    <Input type="number" min="0" value={item.amount} onChange={(e) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} placeholder="40000" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}>
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-sm font-semibold">Total: {total.toLocaleString()}</p>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={issueNow} onCheckedChange={setIssueNow} id="issue-now" />
              <Label htmlFor="issue-now">Issue immediately (posts the receivable to the ledger)</Label>
            </div>

            <div className="flex justify-end gap-2">
              <FileText className="size-4 self-center text-muted-foreground" />
              <Button onClick={submit} disabled={saving || !studentId || !termId || items.length === 0}>
                {saving ? "Saving…" : issueNow ? "Create & issue" : "Save draft"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
