import { BedDouble } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Minimal, read-only information - allocated dorm and bed, not student roster. */
export function BoardingStatusCard({ boarding }: {
  boarding: {
    status: "assigned" | "day" | "not_assigned";
    hostel: string | null;
    room: string | null;
    bed: string | null;
  } | undefined;
}) {
  if (boarding === undefined) return null;
  const description = boarding.status === "assigned"
    ? [boarding.hostel, boarding.room && `Room ${boarding.room}`, boarding.bed && `Bed ${boarding.bed}`]
        .filter(Boolean).join(" · ")
    : boarding.status === "day" ? "Day student - No dormitory assigned" : "Dormitory assignment pending";

  return (
    <Card className="mt-4">
      <CardContent className="flex items-center gap-3 p-4">
        <BedDouble className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">Boarding & dormitory</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
