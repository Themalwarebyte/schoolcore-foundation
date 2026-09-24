/**
 * Phase 6 — QR identity, ID cards, biometric attendance foundation, GPS.
 *
 * Identity: opaque random tokens resolve server-side to a permitted view.
 * Biometrics: device references only — no biometric data is ever stored.
 * GPS: extends existing Phase 5 vehicles; pings are school-scoped, with
 * retention pruning via a scheduled job.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requirePermission, getSchoolRecord } from "../session";
import { recordAudit } from "../audit";
import { randomToken } from "./constants";

/* ================================================================== */
/* QR identity + ID cards                                              */
/* ================================================================== */

/** Issue (or re-issue) an opaque QR token for a student or staff member. */
export const issueQrToken = mutation({
  args: { subjectKind: v.string(), subjectId: v.id("students") },
  handler: async (ctx, { subjectKind, subjectId }) => {
    const session = await requirePermission(ctx, "qr.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (!["student", "staff"].includes(subjectKind)) throw new ConvexError("Unknown subject kind.");
    if (subjectKind === "student") {
      await getSchoolRecord(ctx, schoolId, "students", subjectId);
    }
    // Revoke previous active tokens for this subject (one active token).
    const existing = await ctx.db
      .query("qrTokens")
      .withIndex("by_subject", (q) => q.eq("subjectId", subjectId))
      .collect()
      .then((ts) => ts.filter((t) => t.active));
    for (const t of existing) {
      await ctx.db.patch(t._id, { active: false, revokedAt: Date.now() });
    }
    const token = randomToken();
    const id = await ctx.db.insert("qrTokens", {
      schoolId, subjectKind, subjectId, token, active: true,
      issuedById: session.userId, issuedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "qr.token.issued",
      entityType: "qrTokens", entityId: id,
      description: `QR token issued for ${subjectKind} ${subjectId}`,
    });
    return { qrTokenId: id, token };
  },
});

export const revokeQrToken = mutation({
  args: { qrTokenId: v.id("qrTokens") },
  handler: async (ctx, { qrTokenId }) => {
    const session = await requirePermission(ctx, "qr.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const t = await getSchoolRecord(ctx, schoolId, "qrTokens", qrTokenId);
    await ctx.db.patch(qrTokenId, { active: false, revokedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "qr.token.revoked",
      entityType: "qrTokens", entityId: qrTokenId, description: `QR token revoked (${t.subjectKind})`,
    });
    return true;
  },
});

/** Public lookup by token: returns ONLY permitted identity fields. */
export const resolveQr = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await requirePermission(ctx, "qr.view");
    const schoolId = session.schoolId as Id<"schools">;
    const t = await ctx.db
      .query("qrTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!t || !t.active || t.schoolId !== schoolId) {
      throw new ConvexError("Invalid or revoked QR code.");
    }
    if (t.subjectKind === "student") {
      const s = await ctx.db.get(t.subjectId as Id<"students">);
      if (!s || s.schoolId !== schoolId) throw new ConvexError("Invalid QR code.");
      // Permitted identity view only: no medical, financial or guardian data.
      const section = s.schoolId ? null : null;
      void section;
      return {
        kind: "student" as const,
        name: `${s.firstName} ${s.lastName}`.trim(),
        admissionNumber: s.admissionNumber,
        photoId: s.profilePhotoId ?? null,
      };
    }
    throw new ConvexError("Invalid QR code.");
  },
});

/** ID-card payload for printing (admin/card manager). */
export const studentIdCard = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "qr.view");
    const schoolId = session.schoolId as Id<"schools">;
    const s = await getSchoolRecord(ctx, schoolId, "students", studentId);
    const school = await ctx.db.get(schoolId);
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect()
      .then((es) => es.filter((e) => e.status === "active")[0]);
    const section = enrollment ? await ctx.db.get(enrollment.classSectionId) : null;
    const grade = section ? await ctx.db.get(section.gradeLevelId) : null;
    const qr = await ctx.db
      .query("qrTokens")
      .withIndex("by_subject", (q) => q.eq("subjectId", studentId))
      .collect()
      .then((ts) => ts.find((t) => t.active) ?? null);
    return {
      school: { name: school?.name ?? "", logoFileId: undefined, county: school?.county ?? null },
      student: {
        name: `${s.firstName} ${s.lastName}`.trim(),
        admissionNumber: s.admissionNumber,
        photoId: s.profilePhotoId ?? null,
        classLabel: section ? `${grade?.shortName ?? grade?.name ?? ""} ${section.streamName}`.trim() : "—",
      },
      qrToken: qr?.token ?? null,
    };
  },
});

