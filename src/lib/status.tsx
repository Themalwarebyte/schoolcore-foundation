import { Badge } from "@/components/ui/badge";

export const STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Active", variant: "default" },
  inactive: { label: "Inactive", variant: "secondary" },
  graduated: { label: "Graduated", variant: "outline" },
  transferred: { label: "Transferred", variant: "outline" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
  archived: { label: "Archived", variant: "destructive" },
  on_leave: { label: "On Leave", variant: "secondary" },
  suspended: { label: "Suspended", variant: "destructive" },
  terminated: { label: "Terminated", variant: "destructive" },
  retired: { label: "Retired", variant: "outline" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={meta.variant} className="capitalize">{meta.label}</Badge>;
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
