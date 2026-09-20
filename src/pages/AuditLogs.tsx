import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, History } from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 25;

const ACTION_TONE: Record<string, string> = {
  created: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  updated: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  deleted: "bg-red-500/10 text-red-600 dark:text-red-400",
  logged_in: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

export default function AuditLogs() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  const logs = useQuery(api.auditLogs.list, {
    search: search || undefined,
    paginationOpts: { numItems: PAGE_SIZE, cursor: page === 0 ? null : String(page) },
  });

  const rows = logs?.page.map((l) => ({
    time: <span className="text-xs text-muted-foreground tabular-nums">{format(l.createdAt, "dd MMM yyyy, HH:mm")}</span>,
    user: <span className="text-sm">{l.userName ?? "System"}</span>,
    action: (
      <Badge variant="outline" className={`border-transparent font-medium capitalize ${ACTION_TONE[l.action] ?? "bg-muted"}`}>
        {l.action.replaceAll("_", " ")}
      </Badge>
    ),
    entity: (
      <div className="text-sm">
        <span className="capitalize">{l.entityType}</span>
        <span className="ml-2 font-mono text-xs text-muted-foreground">{l.entityLabel ?? l.entityId.slice(-8)}</span>
      </div>
    ),
    detail: <span className="text-xs text-muted-foreground line-clamp-2">{l.description ?? "—"}</span>,
  }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Audit logs"
        description="A permanent, read-only record of every important action in your school."
      />

      <div className="mb-4 max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by user, action or entity…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <DataTable
        columns={[
          { key: "time", header: "Time" },
          { key: "user", header: "User" },
          { key: "action", header: "Action" },
          { key: "entity", header: "Entity" },
          { key: "detail", header: "Details" },
        ]}
        rows={rows}
        loading={logs === undefined}
        empty={
          <>
            <History className="size-10 text-muted-foreground/30" />
            <p className="text-sm font-medium">No audit entries</p>
            <p className="text-xs text-muted-foreground">Actions taken in the system will appear here.</p>
          </>
        }
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        hasNextPage={(logs?.page.length ?? 0) === PAGE_SIZE}
      />
    </div>
  );
}
