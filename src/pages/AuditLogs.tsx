import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { History } from "lucide-react";
import { formatDateTime } from "@/lib/status";

const PAGE_SIZE = 25;

const ACTION_FILTERS = [
  { value: "all", label: "All actions" },
  { value: "student.created", label: "Student created" },
  { value: "student.updated", label: "Student updated" },
  { value: "student.archived", label: "Student archived" },
  { value: "guardian.created", label: "Guardian created" },
  { value: "guardian.linked", label: "Guardian linked" },
  { value: "staff.created", label: "Staff created" },
  { value: "academic_year.created", label: "Year created" },
  { value: "term.created", label: "Term created" },
  { value: "class_section.created", label: "Class created" },
  { value: "subject.created", label: "Subject created" },
  { value: "teacher_allocation.created", label: "Allocation created" },
  { value: "user.created", label: "User created" },
  { value: "user.role_changed", label: "Role changed" },
  { value: "school.settings_updated", label: "Settings changed" },
];

const ACTION_TONE: Record<string, string> = {
  created: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  linked: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  updated: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  set_current: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  archived: "bg-red-500/10 text-red-700 dark:text-red-400",
  disabled: "bg-red-500/10 text-red-700 dark:text-red-400",
  unlinked: "bg-red-500/10 text-red-700 dark:text-red-400",
  removed: "bg-red-500/10 text-red-700 dark:text-red-400",
  ended: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

function toneFor(action: string): string {
  const suffix = action.split(".").pop() ?? "";
  return ACTION_TONE[suffix] ?? "bg-muted text-muted-foreground";
}

export default function AuditLogs() {
  const [page, setPage] = useState(0);
  const [action, setAction] = useState("all");

  const logs = useQuery(api.auditLogs.list, {
    action,
    paginationOpts: { numItems: PAGE_SIZE, cursor: page === 0 ? null : String(page) },
  });

  const rows = logs?.page.map((l) => ({
    _id: l._id,
    time: <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">{formatDateTime(l._creationTime)}</span>,
    user: <span className="text-sm">{l.userName}</span>,
    action: (
      <Badge variant="outline" className={`border-transparent font-medium ${toneFor(l.action)}`}>
        {l.action.split(".").slice(0, 2).join(".")}
      </Badge>
    ),
    entity: <span className="text-sm capitalize">{l.entityType.replace(/([A-Z])/g, " $1").trim()}</span>,
    detail: <span className="text-xs text-muted-foreground">{l.description || "—"}</span>,
  }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Audit logs"
        description="A permanent, read-only record of every important action in your school."
      />

      <div className="mb-4 max-w-xs">
        <Select value={action} onValueChange={(v) => { setAction(v); setPage(0); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACTION_FILTERS.map((a) => (
              <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            <History className="size-8 text-muted-foreground/60" />
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
