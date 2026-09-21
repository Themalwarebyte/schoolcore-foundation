import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Link } from "react-router";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { downloadReportCardPdf, downloadClassReportCardsPdf, type ReportCardPdfData } from "@/lib/reportCardPdf";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/lib/status";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClassSelect, ScopeBar, TermSelect, YearSelect } from "@/components/ops/Controls";
import { Download, FileText, Wand2 } from "lucide-react";

type CardRow = {
  _id: string;
  studentId: string;
  fullName: string;
  admissionNumber: string;
  status: string;
  overallAverage?: number;
  overallGrade?: string;
  rank?: number;
  classSize?: number;
  snapshotVersion: number;
};

export default function ReportCards() {
  const [yearId, setYearId] = useState("");
  const [termId, setTermId] = useState("");
  const [classSectionId, setClassSectionId] = useState("");

  // Default the term selector to the school's current term.
  const actx = useQuery(api.academics.academicContext, {});
  const effectiveTermId = termId || actx?.currentTerm?._id || "";

  const readiness = useQuery(api.reportCards.readiness, {});
  const cards = useQuery(
    api.reportCards.listForClass,
    effectiveTermId && classSectionId
      ? { termId: effectiveTermId as never, classSectionId: classSectionId as never }
      : "skip",
  );

  const generate = useMutation(api.reportCards.generate);
  const publish = useMutation(api.reportCards.publish);

  // Class bulk PDF: fetch full documents for all listed cards on demand.
  const [bulkLoading, setBulkLoading] = useState(false);
  const downloadClassPdf = async () => {
    if (!cards || (cards as CardRow[]).length === 0) return;
    setBulkLoading(true);
    try {
      const docs: ReportCardPdfData[] = [];
      for (const c of cards as CardRow[]) {
        const full = await fetchCard(c._id);
        if (full) docs.push(full);
      }
      downloadClassReportCardsPdf(docs);
      toast.success(`Downloaded ${docs.length} report card page(s) as one PDF`);
    } catch (err) {
      toast.error("Bulk download failed.", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBulkLoading(false);
    }
  };

  async function fetchCard(id: string): Promise<ReportCardPdfData | null> {
    try {
      const client = (window as unknown as { __convexClient?: { query: (ref: unknown, args: unknown) => Promise<unknown> } }).__convexClient;
      if (!client) return null;
      const anyApiModule = await import("@/convex/_generated/api");
      const full = await client.query(anyApiModule.api.reportCards.get, { reportCardId: id });
      return (full as unknown as ReportCardPdfData) ?? null;
    } catch {
      return null;
    }
  }

  return (
    <div className="page-shell">
      <PageHeader
        title="Report Cards"
        description="Generate snapshots from approved results, review, then publish."
      />

      {readiness && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatTile label="Generated" value={readiness.generated} hint="awaiting publication" />
          <StatTile label="Published" value={readiness.published} hint="immutable snapshots" />
          <StatTile label="Students covered" value={readiness.students} hint="this term" />
        </div>
      )}

      <ScopeBar>
        <YearSelect yearId={yearId} onChange={(v) => { setYearId(v); setTermId(""); }} />
        <TermSelect yearId={yearId} termId={effectiveTermId} onChange={setTermId} />
        <ClassSelect yearId={yearId} classSectionId={classSectionId} onChange={setClassSectionId} />
      </ScopeBar>

      <Card className="card-soft">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {cards ? `${cards.length} report card(s)` : "Report cards"}
          </CardTitle>
          <div className="flex gap-2">
            <Can permission="report_cards.generate">
              <Button
                size="sm"
                variant="outline"
                disabled={!effectiveTermId || !classSectionId}
                onClick={async () => {
                  try {
                    const r = await generate({
                      termId: effectiveTermId as never,
                      classSectionId: classSectionId as never,
                    });
                    toast.success(`Generated ${r.generated}, skipped ${r.skipped} (no approved results yet)`);
                  } catch (err) {
                    toast.error("Unable to generate.", { description: err instanceof Error ? err.message : undefined });
                  }
                }}
              >
                <Wand2 className="size-4" /> Generate / refresh
              </Button>
            </Can>
            <Can permission="report_cards.publish">
              <Button
                size="sm"
                disabled={!effectiveTermId || !classSectionId}
                onClick={async () => {
                  try {
                    const r = await publish({ termId: effectiveTermId as never, classSectionId: classSectionId as never });
                    toast.success(`Published ${r.count} report card(s)`);
                  } catch (err) {
                    toast.error("Unable to publish.", { description: err instanceof Error ? err.message : undefined });
                  }
                }}
              >
                Publish class set
              </Button>
            </Can>
            <Button
              size="sm"
              variant="outline"
              disabled={!cards || (cards as CardRow[]).length === 0 || bulkLoading}
              onClick={downloadClassPdf}
            >
              <Download className="size-4" /> {bulkLoading ? "Preparing…" : "Download class PDF"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!effectiveTermId || !classSectionId ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Select a term and class to list report cards.
            </p>
          ) : cards === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : (cards as CardRow[]).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No report cards for this class and term yet — generate them from approved results.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Adm. no.</TableHead>
                  <TableHead>Average</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Rank</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(cards as CardRow[]).map((c) => (
                  <TableRow key={c._id}>
                    <TableCell className="font-medium">{c.fullName}</TableCell>
                    <TableCell>{c.admissionNumber}</TableCell>
                    <TableCell className="tabular-nums">{c.overallAverage ?? "—"}</TableCell>
                    <TableCell>{c.overallGrade ?? "—"}</TableCell>
                    <TableCell>
                      {c.rank ? `${c.rank} / ${c.classSize ?? "—"}` : "—"}
                    </TableCell>
                    <TableCell>v{c.snapshotVersion}</TableCell>
                    <TableCell><StatusBadge status={c.status} /></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/report-cards/${c._id}`}>
                            <FileText className="size-3.5" /> View
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Download PDF"
                          onClick={async () => {
                            const full = await fetchCard(c._id);
                            if (full) downloadReportCardPdf(full);
                            else toast.error("Unable to load the report card document.");
                          }}
                        >
                          <Download className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground/80">{hint}</p>
    </div>
  );
}