/* ================================================================== */
/* Biometrics                                                          */
/* ================================================================== */

/** Register a biometric device (admin). Secret stays in env by reference. */
export const registerBiometricDevice = mutation({
  args: { deviceId: v.string(), label: v.string(), location: v.optional(v.string()) },
  handler: async (ctx, { deviceId, label, location }) => {
    const session = await requirePermission(ctx, "biometrics.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_school_key", (q) => q.eq("schoolId", schoolId).eq("key", "biometrics"))
      .first();
    if (flag && !flag.enabled) throw new ConvexError("Biometrics are not enabled for this school.");
    const dup = await ctx.db
      .query("biometricDevices")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .first();
    if (dup) throw new ConvexError("This device is already registered.");
    const id = await ctx.db.insert("biometricDevices", {
      schoolId, deviceId, label, location,
      secretRef: `BIOMETRIC_DEVICE_SECRET_${deviceId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`,
      status: "active", createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "biometric.device.registered",
      entityType: "biometricDevices", entityId: id, description: `Biometric device "${label}" registered`,
    });
    return id;
  },
});

export const listBiometricDevices = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "biometrics.view");
    const rows = await ctx.db
      .query("biometricDevices")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
    // secretRef names are shown; actual secrets never leave the server.
    return rows;
  },
});

