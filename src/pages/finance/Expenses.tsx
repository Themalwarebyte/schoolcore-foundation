import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Check, X, Send } from "lucide-react";

const EXP_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default", rejected: "destructive", paid: "default",
};

export default function Expenses() {
  const [statusFilter, setStatusFilter] = useState("all");
  const expenses = useQuery(api.financeOps.listExpenses, { status: statusFilter });

  const createExpense = useMutation(api.financeOps.createExpense);
  const submitExpense = useMutation(api.financeOps.submitExpense);
  const approveExpense = useMutation(api.financeOps.approveExpense);
  const rejectExpense = useMutation(api.financeOps.rejectExpense);

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [submitNow, setSubmitNow] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await createExpense({
        category, payee, amount: Number(amount), expenseDate,
        description: description || undefined, submitNow,
      });
      toast.success(submitNow ? "Expense created and submitted for approval" : "Expense draft saved");
      setOpen(false);
      setCategory(""); setPayee(""); setAmount(""); setDescription("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Expenses"
        description="School expenditure with a full approval workflow — approved+paid expenses post to the ledger."
        actions={
          <Can permission="expenses.create">
            <Button onClick={() => setOpen(true)}><Plus className="size-4" /> New expense</Button>
          </Can>
        }
      />

      <div className="mb-4">
        <Label className="text-xs text-muted-foreground">Filter status</Label>
        <select className="mt-1 h-9 w-56 rounded-md border bg-background px-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All</option>
          {["draft", "submitted", "approved", "rejected", "paid"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(expenses ?? []).map((e) => (
                <TableRow key={e._id}>
                  <TableCell className="font-mono text-xs">{e.expenseNumber}</TableCell>
                  <TableCell className="font-medium">{e.category}</TableCell>
                  <TableCell>{e.payee}<p className="text-xs text-muted-foreground">{e.description ?? ""}</p></TableCell>
                  <TableCell>{e.expenseDate}</TableCell>
                  <TableCell className="text-right font-semibold">{e.amount.toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={EXP_VARIANT[e.status] ?? "secondary"}>{e.status}</Badge>
                    {e.rejectionReason && <p className="text-xs text-muted-foreground">{e.rejectionReason}</p>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {(e.status === "draft" || e.status === "rejected") && (
                        <Can permission="expenses.create">
                          <Button size="sm" variant="outline" onClick={async () => {
                            try { await submitExpense({ expenseId: e._id as never }); toast.success("Submitted for approval"); }
                            catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
                          }}>
                            <Send className="size-3.5" /> Submit
                          </Button>
                        </Can>
                      )}
                      {e.status === "submitted" && (
                        <Can permission="expenses.approve">
                          <Button size="sm" variant="outline" onClick={async () => {
                            try { await approveExpense({ expenseId: e._id as never }); toast.success("Expense approved"); }
                            catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
                          }}>
                            <Check className="size-3.5" /> Approve
                          </Button>
                          <Button size="sm" variant="ghost" onClick={async () => {
                            const r = window.prompt("Rejection reason:");
                            if (!r) return;
                            try { await rejectExpense({ expenseId: e._id as never, reason: r }); toast.success("Expense rejected"); }
                            catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
                          }}>
                            <X className="size-3.5" />
                          </Button>
                        </Can>
                      )}
                      {e.status === "approved" && (
                        <Can permission="expenses.approve">
                          <Button size="sm" variant="outline" onClick={async () => {
                            try { await approveExpense({ expenseId: e._id as never, payNow: true }); toast.success("Expense marked paid and posted to the ledger"); }
                            catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
                          }}>
                            Mark paid
                          </Button>
                        </Can>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {expenses && expenses.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">No expenses recorded.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New expense</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Category</Label>
                <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Utilities / Salaries / Supplies…" className="mt-1" />
              </div>
              <div>
                <Label>Supplier / payee</Label>
                <Input value={payee} onChange={(e) => setPayee(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Amount</Label>
                <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1" rows={2} />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} />
                Submit for approval immediately
              </label>
              <Button onClick={submit} disabled={saving || !category || !payee || !amount}>
                {saving ? "Saving…" : "Save expense"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
