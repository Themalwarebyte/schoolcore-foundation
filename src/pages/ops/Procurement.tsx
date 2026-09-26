import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Truck, ClipboardList, Check, X, PackageCheck, Plus } from "lucide-react";
import { Pill, statusTone, FormDialog, Field } from "@/components/ops/shared";

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function ProcurementPage() {
  const dash = useQuery(api.procurement.procurementDashboard, {});
  const [tab, setTab] = useState<"requests" | "orders" | "suppliers">("requests");
  const requests = useQuery(api.procurement.listPurchaseRequests, { status: "all" });
  const orders = useQuery(api.procurement.listPurchaseOrders, {});
  const suppliers = useQuery(api.procurement.listSuppliers, {});

  return (
    <div>
      <PageHeader title="Procurement" description="Suppliers, purchase requests and orders — linked to Finance." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Suppliers" value={dash?.supplierCount ?? "—"} icon={Truck} />
        <MiniStat label="Pending requests" value={dash?.pendingRequests ?? "—"} icon={ClipboardList} tone={dash?.pendingRequests ? "warn" : "good"} />
        <MiniStat label="Open orders" value={dash?.openOrders ?? "—"} icon={ClipboardList} />
        <MiniStat label="Received value" value={money(dash?.receivedValue ?? 0)} icon={PackageCheck} />
      </div>

      <div className="mb-3 flex gap-1 rounded-lg border p-1 text-sm w-fit">
        {(["requests", "orders", "suppliers"] as const).map((t) => (
          <button
            key={t}
            className={`rounded-md px-3 py-1.5 capitalize transition ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "requests" ? <RequestsTab requests={requests ?? []} /> : null}
      {tab === "orders" ? <OrdersTab orders={orders ?? []} /> : null}
      {tab === "suppliers" ? <SuppliersTab suppliers={suppliers ?? []} /> : null}
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone?: "warn" | "good" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className={`mt-2 text-2xl font-bold tabular-nums ${tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */

function RequestsTab({
  requests,
}: {
  requests: Array<{
    _id: string; requestNumber: string; supplier: string | null; department: string | null;
    requestedBy: string; neededBy: string | null; justification: string | null;
    items: Array<{ description: string; quantity: number; unitCost: number }>;
    estimatedTotal: number; status: string; decisionNote: string | null;
  }>;
}) {
  const createRequest = useMutation(api.procurement.createPurchaseRequest);
  const decide = useMutation(api.procurement.decidePurchaseRequest);
  const createOrder = useMutation(api.procurement.createPurchaseOrder);
  const suppliers = useQuery(api.procurement.listSuppliers, {});
  const departments = useQuery(api.hr.listDepartments, {});

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="procurement.manage">
          <FormDialog
            title="New purchase request"
            trigger={<Button size="sm"><Plus />New request</Button>}
            wide
            onSubmit={async (data) => {
              const items = [1, 2, 3]
                .map((n) => ({
                  description: String(data[`desc${n}`] ?? "").trim(),
                  quantity: Number(data[`qty${n}`] || "0"),
                  unitCost: Number(data[`cost${n}`] || "0"),
                }))
                .filter((i) => i.description && i.quantity > 0);
              await createRequest({
                supplierId: (data.supplierId || undefined) as never,
                departmentId: (data.departmentId || undefined) as never,
                neededBy: data.neededBy || undefined,
                justification: data.justification || undefined,
                items,
                submitNow: true,
              });
              toast.success("Purchase request submitted for approval");
            }}
          >
            {(set) => (
              <>
                <Field label="Supplier">
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("supplierId", e.target.value)} defaultValue="">
                    <option value="">— none —</option>
                    {(suppliers ?? []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Department">
                  <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("departmentId", e.target.value)} defaultValue="">
                    <option value="">— none —</option>
                    {(departments ?? []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                  </select>
                </Field>
                <Field label="Needed by"><Input type="date" onChange={(e) => set("neededBy", e.target.value)} /></Field>
                {[1, 2, 3].map((n) => (
                  <div key={n} className="grid grid-cols-6 gap-2">
                    <Input className="col-span-3" placeholder={`Item ${n} description`} onChange={(e) => set(`desc${n}`, e.target.value)} />
                    <Input className="col-span-1" type="number" placeholder="Qty" onChange={(e) => set(`qty${n}`, e.target.value)} />
                    <Input className="col-span-2" type="number" placeholder="Unit cost" onChange={(e) => set(`cost${n}`, e.target.value)} />
                  </div>
                ))}
                <Field label="Justification"><Textarea rows={2} onChange={(e) => set("justification", e.target.value)} /></Field>
              </>
            )}
          </FormDialog>
        </Can>
      </div>
      <div className="space-y-2">
        {requests.map((r) => (
          <Card key={r._id}>
            <CardContent className="pt-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{r.requestNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.supplier ?? "No supplier"} · {r.department ?? "No department"} · by {r.requestedBy}
                    {r.neededBy ? ` · needed by ${r.neededBy}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">{money(r.estimatedTotal)}</span>
                  <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                </div>
              </div>
              <div className="mt-2 space-y-0.5 text-sm">
                {r.items.map((i, idx) => (
                  <div key={idx} className="flex justify-between text-xs text-muted-foreground">
                    <span>{i.description} × {i.quantity}</span>
                    <span className="tabular-nums">{money(i.quantity * i.unitCost)}</span>
                  </div>
                ))}
              </div>
              {r.justification ? <p className="mt-1 text-xs italic text-muted-foreground">"{r.justification}"</p> : null}
              {r.status === "submitted" ? (
                <Can permission="procurement.manage">
                  <div className="mt-2 flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={async () => {
                      await decide({ requestId: r._id as never, decision: "approved" });
                      toast.success("Request approved");
                    }}><Check className="h-4 w-4" />Approve</Button>
                    <Button size="sm" variant="outline" onClick={async () => {
                      await decide({ requestId: r._id as never, decision: "rejected", decisionNote: "Rejected" });
                      toast.success("Request rejected");
                    }}><X className="h-4 w-4" />Reject</Button>
                  </div>
                </Can>
              ) : null}
              {r.status === "approved" ? (
                <Can permission="procurement.manage">
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" onClick={async () => {
                      await createOrder({ requestId: r._id as never });
                      toast.success("Purchase order raised");
                    }}>Raise purchase order</Button>
                  </div>
                </Can>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">No purchase requests yet.</p> : null}
      </div>
    </div>
  );
}

/* ================================================================== */

function OrdersTab({ orders }: { orders: Array<{ _id: string; orderNumber: string; requestNumber: string; supplier: string | null; total: number; orderDate: string; status: string }> }) {
  const receive = useMutation(api.procurement.receivePurchaseOrder);
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead className="hidden sm:table-cell">Supplier</TableHead>
            <TableHead className="hidden md:table-cell">Date</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o._id}>
              <TableCell className="font-medium">{o.orderNumber}<span className="block text-xs text-muted-foreground">from {o.requestNumber}</span></TableCell>
              <TableCell className="hidden sm:table-cell">{o.supplier ?? "—"}</TableCell>
              <TableCell className="hidden md:table-cell text-xs">{o.orderDate}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{money(o.total)}</TableCell>
              <TableCell><Pill tone={statusTone(o.status)}>{o.status}</Pill></TableCell>
              <TableCell className="text-right">
                {o.status === "submitted" ? (
                  <Can permission="procurement.manage">
                    <Button size="sm" variant="outline" onClick={async () => {
                      await receive({ orderId: o._id as never });
                      toast.success("Goods received — expense posted to the ledger");
                    }}><PackageCheck className="h-4 w-4" />Receive</Button>
                  </Can>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
          {orders.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No purchase orders yet.</TableCell></TableRow> : null}
        </TableBody>
      </Table>
    </Card>
  );
}

/* ================================================================== */

function SuppliersTab({ suppliers }: { suppliers: Array<{ _id: string; name: string; contactPerson: string | null; phone: string | null; category: string | null; status: string; orderCount: number }> }) {
  const createSupplier = useMutation(api.procurement.createSupplier);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="procurement.manage">
          <FormDialog
            title="New supplier"
            trigger={<Button size="sm"><Plus />New supplier</Button>}
            onSubmit={async (data) => {
              await createSupplier({
                name: data.name, contactPerson: data.contactPerson || undefined,
                phone: data.phone || undefined, email: data.email || undefined,
                category: data.category || undefined,
              });
              toast.success("Supplier added");
            }}
          >
            {(set) => (
              <>
                <Field label="Name"><Input onChange={(e) => set("name", e.target.value)} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Contact person"><Input onChange={(e) => set("contactPerson", e.target.value)} /></Field>
                  <Field label="Phone"><Input onChange={(e) => set("phone", e.target.value)} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email"><Input type="email" onChange={(e) => set("email", e.target.value)} /></Field>
                  <Field label="Category"><Input onChange={(e) => set("category", e.target.value)} placeholder="Stationery / Food / Fuel" /></Field>
                </div>
              </>
            )}
          </FormDialog>
        </Can>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead className="hidden sm:table-cell">Contact</TableHead>
              <TableHead className="hidden md:table-cell">Category</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.map((s) => (
              <TableRow key={s._id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="hidden sm:table-cell text-xs">{s.contactPerson ?? "—"}{s.phone ? ` · ${s.phone}` : ""}</TableCell>
                <TableCell className="hidden md:table-cell">{s.category ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{s.orderCount}</TableCell>
                <TableCell><Pill tone={statusTone(s.status)}>{s.status}</Pill></TableCell>
              </TableRow>
            ))}
            {suppliers.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No suppliers yet.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
