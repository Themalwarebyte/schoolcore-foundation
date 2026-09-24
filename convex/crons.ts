import { cronJobs } from "convex/server";
import internal from "./_generated/server";

const crons = cronJobs();

// Hourly sweeps — idempotent, cheap, deduplicated by event checks.
crons.hourly(
  "detect overdue invoices",
  { minuteUTC: 5 },
  internal.phase6.scheduled.detectOverdueInvoices,
);
crons.hourly(
  "refresh overdue library loans",
  { minuteUTC: 10 },
  internal.phase6.scheduled.refreshLibraryOverdue,
);
crons.daily(
  "notify expiring contracts",
  { hourUTC: 2, minuteUTC: 0 },
  internal.phase6.scheduled.notifyExpiringContracts,
);
crons.daily(
  "emit stock alerts",
  { hourUTC: 2, minuteUTC: 15 },
  internal.phase6.scheduled.emitStockAlerts,
);

export default crons;
