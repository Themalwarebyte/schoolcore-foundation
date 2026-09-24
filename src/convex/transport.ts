import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

/* ================================================================== */
/* Drivers                                                             */
/* ================================================================== */

export const listDrivers = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "transport.view");
    const schoolId = session.schoolId as Id<"schools">;
    const drivers = await ctx.db
      .query("drivers")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return Promise.all(
      drivers.map(async (d) => {
        const staff = d.staffId ? await ctx.db.get(d.staffId) : null;
        const vehicles = await ctx.db
          .query("vehicles")
          .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
          .collect()
          .then((vs) => vs.filter((v2) => v2.driverId === d._id).map((v2) => v2.registrationNumber));
        return {
          _id: d._id,
          fullName: d.fullName,
          linkedStaffName: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : null,
          phone: d.phone ?? staff?.phone ?? null,
          licenseNumber: d.licenseNumber ?? null,
          licenseExpiry: d.licenseExpiry ?? null,
          isExternal: d.isExternal,
          status: d.status,
          vehicles,
        };
      }),
    );
  },
});

export const createDriver = mutation({
  args: {
    staffId: v.optional(v.id("staff")),
    fullName: v.string(),
    phone: v.optional(v.string()),
    licenseNumber: v.optional(v.string()),
    licenseExpiry: v.optional(v.string()),
  },
  handler: async (ctx, { staffId, fullName, phone, licenseNumber, licenseExpiry }) => {
    const session = await requirePermission(ctx, "transport.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = fullName.trim();
    if (!trimmed) throw new ConvexError("Driver name is required.");
    if (staffId) await getSchoolRecord(ctx, schoolId, "staff", staffId);
    const id = await ctx.db.insert("drivers", {
      schoolId, staffId, fullName: trimmed, phone: phone?.trim(),
      licenseNumber: licenseNumber?.trim(), licenseExpiry,
      isExternal: !staffId, status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "transport.driver.created",
      entityType: "drivers", entityId: id,
      description: `Driver "${trimmed}" (${staffId ? "staff-linked" : "external"}) added`,
    });
    return id;
  },
});

export const updateDriverStatus = mutation({
  args: { driverId: v.id("drivers"), status: v.string() },
  handler: async (ctx, { driverId, status }) => {
    const session = await requirePermission(ctx, "transport.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const d = await getSchoolRecord(ctx, schoolId, "drivers", driverId);
    if (!["active", "inactive"].includes(status)) throw new ConvexError("Unknown driver status.");
    await ctx.db.patch(driverId, { status });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "transport.driver.updated",
      entityType: "drivers", entityId: driverId,
      description: `Driver "${d.fullName}": ${d.status} → ${status}`,
    });
    return driverId;
  },
});

/* ================================================================== */
/* Vehicles                                                            */
/* ================================================================== */

export const listVehicles = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "transport.view");
    const schoolId = session.schoolId as Id<"schools">;
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const routes = await ctx.db
      .query("transportRoutes")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const assignments = await ctx.db
      .query("transportAssignments")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((as) => as.filter((a) => a.status === "active"));
    return Promise.all(
      vehicles.map(async (v2) => {
        const driver = v2.driverId ? await ctx.db.get(v2.driverId) : null;
        const routeIds = routes.filter((r) => r.vehicleId === v2._id).map((r) => r._id);
        return {
          _id: v2._id,
          registrationNumber: v2.registrationNumber,
          vehicleType: v2.vehicleType ?? null,
          capacity: v2.capacity,
          driver: driver ? driver.fullName : null,
          status: v2.status,
          routes: routes.filter((r) => r.vehicleId === v2._id).map((r) => r.name),
          assignedStudents: assignments.filter((a) => routeIds.includes(a.routeId) || a.vehicleId === v2._id).length,
        };
      }),
    );
  },
});

