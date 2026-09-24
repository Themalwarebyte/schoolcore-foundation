import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

/* ================================================================== */
/* Hostels, rooms, beds                                                */
/* ================================================================== */

export const listHostels = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "boarding.view");
    const schoolId = session.schoolId as Id<"schools">;
    const hostels = await ctx.db
      .query("hostels")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const rooms = await ctx.db
      .query("hostelRooms")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const beds = await ctx.db
      .query("beds")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const allocations = await ctx.db
      .query("boardingAllocations")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((as) => as.filter((a) => a.status === "active"));
    return Promise.all(
      hostels.map(async (h) => {
        const warden = h.wardenStaffId ? await ctx.db.get(h.wardenStaffId) : null;
        const hostelRooms = rooms.filter((r) => r.hostelId === h._id);
        const hostelBeds = beds.filter((b) => hostelRooms.some((r) => r._id === b.roomId));
        return {
          _id: h._id,
          name: h.name,
          gender: h.gender ?? null,
          warden: warden ? [warden.firstName, warden.lastName].filter(Boolean).join(" ") : null,
          roomCount: hostelRooms.length,
          bedCount: hostelBeds.length,
          occupiedBeds: hostelBeds.filter((b) => b.status === "occupied").length,
          activeAllocations: allocations.filter((a) => a.hostelId === h._id).length,
          status: h.status,
        };
      }),
    );
  },
});

export const createHostel = mutation({
  args: { name: v.string(), gender: v.optional(v.string()), wardenStaffId: v.optional(v.id("staff")) },
  handler: async (ctx, { name, gender, wardenStaffId }) => {
    const session = await requirePermission(ctx, "boarding.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Hostel name is required.");
    if (wardenStaffId) await getSchoolRecord(ctx, schoolId, "staff", wardenStaffId);
    const id = await ctx.db.insert("hostels", {
      schoolId, name: trimmed, gender, wardenStaffId, status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "boarding.hostel.created",
      entityType: "hostels", entityId: id, description: `Hostel "${trimmed}" created`,
    });
    return id;
  },
});

export const addRoom = mutation({
  args: { hostelId: v.id("hostels"), roomNumber: v.string(), capacity: v.number() },
  handler: async (ctx, { hostelId, roomNumber, capacity }) => {
    const session = await requirePermission(ctx, "boarding.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const hostel = await getSchoolRecord(ctx, schoolId, "hostels", hostelId);
    const num = roomNumber.trim();
    if (!num) throw new ConvexError("Room number is required.");
    if (!(capacity > 0)) throw new ConvexError("Room capacity must be positive.");
    const dup = await ctx.db
      .query("hostelRooms")
      .withIndex("by_hostel", (q) => q.eq("hostelId", hostelId))
      .collect()
      .then((rs) => rs.find((r) => r.roomNumber.toLowerCase() === num.toLowerCase()));
    if (dup) throw new ConvexError(`Room ${num} already exists in ${hostel.name}.`);
    const roomId = await ctx.db.insert("hostelRooms", {
      schoolId, hostelId, roomNumber: num, capacity, status: "active",
    });
    for (let i = 1; i <= capacity; i++) {
      await ctx.db.insert("beds", {
        schoolId, roomId, bedNumber: `${num}-B${String(i).padStart(2, "0")}`, status: "free",
      });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "boarding.room.created",
      entityType: "hostelRooms", entityId: roomId,
      description: `Room ${num} (${capacity} beds) added to hostel "${hostel.name}"`,
    });
    return roomId;
  },
});

export const listRooms = query({
  args: { hostelId: v.optional(v.id("hostels")) },
  handler: async (ctx, { hostelId }) => {
    const session = await requirePermission(ctx, "boarding.view");
    const schoolId = session.schoolId as Id<"schools">;
    const hostels = await ctx.db
      .query("hostels")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    let rooms = await ctx.db
      .query("hostelRooms")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (hostelId) rooms = rooms.filter((r) => r.hostelId === hostelId);
    const beds = await ctx.db
      .query("beds")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return rooms.map((r) => {
      const roomBeds = beds.filter((b) => b.roomId === r._id);
      return {
        _id: r._id,
        hostel: hostels.find((h) => h._id === r.hostelId)?.name ?? "—",
        roomNumber: r.roomNumber,
        capacity: r.capacity,
        bedCount: roomBeds.length,
        freeBeds: roomBeds.filter((b) => b.status === "free").length,
        status: r.status,
      };
    });
  },
});

/* ================================================================== */
/* Allocation                                                          */
/* ================================================================== */

