import { useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession, roleLabel, usePermissions } from "@/hooks/use-session";
import { GlobalSearch } from "@/components/global-search";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard, Users, UserRound, GraduationCap, CalendarRange, CalendarDays,
  Layers, Grid3X3, BookOpen, UserCog, KeyRound, ScrollText, Settings, School,
  ChevronLeft, LogOut, Loader2, ShieldAlert, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthActions } from "@convex-dev/auth/react";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: string;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    heading: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
    ],
  },
  {
    heading: "People",
    items: [
      { to: "/students", label: "Students", icon: GraduationCap, permission: "students.view" },
      { to: "/guardians", label: "Guardians", icon: Users, permission: "guardians.view" },
      { to: "/staff", label: "Staff & Teachers", icon: UserRound, permission: "staff.view" },
    ],
  },
  {
    heading: "Academics",
    items: [
      { to: "/academics/years", label: "Academic Years", icon: CalendarRange, permission: "academics.view" },
      { to: "/academics/terms", label: "Terms", icon: CalendarDays, permission: "academics.view" },
      { to: "/academics/grades", label: "Grade Levels", icon: Layers, permission: "academics.view" },
      { to: "/academics/classes", label: "Classes & Streams", icon: Grid3X3, permission: "academics.view" },
      { to: "/academics/subjects", label: "Subjects", icon: BookOpen, permission: "subjects.view" },
      { to: "/academics/allocations", label: "Teacher Allocations", icon: UserCog, permission: "teacher_allocations.view" },
    ],
  },
  {
    heading: "Administration",
    items: [
      { to: "/users", label: "Users", icon: UserCog, permission: "users.view" },
      { to: "/roles", label: "Roles & Permissions", icon: KeyRound, permission: "roles.manage" },
      { to: "/audit", label: "Audit Logs", icon: ScrollText, permission: "audit_logs.view" },
    ],
  },
  {
    heading: "Settings",
    items: [
      { to: "/settings", label: "School Profile", icon: Settings, permission: "settings.view" },
    ],
  },
];

export function SchoolLayout() {
  const { isLoading, isAuthenticated, session, schoolMembership } = useSession();
  const { can } = usePermissions();
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const school = useQuery(
    api.schools.getMySchool,
    schoolMembership?.schoolId ? {} : "skip",
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated || !session) return <Navigate to="/auth" replace />;

  // Super admins without a school context go to the platform area.
  if (session.isSuperAdmin && !schoolMembership) {
    return <Navigate to="/platform" replace />;
  }
  if (!schoolMembership) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <ShieldAlert className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">No school assigned</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Your account is not linked to any school yet. Please contact your administrator.
        </p>
        <Button variant="outline" onClick={async () => { await signOut(); navigate("/"); }}>
          Sign out
        </Button>
      </div>
    );
  }

  const initials = (session.name ?? session.email ?? "U")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <School className="size-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{school?.name ?? "School"}</p>
              <p className="truncate text-xs text-muted-foreground">{roleLabel(schoolMembership.role)}</p>
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((group) => {
            const items = group.items.filter((i) => can(i.permission));
            if (items.length === 0) return null;
            return (
              <div key={group.heading} className="mb-3">
                {!collapsed && (
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.heading}
                  </p>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                          collapsed && "justify-center px-0",
                        )
                      }
                    >
                      <item.icon className="size-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-10 items-center justify-center border-t text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </aside>

      <div className={cn("flex min-h-screen w-full flex-col transition-all duration-200", collapsed ? "pl-16" : "pl-64")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
          <div className="flex-1" />
          <GlobalSearch />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{session.name ?? "User"}</p>
                <p className="text-xs font-normal text-muted-foreground">{session.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {roleLabel(schoolMembership.role)} · {school?.name ?? schoolMembership.schoolName}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => { await signOut(); navigate("/"); }}>
                <LogOut className="mr-2 size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Page header used across the app for consistent spacing and hierarchy. */
export function PageHeader({
  title, description, actions,
}: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Permission gate for inline UI blocks. */
export function Can({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { can } = usePermissions();
  if (!can(permission)) return null;
  return <>{children}</>;
}

export { ClipboardList };
