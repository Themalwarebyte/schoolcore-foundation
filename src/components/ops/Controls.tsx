import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function YearSelect({
  yearId, onChange, className,
}: { yearId: string; onChange: (v: string) => void; className?: string }) {
  const years = useQuery(api.academics.listYears);
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">Academic year</Label>
      <Select value={yearId} onValueChange={onChange}>
        <SelectTrigger className="mt-1 bg-background"><SelectValue placeholder="Select year" /></SelectTrigger>
        <SelectContent>
          {years?.map((y) => (
            <SelectItem key={y._id} value={y._id}>
              {y.name}{y.isCurrent ? " (current)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function TermSelect({
  yearId, termId, onChange, className, allowAll = false,
}: {
  yearId: string; termId: string; onChange: (v: string) => void;
  className?: string; allowAll?: boolean;
}) {
  const terms = useQuery(
    api.academics.listTerms,
    yearId ? { academicYearId: yearId as never } : "skip",
  );
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">Term</Label>
      <Select value={termId} onValueChange={onChange}>
        <SelectTrigger className="mt-1 bg-background">
          <SelectValue placeholder={terms === undefined ? "Loading…" : "Select term"} />
        </SelectTrigger>
        <SelectContent>
          {allowAll && <SelectItem value="all">All terms</SelectItem>}
          {terms?.map((t) => (
            <SelectItem key={t._id} value={t._id}>
              {t.name}{t.isCurrent ? " (current)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ClassSelect({
  yearId, classSectionId, onChange, className, allowAll = false,
}: {
  yearId: string; classSectionId: string; onChange: (v: string) => void;
  className?: string; allowAll?: boolean;
}) {
  const sections = useQuery(
    api.academics.listClassSections,
    yearId ? { academicYearId: yearId as never } : "skip",
  );
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">Class</Label>
      <Select value={classSectionId} onValueChange={onChange}>
        <SelectTrigger className="mt-1 bg-background">
          <SelectValue placeholder={sections === undefined ? "Loading…" : "Select class"} />
        </SelectTrigger>
        <SelectContent>
          {allowAll && <SelectItem value="all">All classes</SelectItem>}
          {sections?.map((c) => (
            <SelectItem key={c._id} value={c._id}>
              {c.gradeName} {c.streamName} · {c.enrolledCount} enrolled
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SubjectSelect({
  yearId, classSectionId, subjectId, onChange, className, allowAll = false,
}: {
  yearId: string; classSectionId: string; subjectId: string;
  onChange: (v: string) => void; className?: string; allowAll?: boolean;
}) {
  const options = useQuery(
    api.assignments.myAllocationOptions,
    yearId ? { academicYearId: yearId as never } : "skip",
  );
  const rows = (options ?? [])
    .filter((o) => !classSectionId || o.classSectionId === classSectionId)
    .filter((o, i, arr) => arr.findIndex((x) => x.subjectId === o.subjectId) === i);
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">Subject</Label>
      <Select value={subjectId} onValueChange={onChange}>
        <SelectTrigger className="mt-1 bg-background">
          <SelectValue placeholder={options === undefined ? "Loading…" : "Select subject"} />
        </SelectTrigger>
        <SelectContent>
          {allowAll && <SelectItem value="all">All subjects</SelectItem>}
          {rows.map((o) => (
            <SelectItem key={o.subjectId} value={o.subjectId}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Compact toolbar layout for the scope selectors. */
export function ScopeBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}