/** Enroll a subject on a device: stores the DEVICE's reference only. */
export const enrollBiometric = mutation({
  args: {
    subjectKind: v.string(),
    subjectId: v.id("students"),
    deviceId: v.string(),
    deviceSubjectRef: v.string(),
  },
  handler: async (ctx, { subjectKind, subjectId, deviceId, deviceSubjectRef }) => {
    const session = await requirePermission(ctx, "biometrics.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const device = await ctx.db
      .query("biometricDevices")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .first();
    if (!device || device.schoolId !== schoolId || device.status !== "active") {
      throw new ConvexError("Unknown device for this school.");
    }
    if (subjectKind === "student") await getSchoolRecord(ctx, schoolId, "students", subjectId);
    const dup = await ctx.db
      .query("biometricEnrollments")
      .withIndex("by_device_ref", (q) => q.eq("deviceId", deviceId).eq("deviceSubjectRef", deviceSubjectRef))
      .first();
    if (dup && dup.status === "active") throw new ConvexError("This device reference is already enrolled.");
    const id = await ctx.db.insert("biometricEnrollments", {
      schoolId, subjectKind, subjectId, deviceId, deviceSubjectRef,
      status: "active", enrolledById: session.userId, enrolledAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "biometric.enrolled",
      entityType: "biometricEnrollments", entityId: id,
      description: `Biometric enrollment (${subjectKind}) on device ${deviceId}`,
    });
    return id;
  },
});

export const revokeBiometric = mutation({
  args: { enrollmentId: v.id("biometricEnrollments") },
  handler: async (ctx, { enrollmentId }) => {
    const session = await requirePermission(ctx, "biometrics.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const e = await getSchoolRecord(ctx, schoolId, "biometricEnrollments", enrollmentId);
    await ctx.db.patch(enrollmentId, { status: "revoked", revokedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "biometric.revoked",
      entityType: "biometricEnrollments", entityId: enrollmentId,
      description: `Biometric enrollment revoked on device ${e.deviceId}`,
    });
    return true;
  },
});

/**
 * Device event ingestion (called from the HTTP router with a device secret).
 * Resolves the device → subject → creates an EXISTING attendance record.
 * Duplicate events (same device+ref within 60s) are marked duplicate.
 */
export const ingestDeviceEventInternal = internalMutation({
  args: {
    deviceId: v.string(),
    deviceSubjectRef: v.string(),
    eventType: v.string(),
    eventAt: v.number(),
    deviceSecret: v.string(),
  },
  handler: async (ctx, { deviceId, deviceSubjectRef, eventType, eventAt, deviceSecret }) => {
    // Device authentication: secret lives in env; name is stored server-side.
    const device = await ctx.db
      .query("biometricDevices")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .first();
    if (!device || device.status !== "active") return { ok: false as const, reason: "unknown_device" };
    const expected = process.env[device.secretRef];
    if (!expected || expected !== deviceSecret) return { ok: false as const, reason: "bad_secret" };
    const schoolId = device.schoolId;

    if (!["attendance_in", "attendance_out"].includes(eventType)) {
      return { ok: false as const, reason: "bad_event" };
    }

    // 60-second duplicate window per device+ref+event.
    const recent = await ctx.db
      .query("deviceEvents")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .collect()
      .then((es) =>
        es.find(
          (e) =>
            e.deviceSubjectRef === deviceSubjectRef &&
            e.eventType === eventType &&
            Math.abs(e.eventAt - eventAt) < 60_000,
        ),
      );
    const enrollment = await ctx.db
      .query("biometricEnrollments")
      .withIndex("by_device_ref", (q) => q.eq("deviceId", deviceId).eq("deviceSubjectRef", deviceSubjectRef))
      .collect()
      .then((es) => es.find((e) => e.status === "active"));
    if (!enrollment || enrollment.schoolId !== schoolId) {
      return { ok: false as const, reason: "not_enrolled" };
    }

    if (recent) {
      await ctx.db.insert("deviceEvents", {
        schoolId, deviceId, deviceSubjectRef, eventType, eventAt,
        processed: true, duplicate: true, receivedAt: Date.now(),
      });
      return { ok: true as const, duplicate: true as const };
    }

    // Create the attendance record through the EXISTING attendance tables.
    // A biometric event maps to a daily "present" session record for today.
    const today = new Date(eventAt).toISOString().slice(0, 10);
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ss) =>
        ss.find(
          (s) =>
            s.sessionType === "daily" && s.sessionDate === today &&
            (s as { classSectionId?: Id<"classSections"> }).classSectionId !== undefined,
        ),
      );
    let attendanceId: Id<"attendanceRecords"> | undefined;
    if (sessions) {
      attendanceId = await ctx.db.insert("attendanceRecords", {
        schoolId,
        sessionId: sessions._id,
        studentId: enrollment.subjectId as Id<"students">,
        status: "present",
        recordedById: device.lastSeenAt ? enrollment.enrolledById : enrollment.enrolledById,
        recordedAt: Date.now(),
        source: "biometric",
      } as never);
    }
    await ctx.db.insert("deviceEvents", {
      schoolId, deviceId, deviceSubjectRef, eventType, eventAt,
      processed: attendanceId !== undefined, processedAttendanceId: attendanceId,
      duplicate: false, receivedAt: Date.now(),
    });
    await ctx.db.patch(device._id, { lastSeenAt: Date.now() });
    return { ok: true as const, duplicate: false as const, attendanceId: attendanceId ?? null };
  },
});

/* ================================================================== */
/* Transport GPS                                                       */
/* ================================================================== */

