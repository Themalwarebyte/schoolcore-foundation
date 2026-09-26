import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/school-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/status";
import { Megaphone, Plus, Send, Archive } from "lucide-react";

const AUDIENCES = [
  { value: "all", label: "Everyone (school-wide)" },
  { value: "parents", label: "Parents" },
  { value: "students", label: "Students" },
  { value: "teachers", label: "Teachers" },
  { value: "class", label: "A specific class" },
  { value: "grade", label: "A specific grade level" },
];

export default function Announcements() {
  const data = useQuery(api.announcements.listAllAnnouncements, {});
  const [open, setOpen] = useState(false);

  return (
    <div className="page-shell">
      <PageHeader
        title="Announcements"
        description="Compose, publish, and manage school announcements. Published announcements fan out to portal accounts instantly."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New announcement
          </Button>
        }
      />

      <Card className="card-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="size-4" /> All announcements
          </CardTitle>
          <CardDescription>Drafts are visible only to staff; published ones reach their audience.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data === undefined ? (
            <div className="h-32 animate-pulse rounded-b-xl bg-muted" />
          ) : data.announcements.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No announcements yet. Create the first one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.announcements.map((a) => (
                  <TableRow key={a._id}>
                    <TableCell className="max-w-64">
                      <p className="truncate font-medium">{a.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.message}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.audienceLabel}</TableCell>
                    <TableCell>
                      <Badge
                        variant={a.status === "published" ? "default" : a.status === "archived" ? "outline" : "secondary"}
                        className="capitalize"
                      >
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.publishedAt ? formatDateTime(a.publishedAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions id={a._id} status={a.status} title={a.title} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function RowActions({ id, status, title }: { id: string; status: string; title: string }) {
  const publish = useMutation(api.announcements.publishAnnouncement);
  const archive = useMutation(api.announcements.archiveAnnouncement);
  return (
    <div className="flex justify-end gap-1.5">
      {status === "draft" && (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await publish({ announcementId: id as never });
              toast.success(`"${title}" published`);
            } catch (err) {
              toast.error("Could not publish.", { description: friendlyError(err) });
            }
          }}
        >
          <Send className="size-4" /> Publish
        </Button>
      )}
      {status !== "archived" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await archive({ announcementId: id as never });
              toast.success(`"${title}" archived`);
            } catch (err) {
              toast.error("Could not archive.", { description: friendlyError(err) });
            }
          }}
        >
          <Archive className="size-4" /> Archive
        </Button>
      )}
    </div>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useMutation(api.announcements.createAnnouncement);
  const sections = useQuery(api.academics.listClassSections, open ? {} : "skip");
  const grades = useQuery(api.academics.listGradeLevels, open ? {} : "skip");

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState("all");
  const [classSectionId, setClassSectionId] = useState("");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [publishNow, setPublishNow] = useState(true);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle(""); setMessage(""); setAudience("all");
    setClassSectionId(""); setGradeLevelId("");
  };

  const submit = async () => {
    setBusy(true);
    try {
      await create({
        title,
        message,
        audience,
        classSectionId: audience === "class" && classSectionId ? (classSectionId as never) : undefined,
        gradeLevelId: audience === "grade" && gradeLevelId ? (gradeLevelId as never) : undefined,
        publishNow,
      });
      toast.success(publishNow ? "Announcement published" : "Announcement saved as draft");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save the announcement.", { description: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New announcement</DialogTitle>
          <DialogDescription>
            Target everyone, a role group, a grade, or a single class. Publishing notifies the audience immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="an-title">Title</Label>
            <Input id="an-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sports Day this Friday" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="an-msg">Message</Label>
            <Textarea id="an-msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write the announcement…" />
          </div>
          <div className="grid gap-1.5">
            <Label>Audience</Label>
            <Select value={audience} onValueChange={(v) => { setAudience(v); setClassSectionId(""); setGradeLevelId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AUDIENCES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {audience === "class" && (
            <div className="grid gap-1.5">
              <Label>Class</Label>
              <Select value={classSectionId} onValueChange={setClassSectionId}>
                <SelectTrigger><SelectValue placeholder="Choose class…" /></SelectTrigger>
                <SelectContent>
                  {(sections ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.gradeName} — {c.streamName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {audience === "grade" && (
            <div className="grid gap-1.5">
              <Label>Grade level</Label>
              <Select value={gradeLevelId} onValueChange={setGradeLevelId}>
                <SelectTrigger><SelectValue placeholder="Choose grade…" /></SelectTrigger>
                <SelectContent>
                  {(grades ?? []).map((g) => (
                    <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter className="items-center">
          <label className="mr-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={publishNow}
              onChange={(e) => setPublishNow(e.target.checked)}
              className="size-4 rounded border-input"
            />
            Publish immediately
          </label>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!title.trim() || !message.trim() || busy || (audience === "class" && !classSectionId) || (audience === "grade" && !gradeLevelId)}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : publishNow ? "Publish" : "Save draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
