import { SchoolLayout } from "@/components/layouts/school-layout";
import { PlatformLayout } from "@/components/layouts/platform-layout";
import { PortalLayout } from "@/components/layouts/portal-layout";
import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Students = lazy(() => import("./pages/Students.tsx"));
const StudentProfile = lazy(() => import("./pages/StudentProfile.tsx"));
const Guardians = lazy(() => import("./pages/Guardians.tsx"));
const GuardianProfile = lazy(() => import("./pages/GuardianProfile.tsx"));
const Staff = lazy(() => import("./pages/Staff.tsx"));
const StaffProfile = lazy(() => import("./pages/StaffProfile.tsx"));
const AcademicYears = lazy(() => import("./pages/academics/Years.tsx"));
const Terms = lazy(() => import("./pages/academics/Terms.tsx"));
const GradeLevels = lazy(() => import("./pages/academics/Grades.tsx"));
const ClassSections = lazy(() => import("./pages/academics/Classes.tsx"));
const Subjects = lazy(() => import("./pages/academics/Subjects.tsx"));
const Allocations = lazy(() => import("./pages/academics/Allocations.tsx"));
const Users = lazy(() => import("./pages/Users.tsx"));
const Roles = lazy(() => import("./pages/Roles.tsx"));
const AuditLogs = lazy(() => import("./pages/AuditLogs.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const Attendance = lazy(() => import("./pages/ops/Attendance.tsx"));
const Timetable = lazy(() => import("./pages/ops/Timetable.tsx"));
const Assignments = lazy(() => import("./pages/ops/Assignments.tsx"));
const Assessments = lazy(() => import("./pages/ops/Assessments.tsx"));
const Grading = lazy(() => import("./pages/ops/Grading.tsx"));
const Results = lazy(() => import("./pages/ops/Results.tsx"));
const ReportCards = lazy(() => import("./pages/ops/ReportCards.tsx"));
const ReportCardView = lazy(() => import("./pages/ops/ReportCardView.tsx"));
const Analytics = lazy(() => import("./pages/ops/Analytics.tsx"));
const AcademicSettings = lazy(() => import("./pages/ops/AcademicSettings.tsx"));
const FinanceDashboard = lazy(() => import("./pages/finance/FinanceDashboard.tsx"));
const Fees = lazy(() => import("./pages/finance/Fees.tsx"));
const Invoices = lazy(() => import("./pages/finance/Invoices.tsx"));
const Payments = lazy(() => import("./pages/finance/Payments.tsx"));
const Accounts = lazy(() => import("./pages/finance/Accounts.tsx"));
const Discounts = lazy(() => import("./pages/finance/Discounts.tsx"));
const Expenses = lazy(() => import("./pages/finance/Expenses.tsx"));
const Reports = lazy(() => import("./pages/finance/Reports.tsx"));
const PlatformDashboard = lazy(() => import("./pages/platform/PlatformDashboard.tsx"));
const PlatformSchools = lazy(() => import("./pages/platform/Schools.tsx"));
const PlatformUsers = lazy(() => import("./pages/platform/PlatformUsers.tsx"));
const PlatformActivity = lazy(() => import("./pages/platform/Activity.tsx"));
// Phase 4: portals
const ParentDashboard = lazy(() => import("./pages/portal/ParentDashboard.tsx"));
const ChildAttendance = lazy(() => import("./pages/portal/ChildViews.tsx").then((m) => ({ default: m.ChildAttendance })));
const ChildResults = lazy(() => import("./pages/portal/ChildViews.tsx").then((m) => ({ default: m.ChildResults })));
const ChildReportCards = lazy(() => import("./pages/portal/ChildViews.tsx").then((m) => ({ default: m.ChildReportCards })));
const ChildAssignments = lazy(() => import("./pages/portal/ChildViews.tsx").then((m) => ({ default: m.ChildAssignments })));
const ChildTimetable = lazy(() => import("./pages/portal/ChildViews.tsx").then((m) => ({ default: m.ChildTimetable })));
const ChildFees = lazy(() => import("./pages/portal/ChildViews.tsx").then((m) => ({ default: m.ChildFees })));
const StudentDashboard = lazy(() => import("./pages/portal/StudentViews.tsx"));
const StudentAttendance = lazy(() => import("./pages/portal/StudentViews.tsx").then((m) => ({ default: m.StudentAttendance })));
const StudentResults = lazy(() => import("./pages/portal/StudentViews.tsx").then((m) => ({ default: m.StudentResults })));
const StudentReportCards = lazy(() => import("./pages/portal/StudentViews.tsx").then((m) => ({ default: m.StudentReportCards })));
const StudentAssignments = lazy(() => import("./pages/portal/StudentViews.tsx").then((m) => ({ default: m.StudentAssignments })));
const StudentTimetable = lazy(() => import("./pages/portal/StudentViews.tsx").then((m) => ({ default: m.StudentTimetable })));
const PortalAnnouncements = lazy(() => import("./pages/portal/PortalShared.tsx").then((m) => ({ default: m.PortalAnnouncements })));
const PortalNotifications = lazy(() => import("./pages/portal/PortalShared.tsx").then((m) => ({ default: m.PortalNotifications })));
const PortalProfile = lazy(() => import("./pages/portal/PortalShared.tsx").then((m) => ({ default: m.PortalProfile })));
const PortalReportCardDetail = lazy(() => import("./pages/portal/PortalShared.tsx").then((m) => ({ default: m.PortalReportCardDetail })));
// Phase 4: admin communication
const PortalAccessAdmin = lazy(() => import("./pages/admin/PortalAccess.tsx"));
const AnnouncementsAdmin = lazy(() => import("./pages/admin/Announcements.tsx"));
// Phase 5: operations ERP
const HR = lazy(() => import("./pages/ops/HR.tsx"));
const Payroll = lazy(() => import("./pages/ops/Payroll.tsx"));
const Library = lazy(() => import("./pages/ops/Library.tsx"));
const Transport = lazy(() => import("./pages/ops/Transport.tsx"));
const Boarding = lazy(() => import("./pages/ops/Boarding.tsx"));
const Inventory = lazy(() => import("./pages/ops/InventoryPage.tsx"));
const Procurement = lazy(() => import("./pages/ops/Procurement.tsx"));
const Medical = lazy(() => import("./pages/ops/Medical.tsx"));
// Phase 7: onboarding, admissions & commercial readiness
const Onboarding = lazy(() => import("./pages/phase7/Onboarding.tsx"));
const Admissions = lazy(() => import("./pages/phase7/Admissions.tsx"));
const Promotions = lazy(() => import("./pages/phase7/Promotions.tsx"));
const Voteheads = lazy(() => import("./pages/phase7/Voteheads.tsx"));
const Reconciliation = lazy(() => import("./pages/phase7/Reconciliation.tsx"));
const BankImports = lazy(() => import("./pages/phase7/BankImports.tsx"));
const Meals = lazy(() => import("./pages/phase7/Meals.tsx"));
const AccessManagement = lazy(() => import("./pages/phase7/AccessManagement.tsx"));
const PlatformSchoolRequests = lazy(() => import("./pages/platform/SchoolRequests.tsx"));
const Activation = lazy(() => import("./pages/phase7/Activation.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              {/* Phase 7: public one-time token flows (invitation activation, password reset) */}
              <Route path="/activate" element={<Activation />} />
              <Route path="/reset-password" element={<Activation />} />

              {/* School administration area */}
              <Route
                element={
                  <RequireAuth>
                    <SchoolLayout />
                  </RequireAuth>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/students" element={<Students />} />
                <Route path="/students/:studentId" element={<StudentProfile />} />
                <Route path="/guardians" element={<Guardians />} />
                <Route path="/guardians/:guardianId" element={<GuardianProfile />} />
                <Route path="/staff" element={<Staff />} />
                <Route path="/staff/:staffId" element={<StaffProfile />} />
                <Route path="/academics/years" element={<AcademicYears />} />
                <Route path="/academics/terms" element={<Terms />} />
                <Route path="/academics/grades" element={<GradeLevels />} />
                <Route path="/academics/classes" element={<ClassSections />} />
                <Route path="/academics/subjects" element={<Subjects />} />
                <Route path="/academics/allocations" element={<Allocations />} />
                <Route path="/users" element={<Users />} />
                <Route path="/roles" element={<Roles />} />
                <Route path="/audit" element={<AuditLogs />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/academic" element={<AcademicSettings />} />
                <Route path="/attendance" element={<Attendance />} />
                <Route path="/timetable" element={<Timetable />} />
                <Route path="/assignments" element={<Assignments />} />
                <Route path="/assessments" element={<Assessments />} />
                <Route path="/grading" element={<Grading />} />
                <Route path="/results" element={<Results />} />
                <Route path="/report-cards" element={<ReportCards />} />
                <Route path="/report-cards/:reportCardId" element={<ReportCardView />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/finance" element={<FinanceDashboard />} />
                <Route path="/finance/fees" element={<Fees />} />
                <Route path="/finance/invoices" element={<Invoices />} />
                <Route path="/finance/payments" element={<Payments />} />
                <Route path="/finance/accounts" element={<Accounts />} />
                <Route path="/finance/discounts" element={<Discounts />} />
                <Route path="/finance/expenses" element={<Expenses />} />
                <Route path="/finance/reports" element={<Reports />} />
                <Route path="/portal-access" element={<PortalAccessAdmin />} />
                <Route path="/announcements" element={<AnnouncementsAdmin />} />
                <Route path="/hr" element={<HR />} />
                <Route path="/payroll" element={<Payroll />} />
                <Route path="/library" element={<Library />} />
                <Route path="/transport" element={<Transport />} />
                <Route path="/boarding" element={<Boarding />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/procurement" element={<Procurement />} />
                <Route path="/medical" element={<Medical />} />
                {/* Phase 7: onboarding, admissions & commercial readiness */}
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/admissions" element={<Admissions />} />
                <Route path="/promotions" element={<Promotions />} />
                <Route path="/finance/voteheads" element={<Voteheads />} />
                <Route path="/finance/reconciliation" element={<Reconciliation />} />
                <Route path="/finance/bank-imports" element={<BankImports />} />
                <Route path="/meals" element={<Meals />} />
                <Route path="/access" element={<AccessManagement />} />
              </Route>

              {/* Parent portal (mobile-first, child-scoped) */}
              <Route
                element={
                  <RequireAuth>
                    <PortalLayout variant="parent" />
                  </RequireAuth>
                }
              >
                <Route path="/portal" element={<ParentDashboard />} />
                <Route path="/portal/:studentId/attendance" element={<ChildAttendance />} />
                <Route path="/portal/:studentId/results" element={<ChildResults />} />
                <Route path="/portal/:studentId/report-cards" element={<ChildReportCards />} />
                <Route path="/portal/:studentId/report-cards/:reportCardId" element={<PortalReportCardDetail />} />
                <Route path="/portal/:studentId/assignments" element={<ChildAssignments />} />
                <Route path="/portal/:studentId/timetable" element={<ChildTimetable />} />
                <Route path="/portal/:studentId/fees" element={<ChildFees />} />
                <Route path="/portal/announcements" element={<PortalAnnouncements />} />
                <Route path="/portal/notifications" element={<PortalNotifications />} />
                <Route path="/portal/profile" element={<PortalProfile />} />
              </Route>

              {/* Student portal (own records only) */}
              <Route
                element={
                  <RequireAuth>
                    <PortalLayout variant="student" />
                  </RequireAuth>
                }
              >
                <Route path="/student" element={<StudentDashboard />} />
                <Route path="/student/attendance" element={<StudentAttendance />} />
                <Route path="/student/results" element={<StudentResults />} />
                <Route path="/student/report-cards" element={<StudentReportCards />} />
                <Route path="/student/report-cards/:reportCardId" element={<PortalReportCardDetail />} />
                <Route path="/student/assignments" element={<StudentAssignments />} />
                <Route path="/student/timetable" element={<StudentTimetable />} />
                <Route path="/student/announcements" element={<PortalAnnouncements />} />
                <Route path="/student/notifications" element={<PortalNotifications />} />
                <Route path="/student/profile" element={<PortalProfile />} />
              </Route>

              {/* Platform super-admin area */}
              <Route
                element={
                  <RequireAuth>
                    <PlatformLayout />
                  </RequireAuth>
                }
              >
                <Route path="/platform" element={<PlatformDashboard />} />
                <Route path="/platform/schools" element={<PlatformSchools />} />
                <Route path="/platform/users" element={<PlatformUsers />} />
                <Route path="/platform/activity" element={<PlatformActivity />} />
                <Route path="/platform/school-requests" element={<PlatformSchoolRequests />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
