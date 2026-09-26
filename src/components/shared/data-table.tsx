import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Inbox, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaginationState {
  page: number;
  numItems: number;
}

export function DataTable<T extends { _id?: string }>({
  columns,
  rows,
  loading,
  error,
  empty,
  page,
  pageSize,
  onPageChange,
  hasNextPage,
}: {
  columns: { key: string; header: string; className?: string }[];
  rows: T[] | undefined;
  loading: boolean;
  error?: string | null;
  empty: React.ReactNode;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  hasNextPage?: boolean;
}) {
  const cols = columns.length;
  if (loading) {
    return (
      <div className="card-soft overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.className}>{c.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: cols }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full max-w-[160px]" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card-soft flex flex-col items-center gap-2 px-6 py-12 text-center">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm font-medium">Something went wrong</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }
  const isEmpty = !rows || rows.length === 0;
  return (
    <div className="card-soft overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.className}>{c.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isEmpty ? (
              <TableRow>
                <TableCell colSpan={cols} className="h-40">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <Inbox className="size-8 text-muted-foreground/60" />
                    {empty}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => (
                <TableRow key={(row._id as string) ?? idx}>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={cn(c.className)}>
                      {(row as Record<string, React.ReactNode>)[c.key] ?? null}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {(hasNextPage || (page ?? 0) > 0) && (
        <div className="flex items-center justify-between border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} · {pageSize} rows per page
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => onPageChange(page + 1)}>
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
