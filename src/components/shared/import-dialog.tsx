import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileWarning, Upload, CheckCircle2 } from "lucide-react";

/**
 * CSV import for students/staff using the Phase 7 import engine
 * (previewImport7 / confirmImport7): server-side validation with a
 * per-row error report, then an all-or-nothing commit. Importing
 * students marks the onboarding "import" step complete.
 */
export function ImportStudentsDialog({
  open, onOpenChange, hasCurrentYear, onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hasCurrentYear: boolean;
  onImported?: () => void;
}) {
  const [entity, setEntity] = useState<"students" | "staff">("students");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = useQuery(
    api.phase7.imports.previewImport7,
    rows.length > 0 ? { entity, rows: rows as never } : "skip",
  );

  const confirmImport = useMutation(api.phase7.imports.confirmImport7);
  const markImportDone = useMutation(api.phase7.onboarding.markImportDone);

  const reset = () => {
    setRows([]);
    setFilename("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const parseCsv = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const split = (line: string) =>
      line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const headers = split(lines[0]).map((h) => h.toLowerCase());
    return lines.slice(1).map((line) => {
      const cells = split(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
      return row;
    });
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => setRows(parseCsv(String(reader.result ?? "")));
    reader.readAsText(file);
  };

  const requiredColumns = useMemo(
    () =>
      entity === "students"
        ? ["admissionnumber", "firstname", "lastname", "guardianname", "guardianphone"]
        : ["employeenumber", "firstname", "lastname"],
    [entity],
  );

  const missingColumns =
    rows.length > 0
      ? requiredColumns.filter((c) => !rows.some((r) => Object.keys(r).some((k) => k.toLowerCase() === c)))
      : [];

  const templateHeader =
    entity === "students"
      ? "admissionNumber,firstName,lastName,gender,dateOfBirth,className,guardianName,guardianPhone,guardianEmail"
      : "employeeNumber,firstName,lastName,email,phone,department,jobTitle";

  const downloadTemplate = () => {
    const sample =
      entity === "students"
        ? "GA-2026-101,John,Mwangi,male,2012-05-14,Grade 7 Blue,Grace Wanjiku,0712345678,grace@example.com"
        : "T-001,Grace,Wanjiku,grace@greenfield.ac.ke,0712345678,Sciences,Teacher";
    const blob = new Blob([`${templateHeader}\n${sample}\n`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity}-import-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async () => {
    try {
      const res = await confirmImport({ entity, rows: rows as never });
      // Mark the onboarding import step complete when students are imported.
      if (entity === "students") {
        await markImportDone().catch(() => null);
      }
      const imported = entity === "students"
        ? res.studentsCreated + (res.guardiansCreated ? ` · ${res.guardiansCreated} guardian(s) linked` : "")
        : res.staffCreated;
      toast.success(`Imported ${imported} ${entity === "students" ? "student(s)" : "staff"}.`);
      reset();
      onOpenChange(false);
      onImported?.();
    } catch (err) {
      // Server rejects with the first blocking error (all-or-nothing import).
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Import blocked", { description: msg.slice(0, 220) });
    }
  };

  const previewErrors = preview?.errors ?? [];
  const allClean = preview !== undefined && preview.errorCount === 0 && preview.total > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import {entity === "students" ? "students" : "staff"}</DialogTitle>
          <DialogDescription>
            Upload a CSV file. Rows are validated first — nothing is saved until every row passes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          {(["students", "staff"] as const).map((e) => (
            <Button
              key={e}
              type="button"
              size="sm"
              variant={entity === e ? "default" : "outline"}
              onClick={() => { setEntity(e); reset(); }}
            >
              {e === "students" ? "Students" : "Staff"}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="size-4" /> Download template
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Choose CSV file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label="Choose CSV file to import"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          {filename && <span className="text-xs text-muted-foreground">{filename} · {rows.length} row(s)</span>}
        </div>

        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Accepted files: CSV (.csv), maximum 1,000 rows per import. The first row must be the
          column headers from the template. Data is validated before anything is saved, and only
          authorized staff at your school can see imported records.
        </p>

        {!hasCurrentYear && entity === "students" && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            No current academic year set — imported students cannot be enrolled. Set one under
            Academics → Academic Years first.
          </p>
        )}

        {missingColumns.length > 0 && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Missing required column(s): {missingColumns.join(", ")}.
          </p>
        )}

        {preview && (
          <div className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={preview.errorCount === 0 ? "default" : "destructive"}>
                {preview.validCount} / {preview.total} rows valid
              </Badge>
              {preview.errorCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-destructive">
                  <FileWarning className="size-3.5" /> fix these rows and re-upload
                </span>
              )}
              {allClean && (
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 className="size-3.5" /> ready to import
                </span>
              )}
            </div>
            {previewErrors.length > 0 && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 w-14 text-xs">Row</TableHead>
                      <TableHead className="h-8 w-28 text-xs">Field</TableHead>
                      <TableHead className="h-8 text-xs">Problem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewErrors.slice(0, 30).map((e, i) => (
                      <TableRow key={i}>
                        <TableCell className="py-1.5 text-xs tabular-nums">{e.row}</TableCell>
                        <TableCell className="py-1.5 text-xs">{e.field}</TableCell>
                        <TableCell className="py-1.5 text-xs text-muted-foreground">{e.message}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {previewErrors.length > 30 && (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground">
                    + {previewErrors.length - 30} more issue(s)
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button
            disabled={!allClean || !hasCurrentYear && entity === "students"}
            onClick={doImport}
          >
            <Upload className="size-4" /> Import {preview?.validCount ?? rows.length} row(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
