import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

/* ================================================================== */
/* Suppliers                                                           */
/* ================================================================== */

export const listSuppliers = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    const session = await requirePermission(ctx, "procurement.view");
    const schoolId = session.schoolId as Id<"schools">;
    let suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const q = search?.trim().toLowerCase();
    if (q) {
      suppliers = suppliers.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.category ?? "").toLowerCase().includes(q) ||
          (s.contactPerson ?? "").toLowerCase().includes(q),
      );
    }
    const orders = await ctx.db
      .query("purchaseOrders")
      .withIndex("by_school", (q2) => q2.eq("schoolId", schoolId))
      .collect();
    return suppliers
      .map((s) => ({
        _id: s._id, name: s.name, contactPerson: s.contactPerson ?? null, phone: s.phone ?? null,
        email: s.email ?? null, category: s.category ?? null, address: s.address ?? null, status: s.status,
        orderCount: orders.filter((o) => o.supplierId === s._id).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createSupplier = mutation({
  args: {
    name: v.string(), contactPerson: v.optional(v.string()), phone: v.optional(v.string()),
    email: v.optional(v.string()), category: v.optional(v.string()), address: v.optional(v.string()),
  },
  handler: async (ctx, { name, contactPerson, phone, email, category, address }) => {
    const session = await requirePermission(ctx, "procurement.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Supplier name is required.");
    const dup = await ctx.db
      .query("suppliers")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ss) => ss.find((s) => s.name.toLowerCase() === trimmed.toLowerCase()));
    if (dup) throw new ConvexError("A supplier with this name already exists.");
    const id = await ctx.db.insert("suppliers", {
      schoolId, name: trimmed, contactPerson: contactPerson?.trim(), phone: phone?.trim(),
      email: email?.trim(), category: category?.trim(), address: address?.trim(), status: "active",
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "procurement.supplier.created",
      entityType: "suppliers", entityId: id, description: `Supplier "${trimmed}" added`,
    });
    return id;
  },
});

export const updateSupplierStatus = mutation({
  args: { supplierId: v.id("suppliers"), status: v.string() },
  handler: async (ctx, { supplierId, status }) => {
    const session = await requirePermission(ctx, "procurement.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const s = await getSchoolRecord(ctx, schoolId, "suppliers", supplierId);
    if (!["active", "inactive", "archived"].includes(status)) throw new ConvexError("Unknown supplier status.");
    await ctx.db.patch(supplierId, { status });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "procurement.supplier.updated",
      entityType: "suppliers", entityId: supplierId,
      description: `Supplier "${s.name}": ${s.status} → ${status}`,
    });
    return supplierId;
  },
});

/* ================================================================== */
/* Purchase requests                                                   */
/* ================================================================== */

export const listPurchaseRequests = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, { status }) => {
    const session = await requirePermission(ctx, "procurement.view");
    const schoolId = session.schoolId as Id<"schools">;
    let requests = await ctx.db
      .query("purchaseRequests")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (status && status !== "all") requests = requests.filter((r) => r.status === status);
    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const departments = await ctx.db
      .query("departments")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const out = await Promise.all(
      requests
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (r) => {
          const items = await ctx.db
            .query("purchaseRequestItems")
            .withIndex("by_request", (q) => q.eq("purchaseRequestId", r._id))
            .collect();
          const requester = await ctx.db.get(r.requestedById);
          return {
            _id: r._id,
            requestNumber: r.requestNumber,
            supplier: r.supplierId ? suppliers.find((s) => s._id === r.supplierId)?.name ?? "—" : null,
            department: r.departmentId ? departments.find((d) => d._id === r.departmentId)?.name ?? "—" : null,
            requestedBy: requester?.name ?? "—",
            neededBy: r.neededBy ?? null,
            justification: r.justification ?? null,
            items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitCost: i.unitCost })),
            estimatedTotal: r.estimatedTotal,
            status: r.status,
            decisionNote: r.decisionNote ?? null,
            createdAt: r.createdAt,
          };
        }),
    );
    return out;
  },
});

export const createPurchaseRequest = mutation({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    departmentId: v.optional(v.id("departments")),
    neededBy: v.optional(v.string()),
    justification: v.optional(v.string()),
    items: v.array(v.object({ description: v.string(), quantity: v.number(), unitCost: v.number() })),
    submitNow: v.optional(v.boolean()),
  },
  handler: async (ctx, { supplierId, departmentId, neededBy, justification, items, submitNow }) => {
    const session = await requirePermission(ctx, "procurement.manage");
    const schoolId = session.schoolId as Id<"schools">;
    if (items.length === 0) throw new ConvexError("Add at least one line item.");
    if (supplierId) await getSchoolRecord(ctx, schoolId, "suppliers", supplierId);
    if (departmentId) await getSchoolRecord(ctx, schoolId, "departments", departmentId);
    let estimatedTotal = 0;
    for (const it of items) {
      if (!it.description.trim()) throw new ConvexError("Every line item needs a description.");
      if (!(it.quantity > 0)) throw new ConvexError("Line item quantities must be positive.");
      if (!(it.unitCost >= 0)) throw new ConvexError("Line item unit costs cannot be negative.");
      estimatedTotal += it.quantity * it.unitCost;
    }
    const existing = await ctx.db
      .query("purchaseRequests")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const requestNumber = `PR-${new Date().getFullYear()}-${String(existing.length + 1).padStart(4, "0")}`;
    const id = await ctx.db.insert("purchaseRequests", {
      schoolId,
      requestNumber,
      supplierId,
      departmentId,
      requestedById: session.userId,
      neededBy,
      justification: justification?.trim(),
      estimatedTotal: Math.round(estimatedTotal * 100) / 100,
      status: submitNow ? "submitted" : "draft",
      createdAt: Date.now(),
    });
    for (const it of items) {
      await ctx.db.insert("purchaseRequestItems", {
        schoolId, purchaseRequestId: id,
        description: it.description.trim(), quantity: it.quantity, unitCost: it.unitCost,
      });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: submitNow ? "procurement.request.submitted" : "procurement.request.created",
      entityType: "purchaseRequests", entityId: id,
      description: `Purchase request ${requestNumber} (${items.length} item(s), est. ${Math.round(estimatedTotal * 100) / 100})${submitNow ? " submitted for approval" : " drafted"}`,
    });
    return id;
  },
});

