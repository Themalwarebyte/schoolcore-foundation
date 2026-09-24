import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Boxes, Package, TrendingDown, Plus } from "lucide-react";
import { Pill, statusTone, FormDialog, Field, EmptyState } from "@/components/ops/shared";

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function InventoryPage() {
  const dash = useQuery(api.inventory.inventoryDashboard, {});
  const [tab, setTab] = useState<"assets" | "stock">("assets");
  const assets = useQuery(api.inventory.listAssets, { search: "" });
  const items = useQuery(api.inventory.listItems, { search: "" });

  return (
    <div>
      <PageHeader title="Inventory & Assets" description="Asset register, consumables and stock movements." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Assets" value={dash?.totalAssets ?? "—"} icon={Boxes} />
        <MiniStat label="Asset value" value={money(dash?.assetValue ?? 0)} icon={Boxes} />
        <MiniStat label="Items" value={dash?.itemCount ?? "—"} icon={Package} />
        <MiniStat label="Low stock" value={dash?.lowStockItems ?? "—"} icon={TrendingDown} tone={dash?.lowStockItems ? "warn" : "good"} />
      </div>

      <div className="mb-3 flex gap-1 rounded-lg border p-1 text-sm w-fit">
        {(["assets", "stock"] as const).map((t) => (
          <button
            key={t}
            className={`rounded-md px-3 py-1.5 capitalize transition ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "assets" ? <AssetsTab assets={assets ?? []} /> : <StockTab items={items ?? []} />}
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

function AssetsTab({ assets }: { assets: Array<{ _id: string; assetNumber: string; name: string; category: string; purchaseDate: string | null; purchaseValue: number | null; location: string | null; condition: string; custodian: string | null; status: string }> }) {
  const createAsset = useMutation(api.inventory.createAsset);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="inventory.manage">
          <FormDialog
            title="Register asset"
            trigger={<Button size="sm"><Plus />New asset</Button>}
            onSubmit={async (data) => {
              await createAsset({
                name: data.name, category: data.category,
                purchaseDate: data.purchaseDate || undefined,
                purchaseValue: data.purchaseValue ? Number(data.purchaseValue) : undefined,
                location: data.location || undefined,
                condition: data.condition || undefined,
              });
              toast.success("Asset registered");
            }}
          >
            {(set) => (
              <>
                <Field label="Name"><Input onChange={(e) => set("name", e.target.value)} placeholder="e.g. Desktop computer" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Category"><Input onChange={(e) => set("category", e.target.value)} placeholder="IT / Furniture / Lab" /></Field>
                  <Field label="Condition">
                    <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("condition", e.target.value)} defaultValue="new">
                      {["new", "good", "fair", "poor"].map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Purchase date"><Input type="date" onChange={(e) => set("purchaseDate", e.target.value)} /></Field>
                  <Field label="Value"><Input type="number" onChange={(e) => set("purchaseValue", e.target.value)} /></Field>
                </div>
                <Field label="Location"><Input onChange={(e) => set("location", e.target.value)} placeholder="e.g. Computer lab" /></Field>
              </>
            )}
          </FormDialog>
        </Can>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead className="hidden sm:table-cell">Category</TableHead>
              <TableHead className="hidden md:table-cell">Location</TableHead>
              <TableHead className="hidden lg:table-cell">Custodian</TableHead>
              <TableHead>Condition</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.map((a) => (
              <TableRow key={a._id}>
                <TableCell className="font-medium">
                  {a.name}
                  <span className="block font-mono text-xs text-muted-foreground">{a.assetNumber}</span>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{a.category}</TableCell>
                <TableCell className="hidden md:table-cell">{a.location ?? "—"}</TableCell>
                <TableCell className="hidden lg:table-cell">{a.custodian ?? "—"}</TableCell>
                <TableCell><Pill tone={statusTone(a.condition)}>{a.condition}</Pill></TableCell>
              </TableRow>
            ))}
            {assets.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No assets registered yet.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

/* ================================================================== */

function StockTab({ items }: { items: Array<{ _id: string; name: string; category: string; unit: string; quantity: number; reorderLevel: number; lowStock: boolean }> }) {
  const createItem = useMutation(api.inventory.createItem);
  const recordMovement = useMutation(api.inventory.recordMovement);
  const [selected, setSelected] = useState<string | null>(null);
  const movements = useQuery(api.inventory.listMovements, selected ? { itemId: selected as never } : "skip");

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can permission="inventory.manage">
          <FormDialog
            title="New inventory item"
            trigger={<Button size="sm"><Plus />New item</Button>}
            onSubmit={async (data) => {
              await createItem({
                name: data.name, category: data.category, unit: data.unit,
                quantity: Number(data.quantity || "0"), reorderLevel: Number(data.reorderLevel || "0"),
                unitCost: data.unitCost ? Number(data.unitCost) : undefined,
              });
              toast.success("Item created");
            }}
          >
            {(set) => (
              <>
                <Field label="Name"><Input onChange={(e) => set("name", e.target.value)} placeholder="e.g. Chalk boxes" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Category"><Input onChange={(e) => set("category", e.target.value)} placeholder="Stationery" /></Field>
                  <Field label="Unit"><Input onChange={(e) => set("unit", e.target.value)} placeholder="boxes" /></Field>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Opening qty"><Input type="number" onChange={(e) => set("quantity", e.target.value)} /></Field>
                  <Field label="Reorder at"><Input type="number" onChange={(e) => set("reorderLevel", e.target.value)} /></Field>
                  <Field label="Unit cost"><Input type="number" onChange={(e) => set("unitCost", e.target.value)} /></Field>
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
              <TableHead>Item</TableHead>
              <TableHead className="hidden sm:table-cell">Category</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="hidden md:table-cell text-right">Reorder at</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i._id} className={i.lowStock ? "bg-amber-50/50 dark:bg-amber-950/20" : undefined}>
                <TableCell className="font-medium">
                  {i.name}
                  {i.lowStock ? <Pill tone="amber">low</Pill> : null}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{i.category}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{i.quantity} <span className="text-xs font-normal text-muted-foreground">{i.unit}</span></TableCell>
                <TableCell className="hidden md:table-cell text-right tabular-nums text-muted-foreground">{i.reorderLevel}</TableCell>
                <TableCell className="text-right">
                  <Can permission="inventory.manage">
                    <Button size="sm" variant="outline" onClick={() => setSelected(selected === i._id ? null : i._id)}>Movements</Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No items yet.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Card>

      {selected ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Stock movements</CardTitle>
              <MovementButtons
                itemId={selected}
                onRecord={recordMovement}
              />
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="hidden sm:table-cell">Reference</TableHead>
                  <TableHead className="hidden md:table-cell">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(movements ?? []).map((m) => (
                  <TableRow key={m._id}>
                    <TableCell><Pill tone={m.movementType === "received" || m.movementType === "return" ? "green" : "amber"}>{m.movementType}</Pill></TableCell>
                    <TableCell className="text-right tabular-nums">{m.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{m.balanceAfter}</TableCell>
                    <TableCell className="hidden sm:table-cell text-xs">{m.reference ?? m.issuedTo ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{m.createdByName ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {movements && movements.length === 0 ? (
                  <TableRow><TableCell colSpan={5}><EmptyState icon={Package} title="No movements recorded yet" /></TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MovementButtons({ itemId, onRecord }: { itemId: string; onRecord: ReturnType<typeof useMutation<typeof api.inventory.recordMovement>> }) {
  return (
    <div className="flex gap-1">
      {(["received", "issued", "return", "adjustment"] as const).map((t) => (
        <Button
          key={t}
          size="sm"
          variant="outline"
          className="capitalize"
          onClick={async () => {
            const qty = window.prompt(`Quantity to ${t}:`);
            if (!qty) return;
            try {
              await onRecord({ itemId: itemId as never, movementType: t, quantity: Number(qty) });
              toast.success(`Stock ${t} recorded`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Movement failed");
            }
          }}
        >
          {t}
        </Button>
      ))}
    </div>
  );
}
