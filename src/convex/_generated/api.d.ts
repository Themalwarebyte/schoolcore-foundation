/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as academicOps from "../academicOps.js";
import type * as academics from "../academics.js";
import type * as access from "../access.js";
import type * as accounts from "../accounts.js";
import type * as allocations from "../allocations.js";
import type * as announcements from "../announcements.js";
import type * as assessments from "../assessments.js";
import type * as assignments from "../assignments.js";
import type * as attendance from "../attendance.js";
import type * as audit from "../audit.js";
import type * as auditLogs from "../auditLogs.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as auth_freebuff from "../auth/freebuff.js";
import type * as boarding from "../boarding.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as diagnostics from "../diagnostics.js";
import type * as emailProvider from "../emailProvider.js";
import type * as engines_results from "../engines/results.js";
import type * as engines_timetable from "../engines/timetable.js";
import type * as enrollments from "../enrollments.js";
import type * as feeStructures from "../feeStructures.js";
import type * as finance from "../finance.js";
import type * as financeOps from "../financeOps.js";
import type * as grading from "../grading.js";
import type * as guardians from "../guardians.js";
import type * as hr from "../hr.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as library from "../library.js";
import type * as marks from "../marks.js";
import type * as medical from "../medical.js";
import type * as notify from "../notify.js";
import type * as payroll from "../payroll.js";
import type * as phase6_ai from "../phase6/ai.js";
import type * as phase6_automations from "../phase6/automations.js";
import type * as phase6_communications from "../phase6/communications.js";
import type * as phase6_constants from "../phase6/constants.js";
import type * as phase6_identity from "../phase6/identity.js";
import type * as phase6_imports from "../phase6/imports.js";
import type * as phase6_integrations from "../phase6/integrations.js";
import type * as phase6_observability from "../phase6/observability.js";
import type * as phase6_payments from "../phase6/payments.js";
import type * as phase6_saas from "../phase6/saas.js";
import type * as phase6_scheduled from "../phase6/scheduled.js";
import type * as phase7_access from "../phase7/access.js";
import type * as phase7_admissions from "../phase7/admissions.js";
import type * as phase7_bankPosting from "../phase7/bankPosting.js";
import type * as phase7_billing from "../phase7/billing.js";
import type * as phase7_imports from "../phase7/imports.js";
import type * as phase7_invitations from "../phase7/invitations.js";
import type * as phase7_inviteCore from "../phase7/inviteCore.js";
import type * as phase7_inviteTokens from "../phase7/inviteTokens.js";
import type * as phase7_meals from "../phase7/meals.js";
import type * as phase7_onboarding from "../phase7/onboarding.js";
import type * as phase7_promotions from "../phase7/promotions.js";
import type * as phase7_registration from "../phase7/registration.js";
import type * as platform from "../platform.js";
import type * as portal from "../portal.js";
import type * as procurement from "../procurement.js";
import type * as reportCards from "../reportCards.js";
import type * as results from "../results.js";
import type * as schemaPhase7 from "../schemaPhase7.js";
import type * as schools from "../schools.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";
import type * as seedHelpers from "../seedHelpers.js";
import type * as seedOperations from "../seedOperations.js";
import type * as session from "../session.js";
import type * as staff from "../staff.js";
import type * as students from "../students.js";
import type * as team from "../team.js";
import type * as timetable from "../timetable.js";
import type * as transport from "../transport.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  academicOps: typeof academicOps;
  academics: typeof academics;
  access: typeof access;
  accounts: typeof accounts;
  allocations: typeof allocations;
  announcements: typeof announcements;
  assessments: typeof assessments;
  assignments: typeof assignments;
  attendance: typeof attendance;
  audit: typeof audit;
  auditLogs: typeof auditLogs;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  "auth/freebuff": typeof auth_freebuff;
  boarding: typeof boarding;
  crons: typeof crons;
  dashboard: typeof dashboard;
  diagnostics: typeof diagnostics;
  emailProvider: typeof emailProvider;
  "engines/results": typeof engines_results;
  "engines/timetable": typeof engines_timetable;
  enrollments: typeof enrollments;
  feeStructures: typeof feeStructures;
  finance: typeof finance;
  financeOps: typeof financeOps;
  grading: typeof grading;
  guardians: typeof guardians;
  hr: typeof hr;
  http: typeof http;
  inventory: typeof inventory;
  library: typeof library;
  marks: typeof marks;
  medical: typeof medical;
  notify: typeof notify;
  payroll: typeof payroll;
  "phase6/ai": typeof phase6_ai;
  "phase6/automations": typeof phase6_automations;
  "phase6/communications": typeof phase6_communications;
  "phase6/constants": typeof phase6_constants;
  "phase6/identity": typeof phase6_identity;
  "phase6/imports": typeof phase6_imports;
  "phase6/integrations": typeof phase6_integrations;
  "phase6/observability": typeof phase6_observability;
  "phase6/payments": typeof phase6_payments;
  "phase6/saas": typeof phase6_saas;
  "phase6/scheduled": typeof phase6_scheduled;
  "phase7/access": typeof phase7_access;
  "phase7/admissions": typeof phase7_admissions;
  "phase7/bankPosting": typeof phase7_bankPosting;
  "phase7/billing": typeof phase7_billing;
  "phase7/imports": typeof phase7_imports;
  "phase7/invitations": typeof phase7_invitations;
  "phase7/inviteCore": typeof phase7_inviteCore;
  "phase7/inviteTokens": typeof phase7_inviteTokens;
  "phase7/meals": typeof phase7_meals;
  "phase7/onboarding": typeof phase7_onboarding;
  "phase7/promotions": typeof phase7_promotions;
  "phase7/registration": typeof phase7_registration;
  platform: typeof platform;
  portal: typeof portal;
  procurement: typeof procurement;
  reportCards: typeof reportCards;
  results: typeof results;
  schemaPhase7: typeof schemaPhase7;
  schools: typeof schools;
  search: typeof search;
  seed: typeof seed;
  seedHelpers: typeof seedHelpers;
  seedOperations: typeof seedOperations;
  session: typeof session;
  staff: typeof staff;
  students: typeof students;
  team: typeof team;
  timetable: typeof timetable;
  transport: typeof transport;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
