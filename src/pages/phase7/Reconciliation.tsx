import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/school-layout";
import { HelpHint } from "@/components/shared/help-hint";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Wand2, Eraser, History } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  allocated: "default",
  partially_allocated: "secondary",
  unallocated: "destructive",
};

type Overview = {
  payments: Array<{
    _id: string; paymentNumber: string; studentName: string; amount: number;
    paymentDate: string; method: string; referenceNumber: string | null;
    invoiceId: string | null; allocated: number; unallocated: number; status: string;
  }>;
  summary: {
    totalReceived: number; allocated: number; unallocated: number;
    unallocatedCount: number; providerPending: number;
  };
  providerTransactions: Array<{
    _id: string; account: string; providerTxnId: string;
    amount: number; status: string; receivedAt: number;
  }>;
};

export default function Reconciliation() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const overview = useQuery(api.phase7.billing.reconciliationOverview, {}) as Overview | undefined;
  const trail = useQuery(api.phase7.billing.paymentAllocationTrail,
    detailId ? { paymentId: detailId as never } : "skip");
  const settings = useQuery(api.phase7.billing.getAllocationSettings, {});

  const allocate = useMutation(api.phase7.billing.allocatePayment);
  const clearAllocations = useMutation(api.phase7.billing.clearAllocations);
  const setStrategy = useMutation(api.phase7.billing.setAllocationStrategy);

  const rows = (overview?.payments ?? []).map((p) => ({
    _id: p._id,
    payment: (
      <div>
        <p className="font-mono text-xs font-medium">{p.paymentNumber}</p>
        <p className="text-xs text-muted-foreground">{p.method}{p.referenceNumber ? ` · ${p.referenceNumber}` : ""}</p>
      </div>
    ),
    student: p.studentName,
    date: p.paymentDate,
    amount: p.amount,
    allocated: p.allocated,
    unallocated: <span className={p.unallocated > 0 ? "font-medium text-amber-600" : ""}>{p.unallocated}</span>,
    status: <Badge variant={STATUS_VARIANT[p.status] ?? "outline"} className="capitalize">{p.status.replace(/_/g, " ")}</Badge>,
    actions: (
      <div className="flex gap-1">
        {p.status === "unallocated" && (
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              const res = await allocate({ paymentId: p._id as never });
              toast.success(`Allocated ${res.allocated} (${res.strategy}, ${res.lines} lines)`);
            } catch (e) { toast.error(friendlyError(e)); }
          }}>
            <Wand2 className="size-3.5" /> Auto
          </Button>
        )}
        {p.status !== "unallocated" && (
          <Button size="sm" variant="ghost" onClick={async () => {
            try {
              await clearAllocations({ paymentId: p._id as never });
              toast.success("Allocations cleared for re-allocation");
            } catch (e) { toast.error(friendlyError(e)); }
          }}>
            <Eraser className="size-3.5" />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setDetailId(p._id)}>
          <History className="size-3.5" />
        </Button>
      </div>
    ),
  }));

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-1.5">Reconciliation Centre <HelpHint text="Choose how received payments should be applied against outstanding charges — automatically by priority, or matched manually against bank statement lines." /></span>
        }
        description="Every received payment with its allocation status. Auto-allocation follows the school's votehead priority and oldest-balance-first rules; every action is audited."
        actions={
          <Select
            value={settings?.strategy ?? "votehead_priority"}
            onValueChange={async (v) => {
              try { await setStrategy({ strategy: v }); toast.success(`Strategy set to ${v.replace(/_/g, " ")}`); }
              catch (e) { toast.error(friendlyError(e)); }
            }}
          >
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="votehead_priority">Strategy: votehead priority</SelectItem>
              <SelectItem value="oldest_first">Strategy: oldest balance first</SelectItem>
              <SelectItem value="manual">Strategy: manual only</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        {overview && (
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { label: "Total received", value: overview.summary.totalReceived, tone: "text-foreground" },
              { label: "Allocated", value: overview.summary.allocated, tone: "text-green-600" },
              { label: "Unallocated", value: overview.summary.unallocated, tone: "text-amber-600" },
              { label: "Provider txns pending", value: overview.summary.providerPending, tone: "text-muted-foreground" },
            ].map((s) => (
              <Card key={s.label} className="card-soft">
                <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle></CardHeader>
                <CardContent><p className={`text-2xl font-semibold ${s.tone}`}>{s.value}</p></CardContent>
              </Card>
            ))}
          </div>
        )}

        <DataTable
          columns={[
            { key: "payment", header: "Payment" },
            { key: "student", header: "Student" },
            { key: "date", header: "Date" },
            { key: "amount", header: "Amount" },
            { key: "allocated", header: "Allocated" },
            { key: "unallocated", header: "Unallocated" },
            { key: "status", header: "Status" },
            { key: "actions", header: "", className: "w-10" },
          ]}
          rows={rows}
          loading={overview === undefined}
          empty={<><p className="text-sm font-medium">No payments yet</p><p className="text-xs text-muted-foreground">Payments appear here for allocation and reconciliation.</p></>}
          page={0}
          pageSize={15}
          onPageChange={() => undefined}
          hasNextPage={false}
        />

        {(overview?.providerTransactions.length ?? 0) > 0 && (
          <Card className="card-soft">
            <CardHeader className="pb-2"><CardTitle className="text-sm">External provider transactions awaiting match</CardTitle></CardHeader>
            <CardContent>
              <DataTable
                columns={[
                  { key: "txn", header: "Provider txn" },
                  { key: "account", header: "Account (admission no.)" },
                  { key: "amount", header: "Amount" },
                  { key: "status", header: "Status" },
                ]}
                rows={(overview?.providerTransactions ?? []).map((t) => ({
                  _id: t._id,
                  txn: <span className="font-mono text-xs">{t.providerTxnId}</span>,
                  account: t.account,
                  amount: t.amount,
                  status: <Badge variant="outline">{t.status}</Badge>,
                }))}
                loading={false}
                empty={null}
                page={0}
                pageSize={10}
                onPageChange={() => undefined}
                hasNextPage={false}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Allocation trail */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Allocation trail — {trail?.payment.paymentNumber}</DialogTitle>
            <DialogDescription>
              {trail?.student ? `${trail.student.name} (${trail.student.admissionNumber}) · ` : ""}
              {trail?.payment.amount} via {trail?.payment.method}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(trail?.allocations ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No allocations recorded — payment is unallocated.</p>
            ) : (
              (trail?.allocations ?? []).map((a) => (
                <div key={a._id} className="rounded-md border border-border/60 p-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.voteheadName}</span>
                    <span className="font-mono text-xs">{a.amount}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {a.strategy} · by {a.allocatedBy} · {new Date(a.allocatedAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

