import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/platform-layout";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Check, FileText, ShieldCheck, X } from "lucide-react";
import { formatDateTime } from "@/lib/status";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  submitted: "secondary",
  under_review: "outline",
  approved: "default",
  rejected: "destructive",
  onboarding: "default",
  active: "default",
};

export default function SchoolRequests() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const requests = useQuery(api.phase7.registration.platformListRequests, {
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const detail = useQuery(
    api.phase7.registration.platformRequestDetail,
    detailId ? { requestId: detailId as never } : "skip",
  );
  const review = useMutation(api.phase7.registration.reviewRequest);
  const approve = useMutation(api.phase7.registration.approveRequest);
  const reject = useMutation(api.phase7.registration.rejectRequest);

  async function decide(requestId: string, decision: "approve" | "reject" | "more_info" | "under_review") {
    try {
      if (decision === "approve") {
        await approve({ requestId: requestId as never, notes: notes || undefined });
      } else if (decision === "reject") {
        if (!notes.trim()) {
          toast.error("A rejection reason is required.");
          return;
        }
        await reject({ requestId: requestId as never, reason: notes.trim() });
      } else {
        await review({
          requestId: requestId as never,
          action: decision === "more_info" ? "more_info" : "start_review",
          notes: notes || undefined,
        });
      }
      toast.success(
        decision === "approve"
          ? "Approved — school workspace and onboarding record created."
          : `Request ${decision === "under_review" ? "moved to review" : decision.replace("_", " ")}.`,
      );
      setNotes("");
      setDetailId(null);
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  const rows = requests?.map((r) => ({
    _id: r._id,
    school: (
      <div>
        <p className="text-sm font-medium">{r.schoolName}</p>
        <p className="text-xs text-muted-foreground">{r.email}</p>
      </div>
    ),
    location: r.county ? `${r.county}${r.country ? `, ${r.country}` : ""}` : "—",
    contact: (
      <div>
        <p className="text-sm">{r.contactName}</p>
        <p className="text-xs text-muted-foreground">{r.contactEmail}</p>
      </div>
    ),
    students: r.expectedStudents ?? "—",
    submitted: formatDateTime(r.createdAt),
    status: <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="capitalize">{r.status.replace("_", " ")}</Badge>,
    actions: (
      <Button size="sm" variant="outline" onClick={() => { setNotes(""); setDetailId(r._id); }}>
        <FileText className="size-3.5" /> Review
      </Button>
    ),
  }));

  return (
    <>
      <PageHeader
        title="School Requests"
        description="Review and approve new school registrations. Approvals create the school workspace and onboarding record."
        actions={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All requests</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="under_review">Under review</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="p-4 sm:p-6">
        <DataTable
          columns={[
            { key: "school", header: "School" },
            { key: "location", header: "Location" },
            { key: "contact", header: "Contact" },
            { key: "students", header: "Students" },
            { key: "submitted", header: "Submitted" },
            { key: "status", header: "Status" },
            { key: "actions", header: "", className: "w-10" },
          ]}
          rows={rows}
          loading={requests === undefined}
          empty={<><p className="text-sm font-medium">No registration requests</p><p className="text-xs text-muted-foreground">New school requests from the landing page will appear here.</p></>}
          page={0}
          pageSize={15}
          onPageChange={() => undefined}
          hasNextPage={false}
        />
      </div>

      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.request.schoolName ?? "Review request"}</DialogTitle>
            <DialogDescription>
              Submitted {detail ? formatDateTime(detail.request.createdAt) : ""} ·{" "}
              <Badge variant={STATUS_VARIANT[detail?.request.status ?? ""] ?? "outline"} className="capitalize">
                {detail?.request.status.replace("_", " ") ?? ""}
              </Badge>
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid gap-x-6 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-2">
                <p><span className="text-muted-foreground">Registration no:</span> {detail.request.registrationNumber ?? "—"}</p>
                <p><span className="text-muted-foreground">Curriculum:</span> {detail.request.curriculum ?? "—"}</p>
                <p><span className="text-muted-foreground">School email:</span> {detail.request.email}</p>
                <p><span className="text-muted-foreground">Phone:</span> {detail.request.phone ?? "—"}</p>
                <p><span className="text-muted-foreground">County:</span> {detail.request.county ?? "—"}</p>
                <p><span className="text-muted-foreground">Country:</span> {detail.request.country ?? "—"}</p>
                <p><span className="text-muted-foreground">Contact:</span> {detail.request.contactName} ({detail.request.contactPosition ?? "—"})</p>
                <p><span className="text-muted-foreground">Contact email:</span> {detail.request.contactEmail}</p>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium">Uploaded documents</p>
                {detail.documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No documents attached yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {detail.documents.map((d) => (
                      <li key={d.documentId} className="flex items-center gap-2">
                        <FileText className="size-3.5 text-muted-foreground" />
                        <span className="capitalize">{d.kind.replace(/_/g, " ")}</span>
                        <span className="text-xs text-muted-foreground">({d.filename})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {detail.request.decisionNotes && (
                <p className="rounded-md bg-muted/50 p-3 text-sm">
                  <span className="font-medium">Previous notes:</span> {detail.request.decisionNotes}
                </p>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Decision notes</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Required for reject / more info. Optional otherwise."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={() => detailId && decide(detailId, "reject")}>
                <X className="size-4" /> Reject
              </Button>
              <Button variant="outline" size="sm" onClick={() => detailId && decide(detailId, "more_info")}>
                Request info
              </Button>
              <Button variant="outline" size="sm" onClick={() => detailId && decide(detailId, "under_review")}>
                Mark under review
              </Button>
            </div>
            <Button size="sm" onClick={() => detailId && decide(detailId, "approve")}>
              <Check className="size-4" /> Approve &amp; start onboarding
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex items-center gap-2 px-4 pb-6 text-xs text-muted-foreground sm:px-6">
        <ShieldCheck className="size-3.5" /> Every review action is written to the platform audit log.
      </div>
    </>
  );
}
