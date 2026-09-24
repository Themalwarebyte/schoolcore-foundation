import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord } from "./session";
import { recordAudit } from "./audit";

/* ================================================================== */
/* Assets                                                              */
/* ================================================================== */

export const listAssets = query({
  args: { search: v.optional(v.string()), category: v.optional(v.string()), condition: v.optional(v.string()) },
  handler: async (ctx, { search, category, condition }) => {
    const session = await requirePermission(ctx, "inventory.view");
    const schoolId = session.schoolId as Id<"schools">;
    let assets = await ctx.db
      .query("assets")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (category && category !== "all") assets = assets.filter((a) => a.category === category);
    if (condition && condition !== "all") assets = assets.filter((a) => a.condition === condition);
    const out = await Promise.all(
      assets.map(async (a) => {
        const custodian = a.custodianStaffId ? await ctx.db.get(a.custodianStaffId) : null;
        return {
          _id: a._id,
          assetNumber: a.assetNumber,
          name: a.name,
          category: a.category,
          purchaseDate: a.purchaseDate ?? null,
          purchaseValue: a.purchaseValue ?? null,
          location: a.location ?? null,
          condition: a.condition,
          custodian: custodian ? [custodian.firstName, custodian.lastName].filter(Boolean).join(" ") : null,
          status: a.status,
        };
      }),
    );
    const q = search?.trim().toLowerCase();
    return (q
      ? out.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            a.assetNumber.toLowerCase().includes(q) ||
            (a.location ?? "").toLowerCase().includes(q),
        )
      : out
    ).sort((a, b) => a.assetNumber.localeCompare(b.assetNumber));
  },
});

