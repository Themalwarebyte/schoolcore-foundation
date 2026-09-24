import { Link } from "react-router";
import { motion } from "framer-motion";
import { useConvexAuth } from "convex/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  GraduationCap, School, Users, CalendarRange, BookOpen, ShieldCheck,
  ArrowRight, Layers, UserCog, ScrollText, Globe, Search, Grid3X3, Check,
  Megaphone, Bell,
} from "lucide-react";

const FEATURES = [
  {
    icon: GraduationCap,
    title: "Student records",
    description: "One central record per learner — admission numbers, status history, guardians and enrollment trail.",
  },
  {
    icon: Users,
    title: "Guardian relationships",
    description: "Many-to-many guardian links shared safely between siblings, with primary and emergency contacts.",
  },
  {
    icon: UserCog,
    title: "Staff & teachers",
    description: "Employee records with teaching allocations per class, subject and academic year.",
  },
  {
    icon: CalendarRange,
    title: "Academic structure",
    description: "Years, terms, grade levels and class streams — configured by your school, not hardcoded.",
  },
  {
    icon: Layers,
    title: "Enrollment history",
    description: "Class placements are preserved year over year, so history is never overwritten.",
  },
  {
    icon: ScrollText,
    title: "Audit logs",
    description: "Every important action is recorded permanently — who did what, when, to which record.",
  },
];

const PLATFORM_POINTS = [
  "Create schools and their first administrator",
  "Activate or deactivate schools instantly",
  "Platform-wide statistics and activity feed",
  "Strict tenant isolation between schools",
];

const ROLE_ROWS = [
  { role: "Super Admin", scope: "Platform", color: "bg-violet-500" },
  { role: "School Admin", scope: "Full school control", color: "bg-teal-500" },
  { role: "Principal", scope: "Academic oversight", color: "bg-blue-500" },
  { role: "Teacher", scope: "Classes & subjects", color: "bg-emerald-500" },
  { role: "Accountant", scope: "Finance-ready", color: "bg-amber-500" },
  { role: "Parent", scope: "Portal: children's records & fees", color: "bg-pink-500" },
  { role: "Student", scope: "Portal: own results & homework", color: "bg-sky-500" },
];

