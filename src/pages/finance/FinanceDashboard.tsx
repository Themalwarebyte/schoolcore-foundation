import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Landmark, Wallet, AlertTriangle, Percent, CalendarClock, ClipboardCheck, ArrowRight } from "lucide-react";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

export default function FinanceDashboard() {
  const data = useQuery(api.financeOps.dashboard, {});
  const readiness = useQuery(api.feeStructures.readiness, {});
  const trial = useQuery(api.financeOps.trialBalance, {});

  const metrics = [
    { label: "Total billed", value: data?.totalBilled, icon: Landmark, to: "/finance/invoices" },
    { label: "Total collected", value: data?.totalCollected, icon: Wallet, to: "/finance/payments" },
    { label: "Outstanding fees", value: data?.outstanding, icon: AlertTriangle, to: "/finance/accounts" },
    { label: "Collection rate", value: data ? `${data.collectionRate}%` : undefined, icon: Percent, to: "/finance/reports" },
    { label: "Today's payments", value: data?.todayPayments, icon: CalendarClock, to: "/finance/payments" },
    { label: "Pending approvals", value: data?.pendingApprovals, icon: ClipboardCheck, to: "/finance/expenses" },
  ];

  return (
    <div className="page-shell">
      <PageHeader
        title="Finance Dashboard"
        description="Every figure is computed live from invoices, payments and the financial ledger."
        actions={
          <Can permission="billing.create">
            <Link to="/finance/fees" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Billing runs <ArrowRight className="size-4" />
            </Link>
          </Can>
        }
      />

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map((m) => (
          <Link key={m.label} to={m.to} className="card-soft group p-4 transition-shadow hover:shadow-md">
            <div className="flex items-center justify-between">
              <m.icon className="size-4 text-muted-foreground" />
              <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
            </div>
            <p className="mt-2 text-xl font-semibold tracking-tight">
              {m.value === undefined ? "—" : typeof m.value === "number" ? m.value.toLocaleString() : m.value}
            </p>
            <p className="text-xs text-muted-foreground">{m.label}</p>
          </Link>
        ))}
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Collection trend (6 months)</CardTitle></CardHeader>
          <CardContent className="h-64">
            {data && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <ReTooltip formatter={(v: number) => v.toLocaleString()} />
                  <Bar dataKey="collected" fill="var(--chart-2)" radius={[4, 4, 0, 0]} name="Collected" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Billed by fee category</CardTitle></CardHeader>
          <CardContent className="h-64">
            {data && data.categories.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.categories} dataKey="amount" nameKey="category" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {data.categories.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReTooltip formatter={(v: number) => v.toLocaleString()} />
                </PieChart>
              </ResponsiveContainer>
            )}
            {data && data.categories.length === 0 && (
              <p className="pt-8 text-center text-sm text-muted-foreground">No invoiced categories yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status + ledger + readiness */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Invoice status</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data && Object.entries(data.counts).map(([key, count]) => (
              <div key={key} className="flex items-center justify-between border-b pb-1.5 last:border-0">
                <span className="capitalize text-muted-foreground">{key.replace(/_/g, " ")}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Ledger integrity</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {trial && (
              <>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Total debits</span><span className="font-semibold">{trial.totalDebit.toLocaleString()}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Total credits</span><span className="font-semibold">{trial.totalCredit.toLocaleString()}</span></div>
                <div className={`mt-2 rounded-md p-2 text-center text-xs font-medium ${trial.balanced ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive"}`}>
                  {trial.balanced ? "✓ Books balanced — debits equal credits" : "⚠ IMBALANCE DETECTED — investigate"}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Billing pending</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(readiness ?? []).map((r) => (
              <div key={r._id} className="flex items-center justify-between text-sm">
                <span>{r.name}</span>
                <Link to="/finance/fees" className="font-semibold hover:underline">{r.pending} pending</Link>
              </div>
            ))}
            {readiness && readiness.length === 0 && (
              <p className="text-sm text-muted-foreground">All enrolled students are billed.</p>
            )}
            {data && data.expensesThisMonth !== undefined && (
              <div className="mt-3 border-t pt-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Expenses this month</span>
                  <span className="font-semibold">{data.expensesThisMonth.toLocaleString()}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link to="/finance/reports">Financial reports</Link></Button>
        <Button asChild variant="outline" size="sm"><Link to="/finance/accounts">Student accounts</Link></Button>
        <Button asChild variant="outline" size="sm"><Link to="/finance/discounts">Discounts & scholarships</Link></Button>
        <Button asChild variant="outline" size="sm"><Link to="/finance/expenses">Expenses</Link></Button>
      </div>
    </div>
  );
}