export const createVehicle = mutation({
  args: {
    registrationNumber: v.string(),
    vehicleType: v.optional(v.string()),
    capacity: v.number(),
    driverId: v.optional(v.id("drivers")),
  },
  handler: async (ctx, { registrationNumber, vehicleType, capacity, driverId }) => {
    const session = await requirePermission(ctx, "transport.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const reg = registrationNumber.trim().toUpperCase();
    if (!reg) throw new ConvexError("Registration number is required.");
    if (!(capacity > 0)) throw new ConvexError("Capacity must be positive.");
    const dup = await ctx.db
      .query("vehicles")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((vs) => vs.find((v2) => v2.registrationNumber === reg));
    if (dup) throw new ConvexError("A vehicle with this registration already exists.");
    if (driverId) await getSchoolRecord(ctx, schoolId, "drivers", driverId);
    const id = await ctx.db.insert("vehicles", {
      schoolId, registrationNumber: reg, vehicleType: vehicleType?.trim(), capacity, driverId, status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "transport.vehicle.created",
      entityType: "vehicles", entityId: id,
      description: `Vehicle ${reg} (capacity ${capacity}) added`,
    });
    return id;
  },
});

export const updateVehicle = mutation({
  args: { vehicleId: v.id("vehicles"), driverId: v.optional(v.id("drivers")), status: v.optional(v.string()) },
  handler: async (ctx, { vehicleId, driverId, status }) => {
    const session = await requirePermission(ctx, "transport.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const v2 = await getSchoolRecord(ctx, schoolId, "vehicles", vehicleId);
    if (driverId) await getSchoolRecord(ctx, schoolId, "drivers", driverId);
    if (status && !["active", "maintenance", "retired"].includes(status)) {
      throw new ConvexError("Unknown vehicle status.");
    }
    await ctx.db.patch(vehicleId, { driverId, status: status ?? v2.status });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "transport.vehicle.updated",
      entityType: "vehicles", entityId: vehicleId,
      description: `Vehicle ${v2.registrationNumber}: driver/status updated (${status ?? v2.status})`,
    });
    return vehicleId;
  },
});

/* ================================================================== */
/* Routes & stops                                                      */
/* ================================================================== */

export const listRoutes = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "transport.view");
    const schoolId = session.schoolId as Id<"schools">;
    const routes = await ctx.db
      .query("transportRoutes")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const stops = await ctx.db
      .query("routeStops")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const assignments = await ctx.db
      .query("transportAssignments")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((as) => as.filter((a) => a.status === "active"));
    return Promise.all(
      routes.map(async (r) => {
        const vehicle = r.vehicleId ? await ctx.db.get(r.vehicleId) : null;
        const routeStops = stops
          .filter((s) => s.routeId === r._id)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        return {
          _id: r._id,
          name: r.name,
          vehicle: vehicle ? { registrationNumber: vehicle.registrationNumber, capacity: vehicle.capacity } : null,
          stops: routeStops.map((s) => ({ _id: s._id, stopName: s.stopName, pickupTime: s.pickupTime, displayOrder: s.displayOrder })),
          assignedStudents: assignments.filter((a) => a.routeId === r._id).length,
          status: r.status,
        };
      }),
    );
  },
});

export const createRoute = mutation({
  args: { name: v.string(), vehicleId: v.optional(v.id("vehicles")) },
  handler: async (ctx, { name, vehicleId }) => {
    const session = await requirePermission(ctx, "transport.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Route name is required.");
    if (vehicleId) await getSchoolRecord(ctx, schoolId, "vehicles", vehicleId);
    const id = await ctx.db.insert("transportRoutes", { schoolId, name: trimmed, vehicleId, status: "active" });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "transport.route.created",
      entityType: "transportRoutes", entityId: id, description: `Route "${trimmed}" created`,
    });
    return id;
  },
});

