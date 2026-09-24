import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BookOpen, BookCopy, Repeat, Plus } from "lucide-react";
import { Pill, statusTone, FormDialog, Field, EmptyState, EntityPicker } from "@/components/ops/shared";

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function LibraryPage() {
  const dash = useQuery(api.library.libraryDashboard, {});
  const books = useQuery(api.library.listBooks, { search: "" });
  const myLoans = useQuery(api.library.myLoans, {});

  return (
    <div>
      <PageHeader
        title="Library"
        description="Catalogue, copies, borrowing and overdue tracking."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Titles" value={dash?.titleCount ?? "—"} icon={BookOpen} />
        <MiniStat label="Active loans" value={dash?.activeLoans ?? "—"} icon={BookCopy} />
        <MiniStat label="Overdue" value={dash?.overdueLoans ?? "—"} icon={Repeat} tone={dash?.overdueLoans ? "bad" : "good"} />
        <MiniStat label="Outstanding fines" value={money(dash?.outstandingFines ?? 0)} icon={BookCopy} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><CatalogueSection books={books ?? []} /></div>
        <MyLoansCard loans={myLoans ?? []} />
      </div>
    </div>
  );
}

function MiniStat({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; tone?: "good" | "bad" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className={`mt-2 text-2xl font-bold tabular-nums ${tone === "bad" ? "text-rose-600 dark:text-rose-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

/* ================================================================== */

function CatalogueSection({
  books,
}: {
  books: Array<{
    _id: string; title: string; author: string | null; isbn: string | null; category: string | null;
    totalCopies: number; availableCopies: number; location: string | null;
  }>;
}) {
  const [search, setSearch] = useState("");
  const refresh = useMutation(api.library.refreshOverdue);
  const issue = useMutation(api.library.issueBook);
  const doReturn = useMutation(api.library.returnBook);
  const students = useQuery(api.library.listBorrowers, { search: "" });
  const [detailBook, setDetailBook] = useState<string | null>(null);
  const detail = useQuery(api.library.getBook, detailBook ? { bookId: detailBook as never } : "skip");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Catalogue</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={async () => {
            const n = await refresh({});
            toast.success(n > 0 ? `${n} loan(s) marked overdue` : "No overdue loans to flag");
          }}><Repeat className="h-4 w-4" />Refresh overdue</Button>
          <Can permission="library.manage">
            <AddBookDialog />
          </Can>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title, author or ISBN…" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="hidden sm:table-cell">Category</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="hidden md:table-cell">Copies</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {books
              .filter((b) => !search || `${b.title} ${b.author ?? ""} ${b.isbn ?? ""}`.toLowerCase().includes(search.toLowerCase()))
              .map((b) => (
                <TableRow key={b._id}>
                  <TableCell className="font-medium">
                    {b.title}
                    <span className="block text-xs text-muted-foreground">{b.author ?? "—"}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{b.category ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={b.availableCopies === 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {b.availableCopies}/{b.totalCopies}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{b.location ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Can permission="library.manage">
                        <Button size="sm" variant="outline" onClick={() => setDetailBook(b._id)}>Issue / view</Button>
                      </Can>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            {books.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No books catalogued yet.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>

        {detail ? (
          <div className="rounded-lg border p-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium">{detail.book.title}</p>
                <p className="text-xs text-muted-foreground">
                  {detail.copies.filter((c) => c.status === "available").length} of {detail.copies.length} copies available
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDetailBook(null)}>Close</Button>
            </div>
            <div className="mt-3 space-y-2">
              <IssueForm
                bookId={detail.book._id}
                borrowers={(students ?? []).map((s) => ({ id: s.id, label: s.name, sub: s.kind === "student" ? s.ref : `staff ${s.ref}` }))}
                onIssue={issue}
              />
              <div className="space-y-1">
                {detail.loans.map((l) => (
                  <div key={l._id} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                    <span>
                      copy {l.copyNumber} — {l.borrower}
                      <span className="ml-2 text-xs text-muted-foreground">due {l.dueDate}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {l.status === "issued" || l.status === "overdue" ? (
                        <Button size="sm" variant="outline" onClick={async () => {
                          const res = await doReturn({ loanId: l._id as never });
                          toast.success(res.overdueDays > 0 ? `Returned — ${res.overdueDays} day(s) late, fine ${res.fine}` : "Returned on time");
                        }}>Return</Button>
                      ) : (
                        <Pill tone={statusTone(l.status)}>{l.status}{l.fineAmount > 0 ? ` · fine ${money(l.fineAmount)}` : ""}</Pill>
                      )}
                    </span>
                  </div>
                ))}
                {detail.loans.length === 0 ? <p className="text-xs text-muted-foreground">No loan history for this title.</p> : null}
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function IssueForm({
  bookId, borrowers, onIssue,
}: {
  bookId: string;
  borrowers: Array<{ id: string; label: string; sub?: string }>;
  onIssue: ReturnType<typeof useMutation<typeof api.library.issueBook>>;
}) {
  const [borrower, setBorrower] = useState<{ id: string; label: string; sub?: string } | null>(null);
  const [days, setDays] = useState("14");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1">
        <Field label="Borrower">
          <EntityPicker options={borrowers} value={borrower} onChange={setBorrower} placeholder="Search students or staff…" />
        </Field>
      </div>
      <Field label="Days">
        <Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className="w-20" />
      </Field>
      <Button
        size="sm"
        onClick={async () => {
          if (!borrower) {
            toast.error("Choose a borrower first");
            return;
          }
          try {
            await onIssue({
              bookId: bookId as never,
              borrowerStudentId: borrower.sub?.startsWith("staff") ? undefined : (borrower.id as never),
              borrowerStaffId: borrower.sub?.startsWith("staff") ? (borrower.id as never) : undefined,
              days: Number(days),
            });
            setBorrower(null);
            toast.success("Book issued");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not issue book");
          }
        }}
      >
        Issue
      </Button>
    </div>
  );
}

function MyLoansCard({
  loans,
}: {
  loans: Array<{ title: string; copyNumber: string; issueDate: string; dueDate: string; status: string; fineAmount: number; returnDate: string | null }>;
}) {
  return (
    <Card className="self-start">
      <CardHeader className="pb-2"><CardTitle className="text-base">My loans</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {loans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No loans for your account.</p>
        ) : (
          loans.map((l, i) => (
            <div key={i} className="rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{l.title}</span>
                <Pill tone={statusTone(l.status)}>{l.status}</Pill>
              </div>
              <p className="text-xs text-muted-foreground">copy {l.copyNumber} · due {l.dueDate}{l.returnDate ? ` · returned ${l.returnDate}` : ""}</p>
              {l.fineAmount > 0 ? <p className="text-xs text-rose-600 dark:text-rose-400">Fine: {money(l.fineAmount)}</p> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AddBookDialog() {
  const createBook = useMutation(api.library.createBook);
  const categories = useQuery(api.library.listCategories, {});
  return (
    <FormDialog
      title="New book"
      trigger={<Button size="sm"><Plus />Add book</Button>}
      onSubmit={async (data) => {
        await createBook({
          title: data.title, author: data.author || undefined, isbn: data.isbn || undefined,
          categoryId: (data.categoryId || undefined) as never, publisher: data.publisher || undefined,
          location: data.location || undefined, copyCount: Number(data.copyCount || "0"),
        });
        toast.success("Book added to catalogue");
      }}
    >
      {(set) => (
        <>
          <Field label="Title"><Input onChange={(e) => set("title", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Author"><Input onChange={(e) => set("author", e.target.value)} /></Field>
            <Field label="ISBN"><Input onChange={(e) => set("isbn", e.target.value)} /></Field>
          </div>
          <Field label="Category">
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(e) => set("categoryId", e.target.value)} defaultValue="">
              <option value="">— none —</option>
              {(categories ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Publisher"><Input onChange={(e) => set("publisher", e.target.value)} /></Field>
            <Field label="Shelf location"><Input onChange={(e) => set("location", e.target.value)} /></Field>
          </div>
          <Field label="Number of copies"><Input type="number" min={0} onChange={(e) => set("copyCount", e.target.value)} /></Field>
        </>
      )}
    </FormDialog>
  );
}
