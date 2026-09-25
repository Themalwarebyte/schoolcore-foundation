import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { HelpHint } from "@/components/shared/help-hint";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { YearSelect, TermSelect, ScopeBar } from "@/components/ops/Controls";
import { Plus, Wand2, Trash2, Archive } from "lucide-react";

interface ItemDraft {
  name: string;
  category: string;
  amount: string;
  mandatory: boolean;
}

const emptyItem: ItemDraft = { name: "", category: "Tuition", amount: "", mandatory: true };

export default function Fees() {
  const [yearId, setYearId] = useState("");
  const [termId, setTermId] = useState("");

  const structures = useQuery(api.feeStructures.listStructures, {});
  const categories = useQuery(api.finance.listCategories, {});
  const readiness = useQuery(api.feeStructures.readiness, {});

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...emptyItem }]);
  const [saving, setSaving] = useState(false);

  const saveStructure = useMutation(api.feeStructures.saveStructure);
  const archiveStructure = useMutation(api.feeStructures.archiveStructure);

  // Billing run dialog state
  const [billingFor, setBillingFor] = useState<{ _id: string; name: string } | null>(null);
  const [issueDate, setIssueDate] = useState("2026-01-10");
  const [dueDate, setDueDate] = useState("2026-02-10");
  const [dryRun, setDryRun] = useState(true);
  const [preview, setPreview] = useState<{ pendingCount: number; perStudent: number; projectedTotal: number; alreadyBilledCount: number } | null>(null);

  const runBillingPreview = useQuery(
    api.feeStructures.billingPreview,
    billingFor ? { feeStructureId: billingFor._id as never } : "skip",
  );

  const runBilling = useMutation(api.feeStructures.runBilling);

  const openBilling = (s: { _id: string; name: string }) => {
    setBillingFor(s);
    setPreview(null);
    setDryRun(true);
  };

  const doRun = async () => {
    if (!billingFor) return;
    setSaving(true);
    try {
      const res = await runBilling({ feeStructureId: billingFor._id as never, issueDate, dueDate, dryRun });
      if (res.dryRun) {
        toast.success(`Dry run: ${res.created} invoices would be created (${res.total.toLocaleString()} total). Uncheck dry-run to issue.`);
        setDryRun(false);
      } else {
        toast.success(`Billing complete: ${res.created} invoices issued, ${res.skipped} students skipped (already billed).`);
        setBillingFor(null);
      }
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const submitStructure = async () => {
    setSaving(true);
    try {
      await saveStructure({
        name,
        termId: (termId || undefined) as never,
        applicableGradeLevelIds: [],
        items: items.map((i) => ({ name: i.name, category: i.category, amount: Number(i.amount), mandatory: i.mandatory })),
      });
      toast.success("Fee structure saved");
      setOpen(false);
      setName("");
      setItems([{ ...emptyItem }]);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Fees & Billing"
        description="Configure fee structures and issue term invoices from enrollments."
        actions={
          <Can permission="fees.manage">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="size-4" /> New fee structure</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-1.5">New fee structure <HelpHint text="Fee items are charges such as tuition, transport, meals and activities. The billing run creates one invoice per student from this structure." /></DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <YearSelect yearId={yearId} onChange={(v) => { setYearId(v); setTermId(""); }} />
                    <TermSelect yearId={yearId} termId={termId} onChange={setTermId} />
                  </div>
                  <div>
                    <Label>Structure name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Term 1 Standard Fees" className="mt-1" />
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <Label>Fee items</Label>
                      <Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, { ...emptyItem }])}>
                        <Plus className="size-3.5" /> Add item
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {items.map((item, idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_130px_110px_auto] items-center gap-2">
                          <Input value={item.name} onChange={(e) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} placeholder="Tuition" />
                          <select
                            className="h-9 rounded-md border bg-background px-2 text-sm"
                            value={item.category}
                            onChange={(e) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, category: e.target.value } : x)))}
                          >
                            {(categories ?? []).map((c) => (
                              <option key={c._id} value={c.name}>{c.name}</option>
                            ))}
                          </select>
                          <Input type="number" min="0" value={item.amount} onChange={(e) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} placeholder="40000" />
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={item.mandatory}
                              onCheckedChange={(v) => setItems((p) => p.map((x, i) => (i === idx ? { ...x, mandatory: v } : x)))}
                            />
                            <Button type="button" variant="ghost" size="icon" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}>
                              <Trash2 className="size-4 text-muted-foreground" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Total per student:{" "}
                      <span className="font-semibold text-foreground">
                        {items.reduce((s, i) => s + (Number(i.amount) || 0), 0).toLocaleString()}
                      </span>
                    </p>
                  </div>
                  <Button onClick={submitStructure} disabled={saving || !termId || !name || items.length === 0}>
                    {saving ? "Saving…" : "Save structure"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </Can>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Fee structures</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Structure</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead className="text-right">Total / student</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(structures ?? []).map((s) => (
                  <TableRow key={s._id}>
                    <TableCell className="font-medium">{s.name}<p className="text-xs text-muted-foreground">{s.itemCount} items</p></TableCell>
                    <TableCell>{s.termName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.grades}</TableCell>
                    <TableCell className="text-right font-semibold">{s.total.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Can permission="billing.create">
                          <Button size="sm" variant="outline" onClick={() => openBilling(s)}>
                            <Wand2 className="size-3.5" /> Bill
                          </Button>
                        </Can>
                        <Can permission="fees.manage">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              try {
                                await archiveStructure({ feeStructureId: s._id as never });
                                toast.success("Structure archived");
                              } catch (err) {
                                toast.error(friendlyError(err));
                              }
                            }}
                          >
                            <Archive className="size-3.5" />
                          </Button>
                        </Can>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {structures && structures.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No fee structures yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Billing readiness</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(readiness ?? []).map((r) => (
              <div key={r._id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.pending} students pending</p>
                </div>
                <Can permission="billing.create">
                  <Button size="sm" variant="outline" onClick={() => openBilling(r)}>Bill</Button>
                </Can>
              </div>
            ))}
            {readiness && readiness.length === 0 && (
              <p className="text-sm text-muted-foreground">Everything is billed for the active term.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Billing run dialog */}
      <Dialog open={!!billingFor} onOpenChange={(v) => !v && setBillingFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Billing run — {billingFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {runBillingPreview && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p>{runBillingPreview.enrolledCount} enrolled students match this structure.</p>
                <p>{runBillingPreview.alreadyBilledCount} already invoiced for this term — they will be skipped.</p>
                <p className="mt-1 font-semibold">
                  {runBillingPreview.pendingCount} invoices to issue · {runBillingPreview.perStudent.toLocaleString()} per student · total {runBillingPreview.projectedTotal.toLocaleString()}
                </p>
              </div>
            )}
            <ScopeBar>
              <div>
                <Label className="text-xs text-muted-foreground">Issue date</Label>
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Due date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" />
              </div>
            </ScopeBar>
            <div className="flex items-center gap-2">
              <Switch checked={dryRun} onCheckedChange={setDryRun} id="dry-run" />
              <Label htmlFor="dry-run">Dry run (preview only, nothing is issued)</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Badge variant="outline">Ledger-posted</Badge>
              <Button onClick={doRun} disabled={saving}>
                {saving ? "Running…" : dryRun ? "Preview billing" : "Issue invoices"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
