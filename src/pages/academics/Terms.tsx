import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/lib/status";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Archive, CheckCircle2, Plus } from "lucide-react";

export default function Terms() {
  const years = useQuery(api.academics.listYears);
  const [yearFilter, setYearFilter] = useState("");
  const effectiveYear = yearFilter || years?.find((y) => y.isCurrent)?._id || "";
  const terms = useQuery(
    api.academics.listTerms,
    effectiveYear ? { academicYearId: effectiveYear as never } : "skip",
  );

  const create = useMutation(api.academics.createTerm);
  const setCurrent = useMutation(api.academics.setCurrentTerm);
  const archive = useMutation(api.academics.archiveTerm);
  const [open, setOpen] = useState(false);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "", displayOrder: 1 });

  const handleCreate = async () => {
    setSaving(true);
    try {
      await create({
        academicYearId: effectiveYear as never,
        name: form.name,
        startDate: form.startDate,
        endDate: form.endDate,
        displayOrder: Number(form.displayOrder),
      });
      toast.success("Term created");
      setOpen(false);
      setForm({ name: "", startDate: "", endDate: "", displayOrder: 1 });
    } catch (err) {
      toast.error("Unable to create the term.", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Terms"
        description="Terms belong to an academic year and must fit inside its dates."
        actions={
          <Can permission="academics.manage">
            <Button onClick={() => setOpen(true)} disabled={!effectiveYear}>
              <Plus className="size-4" /> New term
            </Button>
          </Can>
        }
      />

      <div className="mb-4 max-w-xs">
        <Label>Academic year</Label>
        <Select value={effectiveYear} onValueChange={setYearFilter}>
          <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select year" /></SelectTrigger>
          <SelectContent>
            {years?.map((y) => (
              <SelectItem key={y._id} value={y._id}>
                {y.name}{y.isCurrent ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="card-soft">
        <CardHeader><CardTitle className="text-base">Terms</CardTitle></CardHeader>
        <CardContent>
          {terms === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : terms.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No terms for this year yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Term</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {terms.map((t) => (
                  <TableRow key={t._id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.startDate}</TableCell>
                    <TableCell>{t.endDate}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell>
                      {t.isCurrent ? (
                        <Badge className="gap-1"><CheckCircle2 className="size-3" /> Current</Badge>
                      ) : (
                        <Can permission="academics.manage">
                          <Button variant="outline" size="sm" onClick={() => setCurrent({ termId: t._id }).then(() => toast.success(`${t.name} is now current`)).catch((e) => toast.error("Unable to set current.", { description: e instanceof Error ? e.message : String(e) }))}>
                            Set current
                          </Button>
                        </Can>
                      )}
                    </TableCell>
                    <TableCell>
                      {!t.isCurrent && t.status !== "archived" && (
                        <Can permission="academics.manage">
                          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setArchiveId(t._id)} aria-label="Archive term">
                            <Archive className="size-4" />
                          </Button>
                        </Can>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New term</DialogTitle>
            <DialogDescription>Dates must fall within the selected academic year.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Term 1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Start date *</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>End date *</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Display order</Label>
              <Input type="number" value={form.displayOrder} onChange={(e) => setForm((f) => ({ ...f, displayOrder: Number(e.target.value) }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.name || !form.startDate || !form.endDate}>
              {saving ? "Saving…" : "Create term"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveId} onOpenChange={(v) => !v && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this term?</AlertDialogTitle>
            <AlertDialogDescription>Historical references remain intact.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!archiveId) return;
                try {
                  await archive({ termId: archiveId as never });
                  toast.success("Term archived");
                } catch (err) {
                  toast.error("Unable to archive.", { description: friendlyError(err) });
                }
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
