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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Plus, ListTree } from "lucide-react";

export default function Voteheads() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [priority, setPriority] = useState("");
  const [desc, setDesc] = useState("");
  const [invoiceId, setInvoiceId] = useState("");

  const voteheads = useQuery(api.phase7.billing.listVoteheads, {});
  const invoices = useQuery(api.finance.listInvoices, {});
  const breakdown = useQuery(api.phase7.billing.invoiceBreakdown,
    invoiceId ? { invoiceId: invoiceId as never } : "skip");

  const upsert = useMutation(api.phase7.billing.upsertVotehead);

  return (
    <>
      <PageHeader
        title="Fee Voteheads"
        description="The meaning behind every fee line — Tuition, Lunch, Transport, Swimming… Payments are allocated against invoice lines per votehead using school priority rules."
        actions={
          <Button onClick={() => { setName(""); setCode(""); setPriority(""); setDesc(""); setOpen(true); }}>
            <Plus className="size-4" /> New votehead
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <DataTable
          columns={[
            { key: "priority", header: "Priority" },
            { key: "name", header: "Votehead" },
            { key: "code", header: "Code" },
            { key: "desc", header: "Description" },
            { key: "status", header: "Status" },
          ]}
          rows={(voteheads ?? [])
            .slice()
            .sort((a, b) => a.allocationPriority - b.allocationPriority)
            .map((v) => ({
              _id: v._id,
              priority: <span className="font-mono text-xs">{v.allocationPriority}</span>,
              name: <span className="font-medium">{v.name}</span>,
              code: <Badge variant="outline">{v.code}</Badge>,
              desc: <span className="text-xs text-muted-foreground">{v.description ?? "—"}</span>,
              status: <Badge variant={v.active ? "default" : "secondary"}>{v.active ? "active" : "inactive"}</Badge>,
            }))}
          loading={voteheads === undefined}
          empty={<><p className="text-sm font-medium">No voteheads configured</p><p className="text-xs text-muted-foreground">Create voteheads so invoice lines can be tagged and payments allocated intelligently.</p></>}
          page={0}
          pageSize={20}
          onPageChange={() => undefined}
          hasNextPage={false}
        />

        <Card className="card-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ListTree className="size-4" /> Invoice votehead breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1 max-w-md">
              <Label>Invoice</Label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
              >
                <option value="">Select an invoice…</option>
                {(invoices ?? []).map((inv) => (
                  <option key={inv._id} value={inv._id}>
                    {inv.invoiceNumber} — {inv.studentName} ({inv.totalAmount})
                  </option>
                ))}
              </select>
            </div>
            {invoiceId && (
              <DataTable
                columns={[
                  { key: "vh", header: "Votehead" },
                  { key: "billed", header: "Billed" },
                  { key: "allocated", header: "Allocated" },
                  { key: "balance", header: "Balance" },
                ]}
                rows={(breakdown?.lines ?? []).map((l) => ({
                  _id: l.voteheadName,
                  vh: l.voteheadName,
                  billed: l.billed,
                  allocated: l.allocated,
                  balance: <span className={l.balance > 0 ? "font-medium" : "text-muted-foreground"}>{l.balance}</span>,
                }))}
                loading={breakdown === undefined}
                empty={<p className="text-sm text-muted-foreground">No lines on this invoice.</p>}
                page={0}
                pageSize={10}
                onPageChange={() => undefined}
                hasNextPage={false}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New fee votehead</DialogTitle>
            <DialogDescription>
              Lower allocation priority is allocated first when payments come in.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Swimming" /></div>
            <div className="space-y-1"><Label>Code (optional)</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto" /></div>
            <div className="space-y-1"><Label>Allocation priority</Label><Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="Auto (next)" /></div>
            <div className="space-y-1"><Label>Description</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!name.trim()}
              onClick={async () => {
                try {
                  await upsert({
                    name: name.trim(),
                    code: code || undefined,
                    description: desc || undefined,
                    allocationPriority: priority ? Number(priority) : undefined,
                  });
                  toast.success("Votehead saved");
                  setOpen(false);
                } catch (e) { toast.error(String(e)); }
              }}
            >Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