export const createAsset = mutation({
  args: {
    name: v.string(),
    category: v.string(),
    purchaseDate: v.optional(v.string()),
    purchaseValue: v.optional(v.number()),
    location: v.optional(v.string()),
    condition: v.optional(v.string()),
    custodianStaffId: v.optional(v.id("staff")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { name, category, purchaseDate, purchaseValue, location, condition, custodianStaffId, notes }) => {
    const session = await requirePermission(ctx, "inventory.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Asset name is required.");
    if (!category.trim()) throw new ConvexError("Asset category is required.");
    if (custodianStaffId) await getSchoolRecord(ctx, schoolId, "staff", custodianStaffId);
    const existing = await ctx.db
      .query("assets")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const assetNumber = `AST-${new Date().getFullYear()}-${String(existing.length + 1).padStart(4, "0")}`;
    const id = await ctx.db.insert("assets", {
      schoolId,
      assetNumber,
      name: trimmed,
      category: category.trim(),
      purchaseDate,
      purchaseValue,
      location: location?.trim(),
      condition: condition ?? "new",
      custodianStaffId,
      notes: notes?.trim(),
      status: "active",
      createdById: session.userId,
      updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "inventory.asset.created",
      entityType: "assets", entityId: id,
      description: `Asset ${assetNumber} "${trimmed}" (${category.trim()}) registered`,
    });
    return id;
  },
});

export const updateAsset = mutation({
  args: {
    assetId: v.id("assets"),
    location: v.optional(v.string()),
    condition: v.optional(v.string()),
    custodianStaffId: v.optional(v.id("staff")),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { assetId, location, condition, custodianStaffId, status }) => {
    const session = await requirePermission(ctx, "inventory.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const a = await getSchoolRecord(ctx, schoolId, "assets", assetId);
    await ctx.db.patch(assetId, {
      location: location?.trim() ?? a.location,
      condition: condition ?? a.condition,
      custodianStaffId: custodianStaffId ?? a.custodianStaffId,
      status: status ?? a.status,
      updatedAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "inventory.asset.updated",
      entityType: "assets", entityId: assetId,
      description: `Asset ${a.assetNumber} updated (condition: ${condition ?? a.condition})`,
    });
    return assetId;
  },
});

/* ================================================================== */
/* Inventory items & stock movements                                   */
/* ================================================================== */

export const listItems = query({
  args: { search: v.optional(v.string()), lowOnly: v.optional(v.boolean()) },
  handler: async (ctx, { search, lowOnly }) => {
    const session = await requirePermission(ctx, "inventory.view");
    const schoolId = session.schoolId as Id<"schools">;
    let items = await ctx.db
      .query("inventoryItems")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (lowOnly) items = items.filter((i) => i.quantity <= i.reorderLevel);
    const q = search?.trim().toLowerCase();
    if (q) items = items.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
    return items
      .map((i) => ({
        _id: i._id, name: i.name, category: i.category, unit: i.unit,
        quantity: i.quantity, reorderLevel: i.reorderLevel, unitCost: i.unitCost ?? null,
        lowStock: i.quantity <= i.reorderLevel, status: i.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createItem = mutation({
  args: {
    name: v.string(), category: v.string(), unit: v.string(),
    quantity: v.number(), reorderLevel: v.number(), unitCost: v.optional(v.number()),
  },
  handler: async (ctx, { name, category, unit, quantity, reorderLevel, unitCost }) => {
    const session = await requirePermission(ctx, "inventory.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Item name is required.");
    if (!category.trim()) throw new ConvexError("Category is required.");
    if (!unit.trim()) throw new ConvexError("Unit is required (e.g. pcs, boxes).");
    if (quantity < 0 || reorderLevel < 0) throw new ConvexError("Quantities cannot be negative.");
    const id = await ctx.db.insert("inventoryItems", {
      schoolId, name: trimmed, category: category.trim(), unit: unit.trim(),
      quantity, reorderLevel, unitCost, status: "active",
      createdById: session.userId, updatedAt: Date.now(),
    });
    if (quantity > 0) {
      await ctx.db.insert("stockMovements", {
        schoolId, itemId: id, movementType: "received", quantity,
        balanceAfter: quantity, reference: "Opening stock",
        createdById: session.userId, createdAt: Date.now(),
      });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "inventory.item.created",
      entityType: "inventoryItems", entityId: id,
      description: `Item "${trimmed}" created (${quantity} ${unit})`,
    });
    return id;
  },
});

/**
 * Record a stock movement. Quantity is always positive; the direction comes
 * from movementType. received/return add stock, issued/adjustment remove
 * (adjustment can go either way via the signedAdjust flag is intentionally
 * avoided — negative adjustments use movementType "adjustment" with the
 * server deciding direction from the current balance target below).
 */
export const recordMovement = mutation({
  args: {
    itemId: v.id("inventoryItems"),
    movementType: v.union(v.literal("received"), v.literal("issued"), v.literal("adjustment"), v.literal("return")),
    quantity: v.number(),
    reference: v.optional(v.string()),
    issuedToStaffId: v.optional(v.id("staff")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { itemId, movementType, quantity, reference, issuedToStaffId, notes }) => {
    const session = await requirePermission(ctx, "inventory.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const item = await getSchoolRecord(ctx, schoolId, "inventoryItems", itemId);
    if (!(quantity > 0)) throw new ConvexError("Quantity must be positive.");
    const incoming = movementType === "received" || movementType === "return";
    const outgoing = movementType === "issued" || movementType === "adjustment";
    let newBalance: number;
    if (incoming) newBalance = item.quantity + quantity;
    else {
      if (movementType === "issued" && item.quantity < quantity) {
        throw new ConvexError(`Cannot issue ${quantity} ${item.unit}: only ${item.quantity} in stock.`);
      }
      // "adjustment" with the item already at the target: treat as increase
      // when the caller sets notes starting with "+", otherwise decrease.
      if (movementType === "adjustment" && item.quantity < quantity) {
        newBalance = item.quantity + quantity;
      } else {
        newBalance = item.quantity - quantity;
      }
    }
    if (issuedToStaffId) await getSchoolRecord(ctx, schoolId, "staff", issuedToStaffId);
    await ctx.db.patch(itemId, { quantity: newBalance, updatedAt: Date.now() });
    const movementId = await ctx.db.insert("stockMovements", {
      schoolId, itemId, movementType, quantity,
      balanceAfter: newBalance, reference: reference?.trim(), issuedToStaffId,
      notes: notes?.trim(), createdById: session.userId, createdAt: Date.now(),
    });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: `inventory.stock.${movementType}`,
      entityType: "stockMovements", entityId: movementId,
      description: `Stock ${movementType}: ${quantity} ${item.unit} of "${item.name}" → balance ${newBalance}`,
    });
    return movementId;
  },
});

export const listMovements = query({
  args: { itemId: v.id("inventoryItems"), limit: v.optional(v.number()) },
  handler: async (ctx, { itemId, limit }) => {
    const session = await requirePermission(ctx, "inventory.view");
    const schoolId = session.schoolId as Id<"schools">;
    await getSchoolRecord(ctx, schoolId, "inventoryItems", itemId);
    const movements = await ctx.db
      .query("stockMovements")
      .withIndex("by_item", (q) => q.eq("itemId", itemId))
      .collect()
      .then((ms) => ms.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit ?? 50));
    return Promise.all(
      movements.map(async (m) => {
        const staff = m.issuedToStaffId ? await ctx.db.get(m.issuedToStaffId) : null;
        const user = await ctx.db.get(m.createdById);
        return {
          _id: m._id,
          movementType: m.movementType,
          quantity: m.quantity,
          balanceAfter: m.balanceAfter,
          reference: m.reference ?? null,
          issuedTo: staff ? [staff.firstName, staff.lastName].filter(Boolean).join(" ") : null,
          notes: m.notes ?? null,
          createdAt: m.createdAt,
          createdByName: user?.name ?? null,
        };
      }),
    );
  },
});

/* ================================================================== */
/* Inventory dashboard                                                 */
/* ================================================================== */

export const inventoryDashboard = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "inventory.view");
    const schoolId = session.schoolId as Id<"schools">;
    const [assets, items] = await Promise.all([
      ctx.db.query("assets").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("inventoryItems").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    return {
      totalAssets: assets.filter((a) => a.status === "active").length,
      assetsPoorCondition: assets.filter((a) => a.status === "active" && (a.condition === "poor" || a.condition === "fair")).length,
      assetValue: assets.filter((a) => a.status === "active").reduce((s, a) => s + (a.purchaseValue ?? 0), 0),
      itemCount: items.filter((i) => i.status === "active").length,
      lowStockItems: items.filter((i) => i.status === "active" && i.quantity <= i.reorderLevel).length,
    };
  },
});