/** Attach a GPS device to an existing Phase 5 vehicle. */
export const registerGpsDevice = mutation({
  args: { vehicleId: v.id("vehicles"), deviceId: v.string(), provider: v.string() },
  handler: async (ctx, { vehicleId, deviceId, provider }) => {
    const session = await requirePermission(ctx, "gps.manage");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "vehicles", vehicleId);
    const dup = await ctx.db
      .query("gpsDevices")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .first();
    if (dup) throw new ConvexError("This GPS device is already registered.");
    const id = await ctx.db.insert("gpsDevices", {
      schoolId, vehicleId, deviceId, provider, status: "active",
      secretRef: `GPS_DEVICE_SECRET_${deviceId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "gps.device.registered",
      entityType: "gpsDevices", entityId: id, description: `GPS device attached to vehicle`,
    });
    return id;
  },
});

/** Ingest a location ping (HTTP router; authenticated by device secret). */
export const ingestPingInternal = internalMutation({
  args: {
    deviceId: v.string(),
    lat: v.number(),
    lng: v.number(),
    speedKph: v.optional(v.number()),
    heading: v.optional(v.number()),
    recordedAt: v.number(),
    deviceSecret: v.string(),
  },
  handler: async (ctx, { deviceId, lat, lng, speedKph, heading, recordedAt, deviceSecret }) => {
    const device = await ctx.db
      .query("gpsDevices")
      .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
      .first();
    if (!device || device.status !== "active") return { ok: false as const, reason: "unknown_device" };
    const expected = process.env[device.secretRef];
    if (!expected || expected !== deviceSecret) return { ok: false as const, reason: "bad_secret" };
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { ok: false as const, reason: "bad_coords" };
    await ctx.db.insert("gpsPings", {
      schoolId: device.schoolId, gpsDeviceId: device._id, vehicleId: device.vehicleId,
      lat, lng, speedKph, heading, recordedAt, receivedAt: Date.now(),
    });
    await ctx.db.patch(device._id, { lastSeenAt: Date.now() });
    return { ok: true as const };
  },
});

/** Parent transport view: only vehicles serving their children's route. */
export const parentTransportView = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "gps.view");
    const schoolId = session.schoolId as Id<"schools">;
    if (session.role.role !== "parent" && session.role.role !== "school_admin" && session.role.role !== "principal") {
      throw new ConvexError("Permission denied.");
    }
    let studentIds: Id<"students">[] = [];
    if (session.role.role === "parent") {
      const link = await ctx.db
        .query("guardianPortalLinks")
        .withIndex("by_user", (q) => q.eq("userId", session.userId))
        .first();
      if (!link) return [];
      const children = await ctx.db
        .query("guardianStudents")
        .withIndex("by_guardian", (q) => q.eq("guardianId", link.guardianId))
        .collect();
      studentIds = children.map((c) => c.studentId as Id<"students">);
    }
    const out = [];
    for (const studentId of studentIds) {
      const assignments = await ctx.db
        .query("transportAssignments")
        .withIndex("by_student", (q) => q.eq("studentId", studentId))
        .collect()
        .then((as) => as.filter((a) => a.status === "active"));
      for (const a of assignments) {
        const route = await ctx.db.get(a.routeId);
        const vehicle = a.vehicleId ? await ctx.db.get(a.vehicleId) : null;
        const stop = a.stopId ? await ctx.db.get(a.stopId) : null;
        const gps = vehicle
          ? await ctx.db.query("gpsDevices").withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicle._id)).first()
          : null;
        const latestPing = gps
          ? await ctx.db
              .query("gpsPings")
              .withIndex("by_vehicle_time", (q) => q.eq("vehicleId", vehicle!._id))
              .order("desc")
              .take(1)
              .then((ps) => ps[0] ?? null)
          : null;
        out.push({
          studentId,
          route: route ? { name: route.name } : null,
          stop: stop ? { name: stop.stopName, pickupTime: stop.pickupTime } : null,
          vehicle: vehicle ? { registrationNumber: vehicle.registrationNumber } : null,
          gpsEnabled: !!gps?.status && gps.status === "active",
          location: latestPing
            ? { lat: latestPing.lat, lng: latestPing.lng, at: latestPing.recordedAt }
            : null,
        });
      }
    }
    return out;
  },
});

/** GPS retention: prune pings older than the retention window (default 30d). */
export const pruneOldPingsInternal = internalMutation({
  args: { olderThanMs: v.optional(v.number()) },
  handler: async (ctx, { olderThanMs }) => {
    const cutoff = Date.now() - (olderThanMs ?? 30 * 24 * 3600 * 1000);
    const old = await ctx.db
      .query("gpsPings")
      .withIndex("by_recorded", (q) => q.lt("recordedAt", cutoff))
      .take(500);
    for (const p of old) await ctx.db.delete(p._id);
    return { pruned: old.length };
  },
});

void internalMutation;
