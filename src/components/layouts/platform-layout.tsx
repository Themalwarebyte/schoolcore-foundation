import { useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router";
import { useSession, roleLabel } from "@/hooks/use-session";
import { GlobalSearch } from "@/components/global-search";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard, School, Users, ScrollText, ChevronLeft, LogOut, Loader2, Globe, UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthActions } from "@convex-dev/auth/react";

const NAV = [
  { to: "/platform", label: "Platform Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/platform/school-requests", label: "School Requests", icon: UserPlus, exact: false },
  { to: "/platform/schools", label: "Schools", icon: School, exact: false },
  { to: "/platform/users", label: "Platform Users", icon: Users, exact: false },
  { to: "/platform/activity", label: "Audit / Activity", icon: ScrollText, exact: false },
];

export function PlatformLayout() {
  const { isLoading, isAuthenticated, session, schoolMembership } = useSession();
  const { signOut } = useAuthActions();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated || !session) return <Navigate to="/auth" replace />;
  if (!session.isSuperAdmin) return <Navigate to="/dashboard" replace />;

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
            <Globe className="size-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-semibold">SchoolCore</p>
              <p className="text-xs text-muted-foreground">Platform Administration</p>
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
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
                {roleLabel("super_admin")} · Platform
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {schoolMembership && (
                <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                  School dashboard
                </DropdownMenuItem>
              )}
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

/** Page header shared by platform pages. */
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
