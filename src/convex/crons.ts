import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Phase 6 automation schedulers (executed by the Convex platform, not manually):
// - Overdue invoices        → invoice_overdue automation trigger (daily 08:00 UTC)
// - Overdue library loans   → library_overdue trigger + status refresh (daily 08:05 UTC)
// - Expiring HR contracts   → contract_nearing_expiry trigger (daily 08:10 UTC)
// - Low stock               → stock_below_threshold trigger (daily 08:15 UTC)
// - GPS ping retention      → prune pings older than 30 days (daily 02:00 UTC)
// Jobs are idempotent: automation dispatch is de-duplicated to once per
// 7-day window per target (phase6/scheduled.ts fireOncePerWeek).
crons.daily(
  "detect overdue invoices and fire invoice_overdue automations",
  { hourUTC: 8, minuteUTC: 0 },
  internal.phase6.scheduled.detectOverdueInvoices,
);
crons.daily(
  "refresh overdue library loans and fire library_overdue automations",
  { hourUTC: 8, minuteUTC: 5 },
  internal.phase6.scheduled.refreshLibraryOverdue,
);
crons.daily(
  "notify about contracts nearing expiry",
  { hourUTC: 8, minuteUTC: 10 },
  internal.phase6.scheduled.notifyExpiringContracts,
);
crons.daily(
  "emit stock_below_threshold alerts",
  { hourUTC: 8, minuteUTC: 15 },
  internal.phase6.scheduled.emitStockAlerts,
);
crons.daily(
  "prune GPS pings older than the retention window",
  { hourUTC: 2, minuteUTC: 0 },
  internal.phase6.identity.pruneOldPingsInternal,
);

export default crons;