export default function Landing() {
  const { isLoading, isAuthenticated } = useConvexAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="size-5" />
            </div>
            <span className="text-lg font-semibold tracking-tight">SchoolCore</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#platform" className="transition-colors hover:text-foreground">Platform</a>
            <a href="#portals" className="transition-colors hover:text-foreground">Portals</a>
            <a href="#roles" className="transition-colors hover:text-foreground">Roles</a>
          </nav>
          <div className="flex items-center gap-2">
            {!isLoading && isAuthenticated ? (
              <Button asChild>
                <Link to="/dashboard">Open dashboard <ArrowRight className="size-4" /></Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" className="hidden sm:inline-flex">
                  <Link to="/auth">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link to="/auth">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, var(--accent) 0%, transparent 70%)",
          }}
        />
        <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-3xl text-center"
          >
            <Badge variant="outline" className="mb-5 gap-1.5 border-primary/30 bg-primary/5 text-primary">
              <ShieldCheck className="size-3.5" /> Multi-school platform · Portals now live
            </Badge>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              The school management system your whole campus runs on
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-muted-foreground">
              Students, staff, academics, finance — and now secure Parent &amp; Student
              portals with attendance, results, report cards and fee statements, all in
              one multi-school platform.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11 px-6">
                <Link to="/auth">
                  Sign in to your school <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-6">
                <a href="#features">Explore features</a>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Accounts are provisioned by your school or platform administrator.
            </p>
          </motion.div>

          {/* Product preview strip */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.15 }}
            className="mx-auto mt-14 max-w-4xl"
          >
            <div className="card-soft overflow-hidden">
              <div className="flex items-center gap-1.5 border-b bg-muted/40 px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-red-400/70" />
                <span className="size-2.5 rounded-full bg-amber-400/70" />
                <span className="size-2.5 rounded-full bg-emerald-400/70" />
                <span className="ml-3 hidden items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-[11px] text-muted-foreground sm:flex">
                  <Search className="size-3" /> schoolcore / dashboard
                </span>
              </div>
              <div className="grid gap-px bg-border sm:grid-cols-4">
                {[
                  { icon: GraduationCap, label: "Total students", value: "812" },
                  { icon: UserCog, label: "Teachers", value: "36" },
                  { icon: Grid3X3, label: "Active classes", value: "24" },
                  { icon: CalendarRange, label: "Current term", value: "Term 1" },
                ].map((c) => (
                  <div key={c.label} className="bg-card p-4 sm:p-5">
                    <c.icon className="size-4 text-muted-foreground" />
                    <p className="mt-3 text-2xl font-semibold tabular-nums">{c.value}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{c.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Everything Phase 1 promises</h2>
            <p className="mt-3 text-muted-foreground">
              Real database-backed functionality — not mockups. Every figure and record
              you see lives in the system.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="card-soft p-6 transition-shadow hover:shadow-md"
              >
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="size-5" />
                </div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Platform */}
      <section id="platform" className="py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <Badge variant="outline" className="mb-4 gap-1.5">
              <Globe className="size-3.5" /> Platform super admin
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight">
              One platform, many independent schools
            </h2>
            <p className="mt-4 text-muted-foreground">
              A dedicated administration layer sits above every school — so a single
              organization can onboard, govern and monitor many campuses without
              ever mixing their data.
            </p>
            <ul className="mt-6 space-y-3">
              {PLATFORM_POINTS.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Check className="size-3 text-primary" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="card-soft p-6">
            <div className="space-y-3">
              {[
                { name: "Greenfield Academy", code: "GRN-001", students: 80, active: true },
                { name: "Riverside School", code: "RVS-002", students: 1, active: true },
                { name: "Hillcrest Junior", code: "HIL-003", students: 212, active: false },
              ].map((s) => (
                <div
                  key={s.code}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <School className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.code} · {s.students} students</p>
                    </div>
                  </div>
                  <Badge variant={s.active ? "default" : "secondary"}>
                    {s.active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Portals */}
      <section id="portals" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <Badge variant="outline" className="mb-4 gap-1.5 border-primary/30 bg-primary/5 text-primary">
              <Bell className="size-3.5" /> Phase 4 · Now live
            </Badge>
            <h2 className="text-3xl font-semibold tracking-tight">Portals for parents and students</h2>
            <p className="mt-3 text-muted-foreground">
              The same records your staff work with — surfaced securely on mobile-first portals.
              No duplicated data, no separate logins to maintain.
            </p>
          </div>
          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4 }}
              className="card-soft p-6 transition-shadow hover:shadow-md"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users className="size-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Parent Portal</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                One account, every child. Switch between children and see live attendance,
                published results and report cards, class timetable, assignments, and a full
                fee statement with downloadable receipts.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {[
                  "Multi-child switcher with per-child dashboards",
                  "Attendance, results & report cards (PDF)",
                  "Invoices, payments & receipts",
                  "School announcements & notifications",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
                  </li>
                ))}
              </ul>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: 0.08 }}
              className="card-soft p-6 transition-shadow hover:shadow-md"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <GraduationCap className="size-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">Student Portal</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Everything a learner needs, scoped strictly to their own record: homework from
                their teachers, their timetable, attendance, and results once published.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {[
                  "Assignments with due dates",
                  "Personal timetable",
                  "Attendance history",
                  "Published results & report cards",
                ].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
          <div className="mx-auto mt-10 flex max-w-xl items-start gap-3 rounded-xl border bg-muted/30 p-4">
            <Megaphone className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Announcements with real targeting.</span>{" "}
              Schools publish to everyone, parents, students, a grade level or a single class —
              portal users see exactly what is meant for them, enforced server-side.
            </p>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Roles built for real schools</h2>
            <p className="mt-3 text-muted-foreground">
              Permissions are enforced on the server for every request — not just hidden in the UI.
            </p>
          </div>
          <div className="mx-auto mt-10 max-w-2xl">
            <div className="card-soft divide-y">
              {ROLE_ROWS.map((r) => (
                <div key={r.role} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <span className={`size-2.5 rounded-full ${r.color}`} />
                    <span className="text-sm font-medium">{r.role}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{r.scope}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Parent and Student portal accounts are provisioned by the school — no public signup, ever.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12">
            <BookOpen className="pointer-events-none absolute -right-6 -top-6 size-40 opacity-10" />
            <h2 className="text-3xl font-semibold tracking-tight">Ready when your school is</h2>
            <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
              Sign in with the credentials from your administrator to explore a fully
              seeded demonstration school.
            </p>
            <Button asChild size="lg" variant="secondary" className="mt-7 h-11 px-6">
              <Link to="/auth">
                Sign in <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <GraduationCap className="size-4" />
            <span>SchoolCore — School Management System</span>
          </div>
          <p>Phases 1–4 · Foundation, Academics, Finance &amp; Portals</p>
        </div>
      </footer>
    </div>
  );
}
