import { createContext, useContext, useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession, roleLabel } from "@/hooks/use-session";
import { useAuthActions } from "@convex-dev/auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Home, CalendarCheck, Award, ClipboardList, Clock, Bell, Wallet, UserRound,
  LogOut, Loader2, Megaphone, Menu, X, FileSpreadsheet,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Child-switching context (parent portal)                             */
/* ------------------------------------------------------------------ */

export interface PortalChild {
  studentId: string;
  name: string;
  admissionNumber: string;
  className: string | null;
  relationship: string | null;
}

const ChildContext = createContext<{ children: PortalChild[]; active: PortalChild | null }>({
  children: [],
  active: null,
});

export function usePortalChild() {
  return useContext(ChildContext);
}

/* ------------------------------------------------------------------ */
/* Nav configuration per role                                          */
/* ------------------------------------------------------------------ */

interface PortalNavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PARENT_NAV: PortalNavItem[] = [
  { to: "/portal", label: "Home", icon: Home },
  { to: "/portal/announcements", label: "Announcements", icon: Megaphone },
  { to: "/portal/notifications", label: "Notifications", icon: Bell },
  { to: "/portal/profile", label: "My Profile", icon: UserRound },
];

const STUDENT_NAV: PortalNavItem[] = [
  { to: "/student", label: "Home", icon: Home },
  { to: "/student/announcements", label: "Announcements", icon: Megaphone },
  { to: "/student/notifications", label: "Notifications", icon: Bell },
  { to: "/student/profile", label: "My Profile", icon: UserRound },
];

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function PortalLayout({ variant }: { variant: "parent" | "student" }) {
  const { isLoading, isAuthenticated, session, schoolMembership } = useSession();
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const childrenQuery = useQuery(
    api.portal.parentChildren,
    variant === "parent" ? {} : "skip",
  );

  const isStudent = variant === "student";
  const base = isStudent ? "/student" : "/portal";
  const topNav = isStudent ? STUDENT_NAV : PARENT_NAV;

  const portalChildren: PortalChild[] = (childrenQuery?.children ?? []).map((c) => ({
    studentId: c.studentId,
    name: c.name,
    admissionNumber: c.admissionNumber,
    className: c.className,
    relationship: c.relationship,
  }));

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated || !session) {
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(base)}`} replace />;
  }

  // Cross-portal guard: a student hitting /portal or a parent hitting /student
  // is redirected to their own area instead of triggering server auth errors.
  if (schoolMembership) {
    if (isStudent && schoolMembership.role !== "student" && schoolMembership.role !== "super_admin") {
      return <Navigate to="/portal" replace />;
    }
    if (!isStudent && schoolMembership.role !== "parent" && schoolMembership.role !== "super_admin") {
      return <Navigate to="/student" replace />;
    }
  }
  if (!isStudent && portalChildren.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <UserRound className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">No children linked yet</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your account is not linked to any student records. Please contact the school office.
        </p>
        <Button variant="outline" onClick={async () => { await signOut(); navigate("/"); }}>
          Sign out
        </Button>
      </div>
    );
  }

  const activeChild: PortalChild | null =
    isStudent
      ? null // student portal derives identity server-side
      : portalChildren[0] ?? null;

  return (
    <ChildContext.Provider value={{ children: portalChildren, active: activeChild }}>
      <div className="min-h-screen bg-muted/40">
        {/* Top bar */}
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Home className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">
                  {isStudent ? "Student Portal" : "Parent Portal"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground leading-tight">
                  {session.name ?? session.email}
                </p>
              </div>
            </div>

            {/* Notifications */}
            <NavLink
              to={`${base}/notifications`}
              className="relative rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Notifications"
            >
              <Bell className="size-5" />
              <UnreadBadge />
            </NavLink>

            {/* Account menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Account menu"
                >
                  {(session.name ?? "U").slice(0, 2).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-medium">{session.name ?? "User"}</p>
                  <p className="text-xs font-normal text-muted-foreground">{session.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {roleLabel(isStudent ? "student" : "parent")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={async () => { await signOut(); navigate("/"); }}>
                  <LogOut className="mr-2 size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Mobile nav toggle */}
            <button
              type="button"
              className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>

          {/* Mobile nav drawer */}
          {menuOpen && (
            <nav className="border-t bg-background px-4 py-2 md:hidden">
              {topNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                      isActive ? "bg-accent text-foreground" : "text-muted-foreground",
                    )
                  }
                >
                  <item.icon className="size-4" /> {item.label}
                </NavLink>
              ))}
            </nav>
          )}

          {/* Desktop tab bar */}
          <nav className="hidden border-t bg-background md:block">
            <div className="mx-auto flex max-w-3xl items-center gap-1 px-4">
              {topNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )
                  }
                >
                  <item.icon className="size-4" /> {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        </header>

        <main className="mx-auto max-w-3xl px-4 py-5 pb-24 md:pb-10">
          <Outlet />
        </main>

        {/* Mobile bottom bar */}
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background md:hidden">
          <div className="mx-auto flex max-w-3xl">
            {[
              ...(isStudent ? [] : [{ to: "/portal", label: "Home", icon: Home }]),
              ...(isStudent
                ? [
                    { to: "/student", label: "Home", icon: Home },
                    { to: "/student/attendance", label: "Attendance", icon: CalendarCheck },
                    { to: "/student/results", label: "Results", icon: Award },
                    { to: "/student/assignments", label: "Work", icon: ClipboardList },
                  ]
                : [
                    { to: `/portal/${activeChild?.studentId ?? ""}/attendance`, label: "Attendance", icon: CalendarCheck },
                    { to: `/portal/${activeChild?.studentId ?? ""}/results`, label: "Results", icon: Award },
                    { to: `/portal/${activeChild?.studentId ?? ""}/fees`, label: "Fees", icon: Wallet },
                    { to: `/portal/${activeChild?.studentId ?? ""}/report-cards`, label: "Reports", icon: FileSpreadsheet },
                  ]),
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )
                }
              >
                <item.icon className="size-5" /> {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </ChildContext.Provider>
  );
}

function UnreadBadge() {
  const notifications = useQuery(api.portal.listNotifications, { limit: 50 });
  const unread = notifications?.unread ?? 0;
  if (unread === 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
      {unread > 9 ? "9+" : unread}
    </span>
  );
}

/** Page header used across portal pages. */
export function PortalPageHeader({
  title, description, actions,
}: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Loading skeleton shared by portal pages. */
export function PortalSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-40 animate-pulse rounded-xl bg-muted" />
      <div className="h-40 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}

export function usePortalSignOut() {
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  return async () => {
    await signOut();
    navigate("/");
  };
}