export const addRouteStop = mutation({
  args: { routeId: v.id("transportRoutes"), stopName: v.string(), pickupTime: v.string(), displayOrder: v.optional(v.number()) },
  handler: async (ctx, { routeId, stopName, pickupTime, displayOrder }) => {
    const session = await requirePermission(ctx, "transport.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const route = await getSchoolRecord(ctx, schoolId, "transportRoutes", routeId);
    const trimmed = stopName.trim();
    if (!trimmed) throw new ConvexError("Stop name is required.");
    if (!/^\d{2}:\d{2}$/.test(pickupTime)) throw new ConvexError("Pickup time must be in HH:MM format.");
    const existing = await ctx.db
      .query("routeStops")
      .withIndex("by_route", (q) => q.eq("routeId", routeId))
      .collect();
    const order = displayOrder ?? existing.length + 1;
    const id = await ctx.db.insert("routeStops", {
      schoolId, routeId, stopName: trimmed, pickupTime, displayOrder: order,
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "transport.stop.added",
      entityType: "routeStops", entityId: id,
      description: `Stop "${trimmed}" (${pickupTime}) added to route "${route.name}"`,
    });
    return id;
  },
});

/* ================================================================== */
/* Student transport assignments                                       */
/* ================================================================== */

export const listAssignments = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "transport.view");
    const schoolId = session.schoolId as Id<"schools">;
    const assignments = await ctx.db
      .query("transportAssignments")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const routes = await ctx.db
      .query("transportRoutes")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const stops = await ctx.db
      .query("routeStops")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const out = await Promise.all(
      assignments
        .sort((a, b) => b.assignedAt - a.assignedAt)
        .map(async (a) => {
          const student = await ctx.db.get(a.studentId);
          const route = routes.find((r) => r._id === a.routeId);
          const stop = a.stopId ? stops.find((s) => s._id === a.stopId) : null;
          const vehicle = a.vehicleId
            ? await ctx.db.get(a.vehicleId)
            : route?.vehicleId
              ? await ctx.db.get(route.vehicleId)
              : null;
          return {
            _id: a._id,
            studentId: a.studentId,
            studentName: student ? `${student.firstName} ${student.lastName}` : "—",
            admissionNumber: student?.admissionNumber ?? "—",
            routeName: route?.name ?? "—",
            stopName: stop?.stopName ?? null,
            pickupTime: stop?.pickupTime ?? null,
            vehicle: vehicle?.registrationNumber ?? null,
            direction: a.direction,
            status: a.status,
            assignedAt: a.assignedAt,
          };
        }),
    );
    return out;
  },
});

export const assignStudent = mutation({
  args: {
    studentId: v.id("students"),
    routeId: v.id("transportRoutes"),
    stopId: v.optional(v.id("routeStops")),
    direction: v.optional(v.string()),
  },
  handler: async (ctx, { studentId, routeId, stopId, direction }) => {
    const session = await requirePermission(ctx, "transport.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    const route = await getSchoolRecord(ctx, schoolId, "transportRoutes", routeId);
    if (stopId) {
      const stop = await getSchoolRecord(ctx, schoolId, "routeStops", stopId);
      if (stop.routeId !== routeId) throw new ConvexError("That stop does not belong to this route.");
    }
    const dir = direction ?? "both";
    if (!["pickup", "dropoff", "both"].includes(dir)) throw new ConvexError("Unknown direction.");
    const existing = await ctx.db
      .query("transportAssignments")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect()
      .then((as) => as.filter((a) => a.status === "active"));
    // End previous active assignments so the student has one live transport record.
    for (const e of existing) {
      await ctx.db.patch(e._id, { status: "ended" });
    }
    const route_ = route;
    const vehicleId = route_.vehicleId;
    const id = await ctx.db.insert("transportAssignments", {
      schoolId, studentId, routeId, stopId, vehicleId,
      direction: dir,
      status: "active",
      assignedById: session.userId,
      assignedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "transport.assigned",
      entityType: "transportAssignments", entityId: id,
      description: `${student.firstName} ${student.lastName} assigned to route "${route.name}"${stopId ? " with stop" : ""}`,
    });
    return id;
  },
});

export const endAssignment = mutation({
  args: { assignmentId: v.id("transportAssignments") },
  handler: async (ctx, { assignmentId }) => {
    const session = await requirePermission(ctx, "transport.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "transportAssignments", assignmentId);
    if (a.status !== "active") throw new ConvexError("Assignment is already ended.");
    await ctx.db.patch(assignmentId, { status: "ended" });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "transport.unassigned",
      entityType: "transportAssignments", entityId: assignmentId,
      description: `Transport assignment ended (${a.routeId})`,
    });
    return assignmentId;
  },
});

/* ================================================================== */
/* Transport dashboard                                                 */
/* ================================================================== */

export const transportDashboard = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "transport.view");
    const schoolId = session.schoolId as Id<"schools">;
    const [vehicles, routes, assignments, drivers] = await Promise.all([
      ctx.db.query("vehicles").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("transportRoutes").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("transportAssignments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("drivers").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    return {
      vehicles: vehicles.filter((v2) => v2.status === "active").length,
      vehiclesInMaintenance: vehicles.filter((v2) => v2.status === "maintenance").length,
      routes: routes.filter((r) => r.status === "active").length,
      activeDrivers: drivers.filter((d) => d.status === "active").length,
      assignedStudents: assignments.filter((a) => a.status === "active").length,
    };
  },
});
