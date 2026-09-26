import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "react-router";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge, formatDate } from "@/lib/status";
import { usePermissions } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Search, MoreHorizontal, Eye, Archive, Upload } from "lucide-react";
import { ImportStudentsDialog } from "@/components/shared/import-dialog";

const PAGE_SIZE = 15;

export default function Students() {
  const { can } = usePermissions();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [classSectionId, setClassSectionId] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const years = useQuery(api.academics.listYears);
  const currentYear = years?.find((y) => y.isCurrent);
  const sections = useQuery(
    api.academics.listClassSections,
    currentYear ? { academicYearId: currentYear._id } : "skip",
  );

  useMemo(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const students = useQuery(api.students.list, {
    search: debounced || undefined,
    status,
    classSectionId: classSectionId === "all" ? undefined : (classSectionId as never),
    paginationOpts: { numItems: PAGE_SIZE, cursor: page === 0 ? null : String(page) },
  });

  const createStudent = useMutation(api.students.create);
  const [form, setForm] = useState({
    firstName: "", middleName: "", lastName: "", preferredName: "",
    gender: "female", dateOfBirth: "", nationality: "", admissionDate: "",
    admissionNumber: "", studentStatus: "active", boardingStatus: "day",
    previousSchool: "", notes: "",
  });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await createStudent({
        admissionNumber: form.admissionNumber,
        firstName: form.firstName,
        middleName: form.middleName || undefined,
        lastName: form.lastName,
        preferredName: form.preferredName || undefined,
        gender: form.gender,
        dateOfBirth: form.dateOfBirth || undefined,
        nationality: form.nationality || undefined,
        admissionDate: form.admissionDate || undefined,
        studentStatus: form.studentStatus,
        boardingStatus: form.boardingStatus as "day" | "boarding",
        previousSchool: form.previousSchool || undefined,
        notes: form.notes || undefined,
      });
      toast.success("Student admitted", { description: `${form.firstName} ${form.lastName} has been added.` });
      setAddOpen(false);
      setForm({ firstName: "", middleName: "", lastName: "", preferredName: "", gender: "female", dateOfBirth: "", nationality: "", admissionDate: "", admissionNumber: "", studentStatus: "active", boardingStatus: "day", previousSchool: "", notes: "" });
    } catch (err) {
      toast.error("Unable to save the student.", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const rows = students?.page.map((s) => ({
    _id: s._id,
    student: (
      <div className="flex items-center gap-3">
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
            {s.firstName[0]}{s.lastName[0]}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <Link to={`/students/${s._id}`} className="truncate text-sm font-medium hover:underline">
            {[s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ")}
          </Link>
          <p className="text-xs text-muted-foreground">{s.admissionNumber}</p>
        </div>
      </div>
    ),
    classLabel: s.classLabel ?? <span className="text-muted-foreground">Not enrolled</span>,
    gender: <span className="capitalize">{s.gender ?? "—"}</span>,
    guardianName: s.guardianName ?? <span className="text-muted-foreground">—</span>,
    studentStatus: <StatusBadge status={s.studentStatus} />,
    admissionDate: formatDate(s.admissionDate),
    actions: (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => window.location.assign(`/students/${s._id}`)}>
            <Eye className="mr-2 size-4" /> View profile
          </DropdownMenuItem>
          {can("students.archive") && s.studentStatus === "active" && (
            <ArchiveMenuItem studentId={s._id} name={`${s.firstName} ${s.lastName}`} />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }));

  return (
    <div className="page-shell">
      <PageHeader
        title="Students"
        description="Central records for every learner at your school."
        actions={
          <Can permission="students.create">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Import
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add student
            </Button>
          </Can>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or admission number…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["active", "inactive", "graduated", "transferred", "withdrawn", "archived"].map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={classSectionId} onValueChange={(v) => { setClassSectionId(v); setPage(0); }}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classes</SelectItem>
            {sections?.map((c) => (
              <SelectItem key={c._id} value={c._id}>
                {c.gradeName} {c.streamName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={[
          { key: "student", header: "Student" },
          { key: "classLabel", header: "Current class" },
          { key: "gender", header: "Gender" },
          { key: "guardianName", header: "Guardian" },
          { key: "studentStatus", header: "Status" },
          { key: "admissionDate", header: "Admitted" },
          { key: "actions", header: "", className: "w-10" },
        ]}
        rows={rows}
        loading={students === undefined}
        empty={
          <>
            <p className="text-sm font-medium">No students found</p>
            <p className="text-xs text-muted-foreground">
              {search ? "Try a different search term." : "Add your first student to get started."}
            </p>
          </>
        }
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        hasNextPage={(students?.page.length ?? 0) === PAGE_SIZE}
      />

      <AddStudentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        form={form}
        setForm={setForm as React.Dispatch<React.SetStateAction<Record<string, string>>>}
        saving={saving}
        onSubmit={handleCreate}
      />

      <ImportStudentsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        hasCurrentYear={!!currentYear}
        onImported={() => setPage(0)}
      />
    </div>
  );
}

function ArchiveMenuItem({ studentId, name }: { studentId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const archive = useMutation(api.students.archive);
  return (
    <>
      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        onSelect={(e) => { e.preventDefault(); setOpen(true); }}
      >
        <Archive className="mr-2 size-4" /> Archive student
      </DropdownMenuItem>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The record is kept for history but marked archived and removed from active lists. Active enrollments are closed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                try {
                  await archive({ studentId: studentId as never, status: "archived" });
                  toast.success("Student archived");
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
    </>
  );
}

function AddStudentDialog({ open, onOpenChange, form, setForm, saving, onSubmit }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: Record<string, string>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saving: boolean;
  onSubmit: () => void;
}) {
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add student</DialogTitle>
          <DialogDescription>Admit a new learner. Fields marked * are required.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Admission number *</Label>
            <Input value={form.admissionNumber} onChange={set("admissionNumber")} placeholder="GA-2026-101" />
          </div>
          <div className="grid gap-1.5">
            <Label>Admission date</Label>
            <Input type="date" value={form.admissionDate} onChange={set("admissionDate")} />
          </div>
          <div className="grid gap-1.5">
            <Label>First name *</Label>
            <Input value={form.firstName} onChange={set("firstName")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Middle name</Label>
            <Input value={form.middleName} onChange={set("middleName")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Last name *</Label>
            <Input value={form.lastName} onChange={set("lastName")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Preferred name</Label>
            <Input value={form.preferredName} onChange={set("preferredName")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Gender</Label>
            <Select value={form.gender} onValueChange={(v) => setForm((f) => ({ ...f, gender: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Date of birth</Label>
            <Input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} />
          </div>
          <div className="grid gap-1.5">
            <Label>Nationality</Label>
            <Input value={form.nationality} onChange={set("nationality")} placeholder="Kenyan" />
          </div>
          <div className="grid gap-1.5">
            <Label>Day / Boarding</Label>
            <Select value={form.boardingStatus} onValueChange={(v) => setForm((f) => ({ ...f, boardingStatus: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="boarding">Boarding</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Previous school</Label>
            <Input value={form.previousSchool} onChange={set("previousSchool")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={saving || !form.firstName || !form.lastName || !form.admissionNumber}>
            {saving ? "Saving…" : "Save student"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
