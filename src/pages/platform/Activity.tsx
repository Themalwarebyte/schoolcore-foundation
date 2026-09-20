import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PageHeader } from "@/components/layouts/platform-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollText } from "lucide-react";
import { formatDateTime } from "@/lib/status";

const PAGE_SIZE = 30;

const TONE: Record<string, string> = {
  created: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  linked: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  updated: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  set_current: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  archived: "bg-red-500/10 text-red-700 dark:text-red-400",
  disabled: "bg-red-500/10 text-red-700 dark:text-red-400",
};

function toneFor(action: string): string {
  return TONE[action.split(".").pop() ?? ""] ?? "bg-muted text-muted-foreground";
}

export default function PlatformActivity() {
  const [limit, setLimit] = useState("100");

  const activity = useQuery(api.platform.platformActivity, { limit: Number(limit) });
  const total = useQuery(api.platform.platformAuditCount);

  const rows = activity?.map((a) => ({
    _id: a._id,
    time: <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">{formatDateTime(a._creationTime)}</span>,
    school: <Badge variant="outline">{a.schoolName}</Badge>,
    user: <span className="text-sm">{a.userName}</span>,
    action: (
      <Badge variant="outline" className={`border-transparent font-medium ${toneFor(a.action)}`}>
        {a.action}
      </Badge>
    ),
    entity: <span className="text-sm capitalize">{a.entityType.replace(/([A-Z])/g, " $1").trim()}</span>,
    detail: <span className="text-xs text-muted-foreground">{a.description || "—"}</span>,
  }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Audit / activity"
        description={
          total === undefined
            ? "Everything happening across the platform."
            : `${total.toLocaleString()} recorded events across all schools.`
        }
        actions={
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="50">Last 50</SelectItem>
              <SelectItem value="100">Last 100</SelectItem>
              <SelectItem value="250">Last 250</SelectItem>
              <SelectItem value="500">Last 500</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <DataTable
        columns={[
          { key: "time", header: "Time" },
          { key: "school", header: "School" },
          { key: "user", header: "User" },
          { key: "action", header: "Action" },
          { key: "entity", header: "Entity" },
          { key: "detail", header: "Details" },
        ]}
        rows={rows}
        loading={activity === undefined}
        empty={
          <>
            <ScrollText className="size-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">No activity yet</p>
            <p className="text-xs text-muted-foreground">Actions from all schools will appear here.</p>
          </>
        }
        page={0}
        pageSize={PAGE_SIZE}
        onPageChange={() => undefined}
        hasNextPage={false}
      />
    </div>
  );
}
