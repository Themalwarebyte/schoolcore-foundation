import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TermSelect, ScopeBar } from "@/components/ops/Controls";
import { TrendingUp, Banknote, AlertTriangle, Receipt, Scale } from "lucide-react";

export default function Reports() {
  const [termId, setTermId] = useState("");
  const [from, setFrom] = useState("2026-01-01");
  const [to, setTo] = useState("2026-12-31");

  const revenue = useQuery(api.financeOps.revenueReport, termId ? { termId: termId as never } : {});
  const paymentsReport = useQuery(api.financeOps.paymentsReport, { from, to });
  const outstanding = useQuery(api.financeOps.outstandingReport, {});
  const expenseReport = useQuery(api.financeOps.expenseReport, { from, to });
  const cash = useQuery(api.financeOps.cashSummary, { from, to });
  const trial = useQuery(api.financeOps.trialBalance, {});

  return (
    <div className="page-shell">
      <PageHeader
        title="Financial Reports"
        description="Totals reconcile directly against invoices, payments, discounts, expenses and ledger entries."
      />

      <ScopeBar>
        <div>
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
        </div>
        <TermSelect yearId="" termId={termId} onChange={setTermId} className="self-end" />
      </ScopeBar>

      <Tabs defaultValue="revenue">
        <TabsList className="flex-wrap">
          <TabsTrigger value="revenue"><TrendingUp className="mr-1.5 size-3.5" /> Revenue</TabsTrigger>
          <TabsTrigger value="payments"><Banknote className="mr-1.5 size-3.5" /> Payments</TabsTrigger>
          <TabsTrigger value="outstanding"><AlertTriangle className="mr-1.5 size-3.5" /> Outstanding</TabsTrigger>
          <TabsTrigger value="expenses"><Receipt className="mr-1.5 size-3.5" /> Expenses</TabsTrigger>
          <TabsTrigger value="cash"><Scale className="mr-1.5 size-3.5" /> Cash summary</TabsTrigger>
          <TabsTrigger value="trial">Trial balance</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Revenue {termId ? "(selected term)" : "(all terms)"}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Billed", revenue?.billed],
                  ["Collected", revenue?.collected],
                  ["Discounted", revenue?.discounted],
                  ["Outstanding", revenue?.outstanding],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-semibold">{typeof value === "number" ? value.toLocaleString() : "—"}</p>
                  </div>
                ))}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(revenue?.byStatus ?? []).map((r) => (
                    <TableRow key={r.status}>
                      <TableCell className="capitalize">{r.status.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right font-semibold">{r.amount.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Payments {from} → {to}
                {paymentsReport && <span className="ml-2 text-sm font-normal text-muted-foreground">{paymentsReport.count} payments · {paymentsReport.total.toLocaleString()}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">By method</p>
                <Table>
                  <TableHeader><TableRow><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(paymentsReport?.byMethod ?? []).map((r) => (
                      <TableRow key={r.method}><TableCell>{r.method}</TableCell><TableCell className="text-right font-semibold">{r.amount.toLocaleString()}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="overflow-x-auto">
                <p className="mb-2 text-sm font-medium">Recent payments</p>
                <Table>
                  <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(paymentsReport?.recent ?? []).slice(0, 15).map((r) => (
                      <TableRow key={r.paymentNumber}>
                        <TableCell className="font-mono text-xs">{r.paymentNumber}</TableCell>
                        <TableCell>{r.paymentDate}</TableCell>
                        <TableCell className="text-right">{r.amount.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outstanding" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Outstanding fees
                {outstanding && <span className="ml-2 text-sm font-normal text-muted-foreground">{outstanding.studentsWithBalance} students · {outstanding.totalOutstanding.toLocaleString()}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Admission</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(outstanding?.rows ?? []).slice(0, 50).map((r) => (
                    <TableRow key={r.studentId}>
                      <TableCell className="font-medium">{r.studentName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.admissionNumber}</TableCell>
                      <TableCell className="text-right font-semibold">{r.balance.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Expenses {from} → {to}
                {expenseReport && <span className="ml-2 text-sm font-normal text-muted-foreground">{expenseReport.count} expenses · {expenseReport.total.toLocaleString()}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(expenseReport?.byCategory ?? []).map((r) => (
                    <TableRow key={r.category}><TableCell className="font-medium">{r.category}</TableCell><TableCell className="text-right font-semibold">{r.amount.toLocaleString()}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cash" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Cash summary {from} → {to}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Money received</p><p className="text-lg font-semibold">{cash?.received.toLocaleString() ?? "—"}</p></div>
                <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Expenses paid</p><p className="text-lg font-semibold">{cash?.spent.toLocaleString() ?? "—"}</p></div>
                <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Net cash</p><p className="text-lg font-semibold">{cash?.balance.toLocaleString() ?? "—"}</p></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trial" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Trial balance
                {trial && (
                  <span className={`ml-2 text-sm font-normal ${trial.balanced ? "text-emerald-600" : "text-destructive"}`}>
                    {trial.balanced ? "balanced" : "IMBALANCE"} · D {trial.totalDebit.toLocaleString()} / C {trial.totalCredit.toLocaleString()}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(trial?.rows ?? []).map((r) => (
                    <TableRow key={r.code}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{r.accountType}</TableCell>
                      <TableCell className="text-right">{r.debit ? r.debit.toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-right">{r.credit ? r.credit.toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
