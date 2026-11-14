import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/hooks/use-session";
import { readSchoolWorkbook } from "@/lib/readSchoolWorkbook";
import { validateWorkbook, IMPORT_SHEETS, type SchoolWorkbook } from "@/lib/schoolWorkbookValidation";
import { friendlyError } from "@/lib/errors";
import { PageHeader } from "@/components/layouts/school-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CheckCircle2, Download, FileSpreadsheet, LockKeyhole, UploadCloud } from "lucide-react";

/** School-admin-only pilot import. The backend independently enforces tenancy and role. */
export default function SchoolWorkbookImport() {
  const { role, session, schoolMembership } = useSession();
  const fileRef=useRef<HTMLInputElement>(null);
  const [workbook,setWorkbook]=useState<SchoolWorkbook|null>(null);
  const [filename,setFilename]=useState("");
  const [confirmCode,setConfirmCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [complete,setComplete]=useState(false);
  const schoolAdmin=role==="school_admin" && !session?.isSuperAdmin;
  const local=workbook?validateWorkbook(workbook):null;
  const remote=useQuery(api.phase7.schoolWorkbook.preview,schoolAdmin && workbook && local?.errors.length===0?{sheets:workbook}:"skip");
  const importWorkbook=useMutation(api.phase7.schoolWorkbook.confirm);
  const issues=[...(local?.issues??[]),...(remote?.errors??[])];
  const errors=issues.filter(x=>x.severity==="error");
  const schoolCode=remote?.schoolCode??"";
  const canImport=Boolean(workbook && local?.errors.length===0 && remote?.ready && schoolCode && confirmCode.trim()===schoolCode && !busy && !complete);

  const onFile=async(file:File|undefined)=>{
    if(!file)return;
    setBusy(true);setWorkbook(null);setConfirmCode("");setFilename(file.name);setComplete(false);
    try {
      const parsed=await readSchoolWorkbook(file);
      setWorkbook(parsed);
      const report=validateWorkbook(parsed);
      if(report.errors.length) toast.error(`Workbook needs ${report.errors.length} correction(s). Nothing imported.`);
      else toast.success("Workbook read successfully. Waiting for secure server validation.");
    } catch(error) {toast.error("Could not read workbook",{description:friendlyError(error)});setFilename("");}
    finally {setBusy(false);}
  };

  const downloadErrors=()=>{
    const safe=(x:string)=>`"${(/^[=+@-]/.test(x)?"'":"")+x.replace(/"/g, '""')}"`;
    const csv=["sheet,row,field,severity,message",...issues.map(i=>[i.sheet,String(i.row),i.field,i.severity,i.message].map(safe).join(","))].join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="schoolcore-workbook-errors.csv";link.click();URL.revokeObjectURL(url);
  };

  const commit=async()=>{
    if(!workbook || !canImport) return;
    setBusy(true);
    try {
      const result=await importWorkbook({sheets:workbook,confirmSchoolCode:confirmCode.trim()});
      setComplete(true);
      toast.success(`Imported ${result.students} students, ${result.guardians} guardians and ${result.staff} staff.`);
    } catch(error) {toast.error("Import was blocked; nothing should have been committed",{description:friendlyError(error)});}
    finally{setBusy(false);}
  };

  if(!schoolAdmin) return (
    <div className="page-shell">
      <div className="max-w-2xl rounded-2xl border border-amber-300/50 bg-amber-50 p-8 text-amber-950">
        <LockKeyhole className="mb-3 size-8" />
        <h1 className="text-xl font-semibold">School administrator access required</h1>
        <p className="mt-2 text-sm">Only the school administrator can upload or preview school workbooks. Platform Super Admin accounts cannot access these records.</p>
      </div>
    </div>
  );

  return (
    <div className="page-shell space-y-6">
      <PageHeader title="School workbook onboarding" description="One file. Secure preview. Row-level corrections. Confirm only after every blocking issue is resolved." />
      <div className="rounded-2xl bg-gradient-to-br from-[#12253a] via-[#1d3450] to-[#183b37] p-6 text-white shadow-xl sm:p-8">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.25em] text-[#f4d38c]">School-owned data</p>
            <h2 className="mt-2 text-2xl font-bold">Import and activate with confidence</h2>
            <p className="mt-2 max-w-xl text-sm text-white/75">The school administrator controls upload and review. Neither this page nor its backend exports workbook contents to the platform launch dashboard.</p>
          </div>
          <div className="rounded-xl border border-white/20 bg-white/10 px-5 py-4 text-sm">
            <span className="block text-white/65">Current school</span>
            <strong>{schoolMembership?.schoolName??"Your assigned school"}</strong>
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3"><FileSpreadsheet className="size-6 text-primary"/><h3 className="font-semibold">Upload the standardized Excel workbook</h3></div>
          <p className="mt-2 text-sm text-muted-foreground">Accepted format: SchoolCore .xlsx with 20 data tabs and two guidance/summary tabs. Pilot limit: 200 rows in total, 4 MB.</p>
          <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" aria-label="Select school workbook" onChange={e=>void onFile(e.target.files?.[0])}/>
          <Button className="mt-5" onClick={()=>fileRef.current?.click()} disabled={busy}><UploadCloud className="size-4"/> Choose Excel workbook</Button>
          {filename && <p className="mt-3 text-sm font-medium">{filename}</p>}
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {IMPORT_SHEETS.slice(0,8).map(s=><span key={s} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{s}</span>)}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Staff roles in the workbook are proposed only; login accounts must be invited separately. Historical balances remain pending accountant approval.</p>
        </section>
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="font-semibold">Validation summary</h3>
          <div className="mt-5 flex items-center gap-2">
            <Badge variant={errors.length?"destructive":"secondary"}>{workbook?`${local?.totalRows??0} data rows`:'No file chosen'}</Badge>
            {workbook && <Badge variant={errors.length?"destructive":"default"}>{errors.length} blocking errors</Badge>}
          </div>
          <div className="mt-5 space-y-3 text-sm">
            <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600"/> Cross-sheet keys and relationships checked</p>
            <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600"/> Server checks this school's own records again before commit</p>
            <p className="flex items-start gap-2"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-blue-600"/> No email invites, payments or receipts automatically issued</p>
          </div>
          {workbook && !remote && local?.errors.length===0 && <p className="mt-3 text-xs text-muted-foreground">Waiting for server validation...</p>}
        </section>
      </div>
      {issues.length>0 && <section className="rounded-2xl border border-amber-300/50 bg-amber-50/50 p-5 dark:bg-amber-950/10">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-5 text-amber-600"/> Errors to correct</h3><Button variant="outline" size="sm" onClick={downloadErrors}><Download className="size-4"/> Download error CSV</Button></div>
        <div className="mt-4 max-h-64 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="px-2 py-2">Sheet</th><th className="px-2 py-2">Excel row</th><th className="px-2 py-2">Field</th><th className="px-2 py-2">Issue</th></tr></thead><tbody>{issues.slice(0,80).map((e,i)=><tr key={`${e.sheet}-${e.row}-${i}`} className="border-t"><td className="px-2 py-2">{e.sheet}</td><td className="px-2 py-2">{e.row}</td><td className="px-2 py-2">{e.field}</td><td className="px-2 py-2">{e.message}</td></tr>)}</tbody></table></div>
        <p className="mt-3 text-xs text-muted-foreground">Correct the workbook and upload again. The importer does not silently skip invalid rows.</p>
      </section>}
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Final confirmation</h3>{remote?.ready&&<Badge className="bg-emerald-600">Server validated</Badge>}</div>
        <p className="mt-2 text-sm text-muted-foreground">Confirm the target school by typing its exact school code. This first-release pilot accepts only an empty test tenant; it rejects duplicates and existing school records.</p>
        <div className="mt-4 flex max-w-xl flex-col gap-3 sm:flex-row"><Input aria-label="Confirm school code" placeholder={schoolCode||"School code"} value={confirmCode} onChange={e=>setConfirmCode(e.target.value)}/><Button disabled={!canImport} onClick={()=>void commit()}>Import validated data <ArrowRight className="size-4"/></Button></div>
        {complete&&<p className="mt-3 flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="size-4"/> Import committed. Finance must separately review opening balances and fee structures.</p>}
      </section>
    </div>
  );
}