export const allocateBed = mutation({
  args: { studentId: v.id("students"), roomId: v.id("hostelRooms"), academicYearId: v.optional(v.id("academicYears")) },
  handler: async (ctx, { studentId, roomId, academicYearId }) => {
    const session = await requirePermission(ctx, "boarding.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const student = await getSchoolRecord(ctx, schoolId, "students", studentId);
    const room = await getSchoolRecord(ctx, schoolId, "hostelRooms", roomId);
    const hostel = await ctx.db.get(room.hostelId);
    const bed = await ctx.db
      .query("beds")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect()
      .then((bs) => bs.find((b) => b.status === "free"));
    if (!bed) throw new ConvexError(`No free beds in room ${room.roomNumber}.`);
    // BED CONFLICT GUARD: verify server-side that the bed is genuinely free,
    // not just marked free (protects against stale rows).
    const activeOnBed = await ctx.db
      .query("boardingAllocations")
      .withIndex("by_bed", (q) => q.eq("bedId", bed._id))
      .collect()
      .then((as) => as.some((a) => a.status === "active"));
    if (activeOnBed) throw new ConvexError(`Bed ${bed.bedNumber} is already occupied.`);
    // End the student's previous active allocation (history is preserved).
    const existing = await ctx.db
      .query("boardingAllocations")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect()
      .then((as) => as.filter((a) => a.status === "active"));
    for (const e of existing) {
      await ctx.db.patch(e._id, { status: "ended", endDate: new Date().toISOString().slice(0, 10) });
      await ctx.db.patch(e.bedId, { status: "free" });
    }
    await ctx.db.patch(bed._id, { status: "occupied" });
    const id = await ctx.db.insert("boardingAllocations", {
      schoolId,
      studentId,
      hostelId: room.hostelId,
      roomId,
      bedId: bed._id,
      academicYearId,
      startDate: new Date().toISOString().slice(0, 10),
      status: "active",
      allocatedById: session.userId,
      createdAt: Date.now(),
    });
    // Keep the student's boarding status in sync with reality.
    if (student.boardingStatus !== "boarding") {
      await ctx.db.patch(studentId, { boardingStatus: "boarding", updatedAt: Date.now(), updatedById: session.userId });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "boarding.allocated",
      entityType: "boardingAllocations", entityId: id,
      description: `${student.firstName} ${student.lastName} allocated bed ${bed.bedNumber} in ${hostel?.name ?? "hostel"} / room ${room.roomNumber}`,
    });
    return id;
  },
});

export const deallocateBed = mutation({
  args: { allocationId: v.id("boardingAllocations") },
  handler: async (ctx, { allocationId }) => {
    const session = await requirePermission(ctx, "boarding.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "boardingAllocations", allocationId);
    if (a.status !== "active") throw new ConvexError("Allocation is already ended.");
    await ctx.db.patch(allocationId, {
      status: "ended",
      endDate: new Date().toISOString().slice(0, 10),
    });
    await ctx.db.patch(a.bedId, { status: "free" });
    const student = await ctx.db.get(a.studentId);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "boarding.deallocated",
      entityType: "boardingAllocations", entityId: allocationId,
      description: `Allocation ended for ${student?.firstName ?? "student"} (bed ${a.bedId})`,
    });
    return allocationId;
  },
});

export const listAllocations = query({
  args: { activeOnly: v.optional(v.boolean()) },
  handler: async (ctx, { activeOnly }) => {
    const session = await requirePermission(ctx, "boarding.view");
    const schoolId = session.schoolId as Id<"schools">;
    let allocations = await ctx.db
      .query("boardingAllocations")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (activeOnly) allocations = allocations.filter((a) => a.status === "active");
    const hostels = await ctx.db
      .query("hostels")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const rooms = await ctx.db
      .query("hostelRooms")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const beds = await ctx.db
      .query("beds")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const out = await Promise.all(
      allocations
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (a) => {
          const student = await ctx.db.get(a.studentId);
          return {
            _id: a._id,
            studentName: student ? `${student.firstName} ${student.lastName}` : "—",
            admissionNumber: student?.admissionNumber ?? "—",
            hostel: hostels.find((h) => h._id === a.hostelId)?.name ?? "—",
            room: rooms.find((r) => r._id === a.roomId)?.roomNumber ?? "—",
            bed: beds.find((b) => b._id === a.bedId)?.bedNumber ?? "—",
            startDate: a.startDate,
            endDate: a.endDate ?? null,
            status: a.status,
          };
        }),
    );
    return out;
  },
});

/** Allocation history for one student (room-change audit trail). */
export const studentAllocationHistory = query({
  args: { studentId: v.id("students") },
  handler: async (ctx, { studentId }) => {
    const session = await requirePermission(ctx, "boarding.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "students", studentId);
    const allocations = await ctx.db
      .query("boardingAllocations")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect()
      .then((as) => as.sort((a, b) => b.createdAt - a.createdAt));
    const rooms = await ctx.db
      .query("hostelRooms")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const hostels = await ctx.db
      .query("hostels")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const beds = await ctx.db
      .query("beds")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return allocations.map((a) => ({
      hostel: hostels.find((h) => h._id === a.hostelId)?.name ?? "—",
      room: rooms.find((r) => r._id === a.roomId)?.roomNumber ?? "—",
      bed: beds.find((b) => b._id === a.bedId)?.bedNumber ?? "—",
      startDate: a.startDate,
      endDate: a.endDate ?? null,
      status: a.status,
    }));
  },
});

/* ================================================================== */
/* Boarding dashboard                                                  */
/* ================================================================== */

export const boardingDashboard = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "boarding.view");
    const schoolId = session.schoolId as Id<"schools">;
    const [hostels, beds, allocations] = await Promise.all([
      ctx.db.query("hostels").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("beds").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("boardingAllocations").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    return {
      hostelCount: hostels.filter((h) => h.status === "active").length,
      totalBeds: beds.length,
      occupiedBeds: beds.filter((b) => b.status === "occupied").length,
      freeBeds: beds.filter((b) => b.status === "free").length,
      maintenanceBeds: beds.filter((b) => b.status === "maintenance").length,
      activeAllocations: allocations.filter((a) => a.status === "active").length,
    };
  },
});
