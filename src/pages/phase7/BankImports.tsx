import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FileUp, Send, XCircle } from "lucide-react";

type Row = {
  _id: string; lineNo: number; date: string; reference: string;
  amount: number; narration: string | null;
  candidateStudentId: string | null; candidateStudentName: string | null;
  matchBasis: string | null; duplicate: boolean; status: string;
  paymentId: string | null; discardReason: string | null;
};

function parseCsv(text: string): { date: string; reference: string; amount: number; narration?: string }[] {
  const out: { date: string; reference: string; amount: number; narration?: string }[] = [];
  for (const raw of text.split(/\r?\n/).slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    const [date, reference, amount, narration] = parts;
    if (!date || !reference || !amount) continue;
    out.push({ date, reference, amount: Number(amount), narration: narration || undefined });
  }
  return out;
}

export default function BankImports() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [csv, setCsv] = useState("");
  const [activeBatch, setActiveBatch] = useState<string | null>(null);

  const batches = useQuery(api.phase7.billing.listBankImportBatches, {});
  const rows = useQuery(api.phase7.billing.bankImportRows,
    activeBatch ? { batchId: activeBatch as never } : "skip") as Row[] | undefined;
  const students = useQuery(api.students.list, {
    search: undefined, status: "active",
    paginationOpts: { numItems: 300, cursor: null },
  }) as { page?: Array<{ _id: string; admissionNumber: string; firstName: string; lastName: string }> } | undefined;

  const stageImport = useMutation(api.phase7.billing.stageBankImport);
  const setRowMatch = useMutation(api.phase7.billing.setBankRowMatch);
  const postRows = useMutation(api.phase7.billing.postBankRows);
  const discardRow = useMutation(api.phase7.billing.discardBankRow);
  const finalizeBatch = useMutation(api.phase7.billing.finalizeBatch);

  const draftRows = (rows ?? []).filter((r) => r.status === "draft" && !r.duplicate && r.candidateStudentId);
  const problemRows = (rows ?? []).filter((r) => r.status === "draft" && (r.duplicate || !r.candidateStudentId));

  return (
    <>
      <PageHeader
        title="Bank Imports"
        description="Upload a bank statement (CSV: date, reference, amount, narration). Rows auto-match students by admission number or guardian phone in the narration, then post through the real payment engine."
        actions={
          <Button onClick={() => { setFilename(""); setCsv(""); setUploadOpen(true); }}>
            <FileUp className="size-4" /> Upload statement
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <Card className="card-soft">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Import batches</CardTitle></CardHeader>
          <CardContent>
            <DataTable
              columns={[
                { key: "filename", header: "File" },
                { key: "ref", header: "Bank ref" },
                { key: "rows", header: "Rows" },
                { key: "status", header: "Status" },
                { key: "actions", header: "", className: "w-10" },
              ]}
              rows={(batches ?? []).map((b) => ({
                _id: b._id,
                filename: <span className="font-medium">{b.filename}</span>,
                ref: b.bankReference ?? "—",
                rows: b.rowCount,
                status: <Badge variant={b.status === "posted" ? "default" : b.status === "discarded" ? "destructive" : "secondary"}>{b.status}</Badge>,
                actions: (
                  <Button size="sm" variant="outline" onClick={() => setActiveBatch(b._id)}>Review</Button>
                ),
              }))}
              loading={batches === undefined}
              empty={<><p className="text-sm font-medium">No bank imports yet</p><p className="text-xs text-muted-foreground">Upload a CSV bank statement to reconcile deposits against student fee accounts.</p></>}
              page={0}
              pageSize={10}
              onPageChange={() => undefined}
              hasNextPage={false}
            />
          </CardContent>
        </Card>

        {activeBatch && (
          <>
            <Card className="card-soft">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Matched draft rows — {draftRows.length} ready to post</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DataTable
                  columns={[
                    { key: "line", header: "#" },
                    { key: "date", header: "Date" },
                    { key: "ref", header: "Reference" },
                    { key: "amount", header: "Amount" },
                    { key: "match", header: "Matched to" },
                    { key: "basis", header: "Basis" },
                    { key: "actions", header: "", className: "w-10" },
                  ]}
                  rows={(rows ?? []).filter((r) => r.status === "draft").map((r) => ({
                    _id: r._id,
                    line: r.lineNo,
                    date: r.date,
                    ref: <span className="font-mono text-xs">{r.reference}</span>,
                    amount: r.amount,
                    match: r.candidateStudentName ? (
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        value={r.candidateStudentId ?? ""}
                        onChange={async (e) => {
                          try {
                            await setRowMatch({ rowId: r._id as never, studentId: (e.target.value || undefined) as never });
                            toast.success("Match updated");
                          } catch (err) { toast.error(friendlyError(err)); }
                        }}
                      >
                        <option value="">— unmatched —</option>
                        {((students?.page ?? [])).map((s) => (
                          <option key={s._id} value={s._id}>{s.admissionNumber} — {s.firstName} {s.lastName}</option>
                        ))}
                        <option value={r.candidateStudentId ?? ""}>{r.candidateStudentName}</option>
                      </select>
                    ) : (
                      <select
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        value=""
                        onChange={async (e) => {
                          try {
                            await setRowMatch({ rowId: r._id as never, studentId: (e.target.value || undefined) as never });
                            toast.success("Match set");
                          } catch (err) { toast.error(friendlyError(err)); }
                        }}
                      >
                        <option value="">— pick student —</option>
                        {((students?.page ?? [])).map((s) => (
                          <option key={s._id} value={s._id}>{s.admissionNumber} — {s.firstName} {s.lastName}</option>
                        ))}
                      </select>
                    ),
                    basis: r.duplicate ? <Badge variant="destructive">duplicate ref</Badge> : (r.matchBasis ?? "—"),
                    actions: (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        const reason = window.prompt("Discard reason (required):");
                        if (!reason) return;
                        try { await discardRow({ rowId: r._id as never, reason }); toast.success("Row discarded"); }
                        catch (err) { toast.error(friendlyError(err)); }
                      }}>
                        <XCircle className="size-3.5" />
                      </Button>
                    ),
                  }))}
                  loading={rows === undefined}
                  empty={<p className="text-sm text-muted-foreground">No draft rows in this batch.</p>}
                  page={0}
                  pageSize={50}
                  onPageChange={() => undefined}
                  hasNextPage={false}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    disabled={draftRows.length === 0}
                    onClick={async () => {
                      try {
                        const res = await postRows({ rowIds: draftRows.map((r) => r._id as never) });
                        toast.success(`${res.posted} posted, ${res.skipped} skipped${res.errors.length ? `, ${res.errors.length} error(s)` : ""}`);
                      } catch (e) { toast.error(friendlyError(e)); }
                    }}
                  >
                    <Send className="size-4" /> Post {draftRows.length} matched row(s)
                  </Button>
                  <Button variant="outline" onClick={async () => {
                    try {
                      await finalizeBatch({ batchId: activeBatch as never });
                      toast.success("Batch finalized"); setActiveBatch(null);
                    } catch (e) { toast.error(friendlyError(e)); }
                  }}>Finalize batch</Button>
                </div>
              </CardContent>
            </Card>

            {problemRows.length > 0 && (
              <Card className="card-soft border-amber-500/40">
                <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-600">Needs attention — {problemRows.length} row(s)</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {problemRows.map((r) => (
                      <li key={r._id} className="flex items-center justify-between rounded-md border border-border/60 p-2">
                        <span>#{r.lineNo} · {r.reference} · {r.amount} {r.narration ? `· ${r.narration}` : ""}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.duplicate ? "Reference already used by a payment" : "No student match — assign manually or discard"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Upload bank statement</DialogTitle>
            <DialogDescription>
              CSV with a header row: <code className="text-xs">date,reference,amount,narration</code>. Dates must be YYYY-MM-DD.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Batch name *</Label>
              <Input value={filename} onChange={(e) => setFilename(e.target.value)} placeholder="e.g. KCB June statement" />
            </div>
            <div className="space-y-1">
              <Label>CSV content *</Label>
              <Textarea
                rows={8}
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                className="font-mono text-xs"
                placeholder={"date,reference,amount,narration\n2026-06-03,BKSC0001234,15000,GRN-001 fees"}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">…or pick a .csv file</Label>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setFilename((f) => f || file.name);
                  setCsv(await file.text());
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button
              disabled={!filename.trim() || !csv.trim()}
              onClick={async () => {
                try {
                  const parsed = parseCsv(csv);
                  if (parsed.length === 0) { toast.error("No data rows could be parsed."); return; }
                  const res = await stageImport({ filename: filename.trim(), rows: parsed });
                  toast.success(`Staged ${res.rowCount} row(s)`);
                  setUploadOpen(false);
                  setActiveBatch(res.batchId);
                } catch (e) { toast.error(friendlyError(e)); }
              }}
            >Stage import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Convert backend failures into user-friendly toast text. */
function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.match(/Uncaught ConvexError: (.+?)(?:\n|$)/);
  const core = (m ? m[1] : raw)
    .replace(/^\[Request ID: [^\]]+\]\s*/, "")
    .replace(/\s+at .*/g, "")
    .trim();
  return core.length > 0 ? core.slice(0, 180) : "Something went wrong. Please try again.";
}
