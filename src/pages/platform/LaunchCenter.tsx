import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link } from "react-router";
import { PageHeader } from "@/components/layouts/platform-layout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, CircleDashed, Clock3, FolderLock, GraduationCap, LockKeyhole, School, Search, ShieldCheck } from "lucide-react";

type Filter = "all" | "setup" | "active";

export default function LaunchCenter() {
  const schools=useQuery(api.schools.listSchools,{});
  const onboarding=useQuery(api.phase7.onboarding.platformList,{});
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState<Filter>("all");
  const items=useMemo(()=>{
    const normalized=search.trim().toLowerCase();
    return (schools??[]).map(s=>{
      const record=onboarding?.find(r=>r.schoolId===s._id);
      const checks=[record?.profileDone??false,record?.academicsDone??false,record?.usersDone??false,record?.importDone??false];
      return {...s,record,done:checks.filter(Boolean).length,percent:Math.round(checks.filter(Boolean).length/4*100)};
    }).filter(s=>(!normalized||s.name.toLowerCase().includes(normalized)||s.code.toLowerCase().includes(normalized)) && (filter==="all"||(filter==="active"?s.status==="active":s.status!=="active"||s.percent<100)));
  },[schools,onboarding,search,filter]);
  const ready=items.filter(s=>s.status==="active").length;
  return <div className="page-shell space-y-7">
    <PageHeader title="School Launch Center" description="Provision schools, supervise setup and protect school-owned data without viewing individual pupil records." actions={<Button asChild><Link to="/platform/schools"><School className="size-4"/> Manage schools</Link></Button>}/>
    <div className="relative overflow-hidden rounded-[24px] border border-[#cfa85d]/35 bg-gradient-to-r from-[#121a28] via-[#1b2732] to-[#172e32] p-7 text-white shadow-lg sm:p-9">
      <div className="absolute right-0 top-0 size-64 rounded-full bg-[#d2ab5c]/10 blur-3xl"/>
      <div className="relative grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div><p className="text-xs font-bold uppercase tracking-[.24em] text-[#d9b575]">Platform governance</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Set up the school. Let the school own its data.</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-white/65">SchoolCore creates tenants, manages administrator invitations and tracks launch readiness. The school administrator uploads confidential workbook data from within their own school context.</p></div>
        <div className="flex items-center gap-3"><div className="rounded-xl border border-white/15 bg-white/5 px-5 py-4"><p className="text-3xl font-semibold text-[#e9c88b]">{schools?.length??"—"}</p><p className="mt-1 text-xs text-white/60">Schools</p></div><div className="rounded-xl border border-white/15 bg-white/5 px-5 py-4"><p className="text-3xl font-semibold text-[#e9c88b]">{ready}</p><p className="mt-1 text-xs text-white/60">Active in view</p></div></div>
      </div>
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      {[{icon:School,title:"1. Provision",text:"Review school requests, prevent duplicate codes, create a tenant and invite its first administrator.",to:"/platform/school-requests",action:"School requests"},{icon:FolderLock,title:"2. Delegate import",text:"Only the assigned school administrator uploads, previews and confirms school workbook data.",to:"/platform/schools",action:"View tenants"},{icon:ShieldCheck,title:"3. Review launch",text:"Monitor setup status and pilot evidence. Financial and security release gates stay explicit.",to:"/platform/activity",action:"Audit & activity"}].map(item=><div key={item.title} className="group rounded-2xl border bg-card p-6 shadow-sm transition-transform hover:-translate-y-1 hover:shadow-md"><span className="inline-flex size-11 items-center justify-center rounded-xl bg-[#d5ae69]/15 text-[#a67b34]"><item.icon className="size-5"/></span><h3 className="mt-5 font-semibold">{item.title}</h3><p className="mt-2 min-h-20 text-sm leading-6 text-muted-foreground">{item.text}</p><Button asChild variant="outline" size="sm"><Link to={item.to}>{item.action}<ArrowRight className="ml-1 size-4"/></Link></Button></div>)}
    </div>
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-lg font-semibold">School launch pipeline</h3><p className="mt-1 text-sm text-muted-foreground">Progress is based on recorded setup steps; it is not a payment-integration certification.</p></div><div className="flex flex-wrap items-center gap-2"><Button variant={filter==="all"?"default":"outline"} size="sm" onClick={()=>setFilter("all")}>All</Button><Button variant={filter==="setup"?"default":"outline"} size="sm" onClick={()=>setFilter("setup")}>Needs setup</Button><Button variant={filter==="active"?"default":"outline"} size="sm" onClick={()=>setFilter("active")}>Active</Button></div></div>
      <div className="relative mt-5 max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/><Input value={search} onChange={e=>setSearch(e.target.value)} className="pl-10" placeholder="Search school or code"/></div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {schools===undefined||onboarding===undefined?<p className="text-sm text-muted-foreground">Loading school status...</p>:items.length===0?<p className="text-sm text-muted-foreground">No schools match this filter.</p>:items.map(s=><div key={s._id} className="rounded-xl border bg-muted/20 p-5 transition-colors hover:border-[#cda768]/50">
          <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{s.name}</p><p className="mt-1 text-xs text-muted-foreground">{s.code} · {s.country??"Country not set"}</p></div><Badge variant={s.status==="active"?"default":"secondary"} className="capitalize">{s.status}</Badge></div>
          <div className="mt-5 flex items-center justify-between text-xs"><span className="text-muted-foreground">Recorded onboarding steps</span><span className="font-semibold">{s.done} / 4</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-gradient-to-r from-[#bd944f] to-[#e5c381]" style={{width:`${s.percent}%`}}/></div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">{[["Profile",s.record?.profileDone],["Academics",s.record?.academicsDone],["School users",s.record?.usersDone],["Data imported",s.record?.importDone]].map(([label,done])=><span key={String(label)} className="flex items-center gap-1.5 text-muted-foreground">{done?<CheckCircle2 className="size-3.5 text-emerald-600"/>:<CircleDashed className="size-3.5"/>}{String(label)}</span>)}</div>
          <div className="mt-5 flex items-center justify-between"><span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="size-3.5"/> Workbook stays with school</span><Button asChild variant="outline" size="sm"><Link to="/platform/schools">View school <ArrowRight className="size-3.5"/></Link></Button></div>
        </div>)}
      </div>
    </section>
    <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200"><Clock3 className="size-5 shrink-0"/> Financial payment providers, opening balances and full role-isolation regression require independent acceptance; a setup percentage alone cannot mark the school launch-ready.</div>
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><GraduationCap className="size-4"/> No private student lists, guardian names, medical details or balance rows are loaded by this launch center.</div>
  </div>;
}
