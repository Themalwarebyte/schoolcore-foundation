import { useState } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { useConvexAuth } from "convex/react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GraduationCap, School, Users, CalendarRange, BookOpen, ShieldCheck,
  ArrowRight, Layers, UserCog, ScrollText, Globe, Check,
  Bell, Building2, Send,
} from "lucide-react";

/** Public school registration form — posts to phase7.registration.submitRequest. */
function RegisterSchoolCard() {
  const submit = useMutation(api.phase7.registration.submitRequest);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    schoolName: "", registrationNumber: "", country: "Kenya", county: "",
    schoolType: "", curriculum: "", expectedStudents: "", expectedTeachers: "",
    website: "", email: "", phone: "", contactName: "", contactPosition: "",
    contactEmail: "", contactPhone: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await submit({
        schoolName: form.schoolName,
        registrationNumber: form.registrationNumber || undefined,
        country: form.country || undefined,
        county: form.county || undefined,
        schoolType: form.schoolType || undefined,
        curriculum: form.curriculum || undefined,
        expectedStudents: form.expectedStudents ? Number(form.expectedStudents) : undefined,
        expectedTeachers: form.expectedTeachers ? Number(form.expectedTeachers) : undefined,
        website: form.website || undefined,
        email: form.email,
        phone: form.phone || undefined,
        contactName: form.contactName,
        contactPosition: form.contactPosition || undefined,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone || undefined,
      });
      setDone(true);
      toast.success("Registration request submitted — our team will be in touch.");
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card-soft p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
          <Check className="size-6" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">Request received</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Thank you — our team will review your school's details and reach out to
          <span className="font-medium text-foreground"> {form.contactEmail}</span> with the next steps.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/auth">Sign in to an existing school</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card-soft space-y-5 p-6 sm:p-8">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Building2 className="size-4" /> School information
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rs-name">School name *</Label>
          <Input id="rs-name" required value={form.schoolName} onChange={set("schoolName")} placeholder="Greenfield Academy" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-reg">Registration number</Label>
          <Input id="rs-reg" value={form.registrationNumber} onChange={set("registrationNumber")} placeholder="MOE/2018/001" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-type">School type</Label>
          <Input id="rs-type" value={form.schoolType} onChange={set("schoolType")} placeholder="Primary, Secondary, Mixed…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-county">County / state</Label>
          <Input id="rs-county" value={form.county} onChange={set("county")} placeholder="Nairobi" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-country">Country</Label>
          <Input id="rs-country" value={form.country} onChange={set("country")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-cur">Curriculum</Label>
          <Input id="rs-cur" value={form.curriculum} onChange={set("curriculum")} placeholder="CBC, 8-4-4, IGCSE…" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="rs-students">Students</Label>
            <Input id="rs-students" type="number" min="0" value={form.expectedStudents} onChange={set("expectedStudents")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-teachers">Teachers</Label>
            <Input id="rs-teachers" type="number" min="0" value={form.expectedTeachers} onChange={set("expectedTeachers")} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-web">Website</Label>
          <Input id="rs-web" value={form.website} onChange={set("website")} placeholder="https://…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-email">School email *</Label>
          <Input id="rs-email" required type="email" value={form.email} onChange={set("email")} placeholder="info@school.ac.ke" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-phone">School phone</Label>
          <Input id="rs-phone" value={form.phone} onChange={set("phone")} placeholder="+254 …" />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t pt-5 text-sm font-medium text-muted-foreground">
        <Users className="size-4" /> Contact person
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rs-cname">Full name *</Label>
          <Input id="rs-cname" required value={form.contactName} onChange={set("contactName")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-cpos">Position</Label>
          <Input id="rs-cpos" value={form.contactPosition} onChange={set("contactPosition")} placeholder="Head teacher, Director…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-cemail">Email *</Label>
          <Input id="rs-cemail" required type="email" value={form.contactEmail} onChange={set("contactEmail")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rs-cphone">Phone</Label>
          <Input id="rs-cphone" value={form.contactPhone} onChange={set("contactPhone")} />
        </div>
      </div>

      <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
        <Send className="size-4" /> {busy ? "Submitting…" : "Submit registration request"}
      </Button>
      <p className="text-xs text-muted-foreground">
        By submitting you agree to be contacted about SchoolCore onboarding. Uploads such as
        the registration certificate can be added when our team contacts you.
      </p>
    </form>
  );
}


export default function Landing() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const signIn = !isLoading && isAuthenticated ? "/dashboard" : "/auth";

  const trust = ["School-scoped data", "Role-based access", "Financial audit trails", "Parent & student portals"];
  const capabilities = [
    { icon: School, title: "Admissions that connect", text: "From application and enrollment to class placement, guardian links and secure account activation." },
    { icon: CalendarRange, title: "Academic life, organized", text: "Timetables, attendance, assignments, results and learning progress in one connected workspace." },
    { icon: ScrollText, title: "Financial clarity", text: "Fee structures, invoices, statements, reconciliations and auditable receipts for verified transactions." },
    { icon: ShieldCheck, title: "Privacy by design", text: "School-scoped records with server-side access checks designed to limit data to authorized roles." },
    { icon: Users, title: "Families in the loop", text: "Parents see linked children; students see their own learning, boarding and school updates." },
    { icon: Building2, title: "School-level independence", text: "Platform-wide setup, school-owned imports and configurable operations for each campus." },
  ];
  const flow = ["Create school", "Invite administrator", "Validate school data", "Review permissions", "Activate and monitor"];
  return (
    <div className="schoolcore-landing min-h-screen overflow-hidden bg-[#080b11] text-[#f8f5ee]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#080b11]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="group flex items-center gap-3" aria-label="SchoolCore home">
            <span className="flex size-11 items-center justify-center rounded-2xl border border-[#deb36c]/50 bg-[#d5ad5c]/15 text-[#f0c97b] transition-transform group-hover:rotate-6"><GraduationCap className="size-6"/></span>
            <span className="text-xl font-semibold tracking-[-.04em]">School<span className="text-[#e5bd75]">Core</span><span className="ml-1.5 align-top text-[9px] font-bold tracking-[.18em] text-[#dfba7d]">OS</span></span>
          </Link>
          <nav className="hidden items-center gap-8 text-[13px] font-medium text-white/65 lg:flex">
            {[["#platform","Platform"],["#capabilities","Capabilities"],["#workflow","How it works"],["#portals","Portals"],["#register","Get started"]].map(([href,label])=><a key={href} href={href} className="transition-colors hover:text-[#f2ca83]">{label}</a>)}
          </nav>
          <div className="hidden items-center gap-3 sm:flex"><Link to={signIn} className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:bg-white/10">Sign in</Link><a href="#register" className="rounded-full bg-gradient-to-r from-[#eac681] to-[#c99c49] px-5 py-2.5 text-sm font-bold text-[#12100b] shadow-[0_0_35px_rgba(211,164,85,.16)] transition-transform hover:-translate-y-0.5">Book onboarding <ArrowRight className="ml-1 inline size-4"/></a></div>
          <button type="button" className="rounded-lg border border-white/20 px-3 py-2 text-sm sm:hidden" aria-label="Toggle menu" aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)}>Menu</button>
        </div>
        {menuOpen && <nav className="grid gap-1 border-t border-white/10 bg-[#0e121b] px-5 py-4 text-sm sm:hidden">{[["#capabilities","Capabilities"],["#workflow","How it works"],["#portals","Portals"],["#register","Register"]].map(([href,label])=><a key={href} href={href} onClick={()=>setMenuOpen(false)} className="rounded-lg px-3 py-3 hover:bg-white/10">{label}</a>)}<Link to={signIn} className="rounded-lg px-3 py-3 text-[#f2ca83]">Sign in</Link></nav>}
      </header>

      <main>
        <section className="relative isolate overflow-hidden border-b border-white/10" id="platform">
          <div className="pointer-events-none absolute -left-48 -top-44 size-[650px] rounded-full bg-[#aa8141]/10 blur-[100px]"/>
          <div className="pointer-events-none absolute -right-28 top-24 size-[660px] rounded-full bg-[#325e60]/20 blur-[120px]"/>
          <div className="pointer-events-none absolute inset-0 opacity-15" style={{backgroundImage:"linear-gradient(rgba(226,189,122,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(226,189,122,.12) 1px,transparent 1px)",backgroundSize:"54px 54px",maskImage:"linear-gradient(to bottom,black,transparent 80%)"}}/>
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-20 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:pb-28 lg:pt-28">
            <motion.div initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:.7}}>
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#d9af65]/30 bg-[#d9af65]/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[.22em] text-[#ecc98d]"><span className="size-1.5 animate-pulse rounded-full bg-[#e9bf75]"/> THE CONNECTED SCHOOL PLATFORM</div>
              <h1 className="max-w-2xl text-balance text-[clamp(3.2rem,6vw,6rem)] font-semibold leading-[1.04] tracking-[-.068em]">Every part of your school, <span className="bg-gradient-to-r from-[#fbe2a9] via-[#d8aa5a] to-[#ad8547] bg-clip-text text-transparent">beautifully connected.</span></h1>
              <p className="mt-7 max-w-xl text-base leading-8 text-[#b9c2ce] sm:text-lg">A calmer way to run admissions, academics, boarding, fees and family communication. One secure source of truth for your entire school community.</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row"><a href="#register" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#e1b870] px-7 py-3.5 text-sm font-bold text-[#16110a] transition-all hover:-translate-y-0.5 hover:bg-[#f1d397]">Explore onboarding <ArrowRight className="size-4"/></a><a href="#capabilities" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10">Discover the platform</a></div>
              <div className="mt-11 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-white/60"><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-[#d8af70]"/> Built for multi-school privacy</span><span className="flex items-center gap-2"><Globe className="size-4 text-[#d8af70]"/> Designed for modern schools</span></div>
            </motion.div>
            <motion.div initial={{opacity:0,y:38,scale:.96}} animate={{opacity:1,y:0,scale:1}} transition={{duration:.8,delay:.12}} className="relative">
              <div className="absolute -inset-3 rounded-[32px] bg-gradient-to-br from-[#ecc17d]/20 via-transparent to-[#2e6660]/20 blur-2xl"/>
              <div className="relative overflow-hidden rounded-[27px] border border-[#e0b979]/25 bg-[#141b25] shadow-[0_40px_100px_rgba(0,0,0,.55)]">
                <div className="flex items-center gap-2 border-b border-white/10 bg-[#10161f] px-5 py-4"><span className="size-2.5 rounded-full bg-[#e89c8b]"/><span className="size-2.5 rounded-full bg-[#e7c67b]"/><span className="size-2.5 rounded-full bg-[#84ba9f]"/><span className="ml-auto text-[10px] tracking-[.13em] text-white/40">SCHOOLCORE / COMMAND CENTER</span></div>
                <div className="grid grid-cols-[78px_1fr] sm:grid-cols-[112px_1fr]">
                  <div className="space-y-4 border-r border-white/10 bg-[#0e141d] p-3 sm:p-4"><div className="flex size-9 items-center justify-center rounded-xl bg-[#c99e54]/20 text-[#e3bd75]"><School className="size-5"/></div>{[Layers,CalendarRange,Users,ScrollText,Bell].map((Icon,i)=><div key={i} className={`flex h-9 items-center rounded-lg px-2 ${i===0?"bg-[#d5ad5c]/15 text-[#edc77e]":"text-white/35"}`}><Icon className="size-4"/></div>)}</div>
                  <div className="space-y-5 p-5 sm:p-7"><div className="flex items-center justify-between gap-2"><div><p className="text-[10px] uppercase tracking-[.18em] text-white/45">Welcome back</p><h3 className="mt-1 text-lg font-semibold">School overview</h3></div><span className="rounded-full border border-[#63a694]/40 bg-[#2e8b74]/15 px-2 py-1 text-[10px] text-[#a2e2c8]">Illustrative preview</span></div>
                    <div className="grid grid-cols-2 gap-3">{[{label:"Enrollment",v:"1,248",icon:GraduationCap},{label:"Attendance",v:"96.4%",icon:CalendarRange},{label:"Active staff",v:"68",icon:UserCog},{label:"Portal users",v:"2,150",icon:Users}].map(x=><div key={x.label} className="rounded-xl border border-white/10 bg-[#1b2631] p-3 sm:p-4"><x.icon className="size-4 text-[#d7b275]"/><p className="mt-2 text-xl font-semibold">{x.v}</p><p className="text-[11px] text-white/48">{x.label}</p></div>)}</div>
                    <div className="rounded-xl border border-white/10 bg-[#1a232f] p-4"><div className="mb-4 flex items-center justify-between"><span className="text-xs font-medium">School operations</span><span className="text-[10px] text-[#d7b275]">Live workflow concept</span></div><div className="flex h-32 items-end gap-2">{[37,58,48,76,62,92,71,84,97,81,100,89].map((h,i)=><motion.div key={i} initial={{height:0}} whileInView={{height:`${h}%`}} viewport={{once:true}} transition={{duration:.7,delay:i*.04}} className="flex-1 rounded-t-sm bg-gradient-to-t from-[#99743e] to-[#e1b96c] opacity-80"/>)}</div></div>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-5 -left-5 rounded-2xl border border-[#dcb677]/35 bg-[#111a23]/95 px-4 py-3 shadow-xl backdrop-blur"><p className="text-[10px] uppercase tracking-wider text-[#d7b475]">Role-controlled access</p><p className="mt-1 text-sm font-semibold text-white">Right people. Right information.</p></div>
            </motion.div>
          </div>
          <div className="border-t border-white/10 bg-[#0c111a]/80"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-5 py-5 text-[11px] font-semibold uppercase tracking-[.14em] text-[#a8adba] sm:px-8">{trust.map(t=><span key={t} className="flex items-center gap-2"><Check className="size-3.5 text-[#d3ad68]"/>{t}</span>)}</div></div>
        </section>

        <section id="capabilities" className="bg-[#0b1018] px-5 py-24 sm:px-8"><div className="mx-auto max-w-7xl"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-xs font-bold uppercase tracking-[.26em] text-[#d8b16b]">Purpose-built for education</p><h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-[-.05em] sm:text-5xl">Less admin. More learning.</h2></div><p className="max-w-sm text-sm leading-7 text-white/55">Every department works from the same trusted information, with clear approvals and secure handoffs.</p></div><div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{capabilities.map((c,i)=><motion.div key={c.title} initial={{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{duration:.45,delay:i*.06}} whileHover={{y:-6}} className="group rounded-[22px] border border-white/10 bg-gradient-to-br from-[#1a232c] to-[#10161f] p-7 transition-all hover:border-[#d5ad5c]/40 hover:shadow-[0_18px_60px_rgba(0,0,0,.25)]"><div className="flex size-12 items-center justify-center rounded-2xl border border-[#e2bb75]/20 bg-[#d7ab61]/10 text-[#edc37d]"><c.icon className="size-6"/></div><h3 className="mt-7 text-xl font-semibold">{c.title}</h3><p className="mt-3 text-sm leading-7 text-white/55">{c.text}</p><span className="mt-6 inline-flex items-center gap-1 text-xs font-semibold text-[#ddba7c] transition-transform group-hover:translate-x-1">Connected by design <ArrowRight className="size-3.5"/></span></motion.div>)}</div></div></section>

        <section id="workflow" className="relative border-y border-white/10 bg-[#101720] px-5 py-24 sm:px-8"><div className="mx-auto max-w-7xl"><p className="text-xs font-bold uppercase tracking-[.26em] text-[#d8b16b]">A confident beginning</p><h2 className="mt-4 text-4xl font-semibold tracking-[-.05em] sm:text-5xl">One school. One clear launch path.</h2><p className="mt-5 max-w-2xl text-base leading-8 text-white/60">The platform prepares the tenant. The school administrator owns student data, reviews import errors, and activates their own team when ready.</p><div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{flow.map((s,i)=><div key={s} className="relative rounded-2xl border border-[#d3ad69]/20 bg-[#171e27] p-5"><span className="text-3xl font-semibold text-[#d9b475]/60">{String(i+1).padStart(2,"0")}</span><p className="mt-5 text-sm font-semibold text-white">{s}</p>{i<flow.length-1&&<ArrowRight className="absolute right-3 top-5 size-4 text-[#cda45b]/50"/>}</div>)}</div></div></section>

        <section id="portals" className="bg-[#0b1018] px-5 py-24 sm:px-8"><div className="mx-auto max-w-7xl"><div className="mb-12 flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.26em] text-[#d8b16b]">Built around people</p><h2 className="mt-4 text-4xl font-semibold tracking-[-.05em] sm:text-5xl">One platform. Many perspectives.</h2></div><p className="max-w-sm text-sm leading-7 text-white/55">A tailored experience for every member of the school community.</p></div><div className="grid gap-4 md:grid-cols-3">{[{name:"School leaders",role:"PRINCIPAL & ADMIN",icon:Building2,copy:"Enrollment, approvals, school health and operational visibility."},{name:"Teaching & finance",role:"STAFF & DEPARTMENTS",icon:BookOpen,copy:"Assigned classes, accurate records, controlled billing and workflows."},{name:"Families & students",role:"PARENTS & LEARNERS",icon:Users,copy:"Only their own records, attendance, boarding and school updates."}].map(p=><div key={p.name} className="rounded-[22px] border border-white/10 bg-[#15202b] p-7"><p.icon className="size-7 text-[#ddb875]"/><p className="mt-8 text-[10px] font-semibold uppercase tracking-[.2em] text-[#d4a75e]">{p.role}</p><h3 className="mt-2 text-2xl font-semibold">{p.name}</h3><p className="mt-3 text-sm leading-7 text-white/60">{p.copy}</p></div>)}</div></div></section>

        <section id="register" className="border-t border-[#e7c483]/20 bg-gradient-to-b from-[#151e26] to-[#0b1017] px-5 py-24 sm:px-8"><div className="mx-auto grid max-w-7xl items-start gap-12 lg:grid-cols-[.9fr_1.1fr]"><div><p className="text-xs font-bold uppercase tracking-[.26em] text-[#d8b16b]">Begin your school journey</p><h2 className="mt-4 text-balance text-4xl font-semibold tracking-[-.05em] sm:text-5xl">The best school experience begins with a better system.</h2><p className="mt-6 max-w-lg text-base leading-8 text-white/60">Request onboarding. Our team will help provision your school's secure environment; your administrator remains in control of private school records and imports.</p><div className="mt-9 space-y-4 text-sm text-white/70"><p className="flex items-center gap-2"><Check className="size-4 text-[#e0bd7a]"/> Dedicated school-scoped environment</p><p className="flex items-center gap-2"><Check className="size-4 text-[#e0bd7a]"/> Guided setup and clear approvals</p><p className="flex items-center gap-2"><Check className="size-4 text-[#e0bd7a]"/> Secure, invitation-based accounts</p></div></div><div className="landing-register rounded-[26px] border border-[#e7c483]/20 bg-white p-1 text-[#16202c] shadow-[0_30px_100px_rgba(0,0,0,.3)]"><RegisterSchoolCard/></div></div></section>
      </main>
      <footer className="border-t border-white/10 bg-[#080b11] px-5 py-10 sm:px-8"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 text-xs text-white/50 md:flex-row"><div><span className="text-lg font-semibold text-white">School<span className="text-[#d9af67]">Core</span></span><p className="mt-2">A connected school deserves a connected system.</p></div><div className="flex flex-wrap items-center gap-6"><a href="#capabilities" className="hover:text-white">Capabilities</a><a href="#register" className="hover:text-white">Contact</a><Link to="/auth" className="hover:text-white">Login</Link><span>© {new Date().getFullYear()} SchoolCore</span></div></div></footer>
    </div>
  );
}
