import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useNavigate, useParams } from "react-router";
import { PageHeader } from "@/components/layouts/school-layout";
import { StatusBadge } from "@/lib/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, UserRound, Phone, Mail, BadgeCheck } from "lucide-react";

export default function StaffProfile() {
  const { staffId } = useParams();
  const navigate = useNavigate();
  const member = useQuery(api.staff.get, staffId ? { staffId: staffId as never } : "skip");

  if (member === undefined) {
    return <div className="page-shell"><div className="h-40 animate-pulse rounded-xl bg-muted" /></div>;
  }
  if (member === null) {
    return <div className="page-shell"><p className="text-sm text-muted-foreground">Staff member not found.</p></div>;
  }

  const fullName = [member.firstName, member.middleName, member.lastName].filter(Boolean).join(" ");

  return (
    <div className="page-shell">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate("/staff")}>
        <ArrowLeft className="size-4" /> All staff
      </Button>

      <div className="card-soft mb-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
            {member.firstName[0]}{member.lastName[0]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{fullName}</h1>
              <StatusBadge status={member.employmentStatus} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {member.jobTitle ?? "Staff"} · {member.department ?? "Unassigned"} · {member.employeeNumber}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="card-soft">
          <CardHeader><CardTitle className="text-base">Personal details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><UserRound className="size-4 text-muted-foreground" /> Gender: {member.gender ?? "—"}</div>
            <div className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" /> {member.phone ?? "—"}</div>
            <div className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" /> {member.email ?? "—"}</div>
          </CardContent>
        </Card>

        <Card className="card-soft">
          <CardHeader><CardTitle className="text-base">Employment</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Employee number</span><span>{member.employeeNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{member.employmentType?.replace("_", " ") ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Hire date</span><span>{member.hireDate ?? "—"}</span></div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">User account</span>
              {member.userEmail ? (
                <Badge variant="secondary" className="gap-1"><BadgeCheck className="size-3" /> {member.userEmail}</Badge>
              ) : (
                <span className="text-muted-foreground">Not linked</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="card-soft mt-4">
        <CardHeader><CardTitle className="text-base">Teaching assignments</CardTitle></CardHeader>
        <CardContent>
          {member.allocations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No teaching assignments. Assign this teacher from the Teacher Allocations page.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Academic year</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {member.allocations.map((a) => (
                  <TableRow key={a._id}>
                    <TableCell>{a.subjectName}</TableCell>
                    <TableCell>{a.classLabel}</TableCell>
                    <TableCell>{a.yearName}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
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