export const decidePurchaseRequest = mutation({
  args: {
    requestId: v.id("purchaseRequests"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    decisionNote: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, decision, decisionNote }) => {
    const session = await requirePermission(ctx, "procurement.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const r = await getSchoolRecord(ctx, schoolId, "purchaseRequests", requestId);
    if (r.status !== "submitted") throw new ConvexError("Only submitted requests can be approved or rejected.");
    await ctx.db.patch(requestId, {
      status: decision,
      decidedById: session.userId,
      decidedAt: Date.now(),
      decisionNote: decisionNote?.trim(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: `procurement.request.${decision}`,
      entityType: "purchaseRequests", entityId: requestId,
      description: `Purchase request ${r.requestNumber} ${decision}${decisionNote ? ` — ${decisionNote.trim()}` : ""}`,
    });
    return requestId;
  },
});

/** Workflow: approved request → purchase order. */
export const createPurchaseOrder = mutation({
  args: { requestId: v.id("purchaseRequests") },
  handler: async (ctx, { requestId }) => {
    const session = await requirePermission(ctx, "procurement.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const r = await getSchoolRecord(ctx, schoolId, "purchaseRequests", requestId);
    if (r.status !== "approved") {
      throw new ConvexError("Only approved requests can be converted to purchase orders.");
    }
    const dup = await ctx.db
      .query("purchaseOrders")
      .withIndex("by_request", (q) => q.eq("purchaseRequestId", requestId))
      .first();
    if (dup) throw new ConvexError(`Purchase order ${dup.orderNumber} already exists for this request.`);
    const orders = await ctx.db
      .query("purchaseOrders")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const orderNumber = `PO-${new Date().getFullYear()}-${String(orders.length + 1).padStart(4, "0")}`;
    const id = await ctx.db.insert("purchaseOrders", {
      schoolId,
      orderNumber,
      purchaseRequestId: requestId,
      supplierId: r.supplierId,
      total: r.estimatedTotal,
      orderDate: new Date().toISOString().slice(0, 10),
      status: "submitted",
      createdById: session.userId,
      createdAt: Date.now(),
    });
    await ctx.db.patch(requestId, { status: "ordered" });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "procurement.order.created",
      entityType: "purchaseOrders", entityId: id,
      description: `Purchase order ${orderNumber} raised from ${r.requestNumber} (total ${r.estimatedTotal})`,
    });
    return id;
  },
});

/** Goods received: marks the PO received and posts an expense-equivalent
 * ledger transaction so procurement cost lands in Finance. */
export const receivePurchaseOrder = mutation({
  args: { orderId: v.id("purchaseOrders") },
  handler: async (ctx, { orderId }) => {
    const session = await requirePermission(ctx, "procurement.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const o = await getSchoolRecord(ctx, schoolId, "purchaseOrders", orderId);
    if (o.status === "received") throw new ConvexError("This order is already received.");
    if (o.status === "cancelled") throw new ConvexError("Cancelled orders cannot be received.");
    const { postLedgerTransaction, ACC } = await import("./finance");
    const today = new Date().toISOString().slice(0, 10);
    const txnId = await postLedgerTransaction(ctx, schoolId, session.userId, {
      transactionType: "expense",
      date: today,
      amount: o.total,
      description: `Purchase order ${o.orderNumber} received`,
      lines: [
        { code: ACC.EXPENSES_CLEARING, direction: "debit", amount: o.total },
        { code: ACC.CASH, direction: "credit", amount: o.total },
      ],
    });
    await ctx.db.patch(orderId, { status: "received", receivedAt: Date.now() });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "procurement.order.received",
      entityType: "purchaseOrders", entityId: orderId,
      description: `Purchase order ${o.orderNumber} marked received; ledger entry posted (${o.total})`,
    });
    return { orderId, transactionId: txnId };
  },
});

export const listPurchaseOrders = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "procurement.view");
    const schoolId = session.schoolId as Id<"schools">;
    const orders = await ctx.db
      .query("purchaseOrders")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const requests = await ctx.db
      .query("purchaseRequests")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    return orders
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => ({
        _id: o._id,
        orderNumber: o.orderNumber,
        requestNumber: requests.find((r) => r._id === o.purchaseRequestId)?.requestNumber ?? "—",
        supplier: o.supplierId ? suppliers.find((s) => s._id === o.supplierId)?.name ?? "—" : null,
        total: o.total,
        orderDate: o.orderDate,
        status: o.status,
        createdAt: o.createdAt,
      }));
  },
});

/* ================================================================== */
/* Procurement dashboard                                               */
/* ================================================================== */

export const procurementDashboard = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "procurement.view");
    const schoolId = session.schoolId as Id<"schools">;
    const [suppliers, requests, orders] = await Promise.all([
      ctx.db.query("suppliers").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("purchaseRequests").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("purchaseOrders").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    return {
      supplierCount: suppliers.filter((s) => s.status === "active").length,
      pendingRequests: requests.filter((r) => r.status === "submitted").length,
      openOrders: orders.filter((o) => o.status === "submitted" || o.status === "approved").length,
      receivedValue: orders.filter((o) => o.status === "received").reduce((s, o) => s + o.total, 0),
    };
  },
});
