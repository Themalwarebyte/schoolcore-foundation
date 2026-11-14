import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/hooks/use-session";
import { PageHeader } from "@/components/layouts/school-layout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { CheckCircle2, ShieldAlert } from "lucide-react";

export default function OpeningBalanceReview() {
  const {role,session}=useSession();
  const authorized=(role==="accountant"||role==="school_admin")&&!session?.isSuperAdmin;
  const jobs=useQuery(api.phase7.schoolWorkbook.pendingOpeningBalances,authorized?{}:"skip");
  const approve=useMutation(api.phase7.schoolWorkbook.approveOpeningBalances);
  const [busy,setBusy]=useState<string|null>(null);
  if(!authorized) return <div className="page-shell"><ShieldAlert className="size-7"/><p>School finance access required.</p></div>;
  return <div className="page-shell space-y-5">
    <PageHeader title="Opening balances — finance review" description="Unverified historical balances need a separate accountant's approval before they affect student accounts."/>
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">An imported historical balance is not evidence of a bank credit. No M-Pesa, Standard Chartered transaction, receipt or invoice is generated from this review.</p>
    </div>
    {jobs===undefined?<p>Loading reviews...</p>:jobs.length===0?<p className="rounded-xl border p-6 text-sm text-muted-foreground">No balances awaiting review.</p>:jobs.map(job=><section key={job._id} className="rounded-xl border bg-card p-5">
      <h3 className="font-semibold">{job.rowsTotal} historical opening balances</h3>
      <div className="mt-3 max-h-60 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="p-2">Admission</th><th className="p-2">Invoiced (KES)</th><th className="p-2">Previously paid</th><th className="p-2">Outstanding</th></tr></thead><tbody>{job.stagedRows.map((r,i)=><tr className="border-t" key={i}><td className="p-2">{r.admissionNumber}</td><td className="p-2">{r.invoicedKES}</td><td className="p-2">{r.previouslyPaidKES}</td><td className="p-2 font-semibold">{r.openingBalanceKES}</td></tr>)}</tbody></table></div>
      <div className="mt-4 flex items-center justify-between"><p className="text-xs text-muted-foreground">Independent review required; the original uploader cannot self-approve.</p><Button disabled={role!=="accountant"||Boolean(busy)} onClick={async()=>{
        if(!window.confirm("Approve these historical opening balances? Verify supporting finance records first."))return;
        setBusy(String(job._id));try{await approve({jobId:job._id});toast.success("Opening balances approved and audited.");}catch(e){toast.error(friendlyError(e));}finally{setBusy(null)}
      }}><CheckCircle2 className="size-4"/> Approve reviewed balances</Button></div>
    </section>)}
  </div>;
}
