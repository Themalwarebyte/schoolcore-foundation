import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { PageHeader, Can } from "@/components/layouts/school-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScopeBar, ClassSelect, YearSelect, TermSelect } from "@/components/ops/Controls";
import { buildStatementPdf, downloadPdf } from "@/lib/financePdf";
import { Search, Download } from "lucide-react";

export default function Accounts() {
  const [tab, setTab] = useState("balances");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<{ _id: string; label: string } | null>(null);

  const outstanding = useQuery(api.financeOps.outstandingReport, {});
  const classBalances = useQuery(api.financeOps.classBalances, {});

  const students = useQuery(api.students.list, { paginationOpts: { numItems: 200, cursor: null } });
  const filteredStudents = (students?.page ?? [])
    .filter((s) => `${s.firstName} ${s.lastName} ${s.admissionNumber}`.toLowerCase().includes(studentSearch.toLowerCase()))
    .slice(0, 12);

  const statement = useQuery(
    api.finance.accountStatement,
    selectedStudent ? { studentId: selectedStudent._id as never } : "skip",
  );

  const school = useQuery(api.schools.getMySchool, {});
  const currentYear = useQuery(api.academics.academicContext, {});

  const downloadStatement = () => {
    if (!statement || !school) return;
    const doc = buildStatementPdf({
      school: {
        name: school.name, county: school.county ?? null, phone: school.phone ?? null,
        email: school.email ?? null, postalAddress: school.postalAddress ?? null,
      },
      student: statement.student,
      period: `Statement as of ${new Date().toISOString().slice(0, 10)}`,
      openingBalance: statement.account.openingBalance,
      lines: statement.lines,
      closingBalance: statement.closingBalance,
    });
    downloadPdf(doc, `Statement-${statement.student.admissionNumber}.pdf`);
    toast.success("Statement PDF downloaded");
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Student Accounts"
        description="Ledger-derived balances, class summaries and auditable account statements."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="balances">Outstanding balances</TabsTrigger>
          <TabsTrigger value="classes">Class balances</TabsTrigger>
          <TabsTrigger value="statement">Account statement</TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Students with outstanding fees
                {outstanding && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {outstanding.studentsWithBalance} students · {outstanding.totalOutstanding.toLocaleString()} outstanding
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Admission</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(outstanding?.rows ?? []).map((r) => (
                    <TableRow key={r.studentId}>
                      <TableCell className="font-medium">{r.studentName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.admissionNumber}</TableCell>
                      <TableCell className="text-right font-semibold">{r.balance.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => { setSelectedStudent({ _id: r.studentId, label: r.studentName }); setTab("statement"); }}>
                          Statement
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {outstanding && outstanding.rows.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">No outstanding balances.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="classes" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Balances by class</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Discounts</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(classBalances ?? []).map((r) => (
                    <TableRow key={r.classLabel}>
                      <TableCell className="font-medium">{r.classLabel}</TableCell>
                      <TableCell className="text-right">{r.billed.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{r.collected.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{r.discounted.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-semibold">{r.outstanding.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {classBalances && classBalances.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No billing data yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statement" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account statement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Find student</Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="Name or admission no…" className="pl-8" />
                  </div>
                  {studentSearch && filteredStudents.length > 0 && (
                    <div className="mt-2 space-y-1 rounded-md border p-2">
                      {filteredStudents.map((s) => (
                        <button
                          key={s._id}
                          type="button"
                          className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                          onClick={() => {
                            setSelectedStudent({ _id: s._id, label: `${s.firstName} ${s.lastName}` });
                            setStudentSearch("");
                          }}
                        >
                          {s.firstName} {s.lastName} — {s.admissionNumber}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedStudent && (
                    <p className="mt-2 text-sm font-medium">{selectedStudent.label}</p>
                  )}
                </div>
                {statement && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <p className="font-semibold">{statement.student.name} <span className="font-normal text-muted-foreground">({statement.student.admissionNumber})</span></p>
                    <p className="mt-1">Opening balance: {statement.account.openingBalance.toLocaleString()}</p>
                    <p className="font-semibold">Closing balance: {statement.closingBalance.toLocaleString()}</p>
                  </div>
                )}
              </div>

              {statement && (
                <>
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Reference / description</TableHead>
                          <TableHead className="text-right">Debit</TableHead>
                          <TableHead className="text-right">Credit</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {statement.lines.map((l, i) => (
                          <TableRow key={i}>
                            <TableCell>{l.date}</TableCell>
                            <TableCell className="capitalize">{l.type}</TableCell>
                            <TableCell className="text-xs">{l.number}{l.description ? ` — ${l.description}` : ""}</TableCell>
                            <TableCell className="text-right">{l.debit ? l.debit.toLocaleString() : "—"}</TableCell>
                            <TableCell className="text-right">{l.credit ? l.credit.toLocaleString() : "—"}</TableCell>
                            <TableCell className="text-right font-semibold">{l.balance.toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                        {statement.lines.length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No financial activity for this account yet.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <Can permission="receipts.print">
                    <Button onClick={downloadStatement}><Download className="size-4" /> Download statement PDF</Button>
                  </Can>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
