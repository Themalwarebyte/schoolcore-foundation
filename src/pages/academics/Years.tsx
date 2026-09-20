import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/lib/status";
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
import { CalendarRange, Archive, CheckCircle2, Plus } from "lucide-react";

export default function Years() {
  const years = useQuery(api.academics.listYears);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", startDate: "", endDate: "", isCurrent: false });
  const create = useMutation(api.academics.createYear);
  const setCurrent = useMutation(api.academics.setCurrentYear);
  const archive = useMutation(api.academics.archiveYear);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await create({
        name: form.name,
        startDate: form.startDate,
        endDate: form.endDate,
        isCurrent: form.isCurrent,
      });
      toast.success("Academic year created");
      setOpen(false);
      setForm({ name: "", startDate: "", endDate: "", isCurrent: false });
    } catch (err) {
      toast.error("Unable to create the academic year.", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Academic Years"
        description="Top-level academic periods. Only one year is current at a time."
        actions={
          <Can permission="academics.manage">
            <Button onClick={() => setOpen(true)}><Plus className="size-4" /> New year</Button>
          </Can>
        }
      />
      <Card className="card-soft">
        <CardHeader><CardTitle className="text-base">All years</CardTitle></CardHeader>
        <CardContent>
          {years === undefined ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted" />
          ) : years.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No academic years yet. Create one to start enrolling students.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {years.map((y) => (
                  <TableRow key={y._id}>
                    <TableCell className="font-medium">{y.name}</TableCell>
                    <TableCell>{y.startDate}</TableCell>
                    <TableCell>{y.endDate}</TableCell>
                    <TableCell><StatusBadge status={y.status} /></TableCell>
                    <TableCell>
                      {y.isCurrent ? (
                        <Badge className="gap-1"><CheckCircle2 className="size-3" /> Current</Badge>
                      ) : (
                        <Can permission="academics.manage">
                          <Button variant="outline" size="sm" onClick={() => setCurrent({ yearId: y._id }).then(() => toast.success(`${y.name} is now current`)).catch((e) => toast.error("Unable to set current.", { description: String(e) }))}>
                            Set current
                          </Button>
                        </Can>
                      )}
                    </TableCell>
                    <TableCell>
                      {!y.isCurrent && y.status !== "archived" && (
                        <Can permission="academics.manage">
                          <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => setArchiveId(y._id)} aria-label="Archive year">
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
            <DialogTitle>New academic year</DialogTitle>
            <DialogDescription>Example: 2026 (Jan 5 – Nov 20).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="2026" />
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={form.isCurrent}
                onChange={(e) => setForm((f) => ({ ...f, isCurrent: e.target.checked }))}
              />
              Make this the current year
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !form.name || !form.startDate || !form.endDate}>
              {saving ? "Saving…" : "Create year"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveId} onOpenChange={(v) => !v && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this academic year?</AlertDialogTitle>
            <AlertDialogDescription>
              Historical data is preserved; the year becomes read-only for new activity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!archiveId) return;
                try {
                  await archive({ yearId: archiveId as never });
                  toast.success("Year archived");
                } catch (err) {
                  toast.error("Unable to archive.", { description: err instanceof Error ? err.message : undefined });
                }
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CalendarRange className="hidden" />
    </div>
  );
}
