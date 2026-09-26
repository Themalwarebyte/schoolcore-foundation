import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, getSchoolRecord, getSession } from "./session";
import { recordAudit } from "./audit";

const FINE_PER_DAY = 10; // currency units per overdue day; configurable per school later

/* ================================================================== */
/* Categories & catalogue                                              */
/* ================================================================== */

export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "library.view");
    return ctx.db
      .query("libraryCategories")
      .withIndex("by_school", (q) => q.eq("schoolId", session.schoolId as Id<"schools">))
      .collect();
  },
});

export const createCategory = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const session = await requirePermission(ctx, "library.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Category name is required.");
    const id = await ctx.db.insert("libraryCategories", { schoolId, name: trimmed, status: "active" });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "library.category.created",
      entityType: "libraryCategories", entityId: id, description: `Library category "${trimmed}" created`,
    });
    return id;
  },
});

export const listBooks = query({
  args: { search: v.optional(v.string()), categoryId: v.optional(v.string()) },
  handler: async (ctx, { search, categoryId }) => {
    const session = await requirePermission(ctx, "library.view");
    const schoolId = session.schoolId as Id<"schools">;
    let books = await ctx.db
      .query("books")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    if (categoryId && categoryId !== "all") books = books.filter((b) => b.categoryId === categoryId);
    const categories = await ctx.db
      .query("libraryCategories")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect();
    const out = await Promise.all(
      books.map(async (b) => {
        const copies = await ctx.db
          .query("bookCopies")
          .withIndex("by_book", (q) => q.eq("bookId", b._id))
          .collect();
        const available = copies.filter((c) => c.status === "available").length;
        const cat = b.categoryId ? categories.find((c) => c._id === b.categoryId) : null;
        return {
          _id: b._id, title: b.title, author: b.author ?? null, isbn: b.isbn ?? null,
          publisher: b.publisher ?? null, location: b.location ?? null,
          category: cat?.name ?? null,
          totalCopies: copies.length, availableCopies: available,
          status: b.status,
        };
      }),
    );
    const q = search?.trim().toLowerCase();
    return (q
      ? out.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            (b.author ?? "").toLowerCase().includes(q) ||
            (b.isbn ?? "").toLowerCase().includes(q),
        )
      : out
    ).sort((a, b) => a.title.localeCompare(b.title));
  },
});

export const getBook = query({
  args: { bookId: v.id("books") },
  handler: async (ctx, { bookId }) => {
    const session = await requirePermission(ctx, "library.view");
    const schoolId = session.schoolId as Id<"schools">;
    const book = await getSchoolRecord(ctx, schoolId, "books", bookId);
    const copies = await ctx.db
      .query("bookCopies")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect()
      .then((cs) => cs.sort((a, b) => a.copyNumber.localeCompare(b.copyNumber)));
    const loans = await ctx.db
      .query("bookLoans")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ls) => ls.filter((l) => l.bookId === bookId))
      .then((ls) => ls.sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1)).slice(0, 30));
    const names = new Map<string, string>();
    for (const l of loans) {
      const key = l.borrowerStudentId ?? l.borrowerStaffId;
      if (!key || names.has(key)) continue;
      if (l.borrowerStudentId) {
        const s = await ctx.db.get(l.borrowerStudentId);
        names.set(key, s ? `${s.firstName} ${s.lastName} (${s.admissionNumber})` : "Student");
      } else if (l.borrowerStaffId) {
        const st = await ctx.db.get(l.borrowerStaffId);
        names.set(key, st ? `${st.firstName} ${st.lastName}` : "Staff");
      }
    }
    return {
      book,
      copies,
      loans: loans.map((l) => ({
        _id: l._id,
        copyNumber: copies.find((c) => c._id === l.bookCopyId)?.copyNumber ?? "—",
        borrower: l.borrowerStudentId ?? l.borrowerStaffId ? names.get((l.borrowerStudentId ?? l.borrowerStaffId) as string) ?? "—" : "—",
        issueDate: l.issueDate, dueDate: l.dueDate, status: l.status,
        fineAmount: l.fineAmount, returnDate: l.returnDate ?? null,
      })),
    };
  },
});

export const createBook = mutation({
  args: {
    title: v.string(), author: v.optional(v.string()), isbn: v.optional(v.string()),
    categoryId: v.optional(v.id("libraryCategories")), publisher: v.optional(v.string()),
    location: v.optional(v.string()), copyCount: v.number(),
  },
  handler: async (ctx, { title, author, isbn, categoryId, publisher, location, copyCount }) => {
    const session = await requirePermission(ctx, "library.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const trimmed = title.trim();
    if (!trimmed) throw new ConvexError("Book title is required.");
    if (!(copyCount >= 0)) throw new ConvexError("Copy count cannot be negative.");
    if (categoryId) await getSchoolRecord(ctx, schoolId, "libraryCategories", categoryId);
    const bookId = await ctx.db.insert("books", {
      schoolId, title: trimmed, author: author?.trim(), isbn: isbn?.trim(),
      categoryId, publisher: publisher?.trim(), location: location?.trim(),
      totalCopies: copyCount, status: "active",
    });
    for (let i = 1; i <= copyCount; i++) {
      await ctx.db.insert("bookCopies", {
        schoolId, bookId, copyNumber: String(i).padStart(3, "0"), status: "available",
      });
    }
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "library.book.created",
      entityType: "books", entityId: bookId,
      description: `Book "${trimmed}" catalogued with ${copyCount} cop${copyCount === 1 ? "y" : "ies"}`,
    });
    return bookId;
  },
});

export const addCopies = mutation({
  args: { bookId: v.id("books"), count: v.number() },
  handler: async (ctx, { bookId, count }) => {
    const session = await requirePermission(ctx, "library.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const book = await getSchoolRecord(ctx, schoolId, "books", bookId);
    if (!(count > 0)) throw new ConvexError("Copy count must be positive.");
    const existing = await ctx.db
      .query("bookCopies")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect();
    let maxNum = 0;
    for (const c of existing) {
      const n = Number(c.copyNumber);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
    for (let i = 1; i <= count; i++) {
      await ctx.db.insert("bookCopies", {
        schoolId, bookId, copyNumber: String(maxNum + i).padStart(3, "0"), status: "available",
      });
    }
    await ctx.db.patch(bookId, { totalCopies: book.totalCopies + count });
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "library.copies.added",
      entityType: "books", entityId: bookId,
      description: `${count} cop${count === 1 ? "y" : "ies"} added to "${book.title}" (now ${book.totalCopies + count})`,
    });
    return bookId;
  },
});

/* ================================================================== */
/* Borrowing                                                           */
/* ================================================================== */

function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000));
}

export const issueBook = mutation({
  args: {
    bookId: v.id("books"),
    borrowerStudentId: v.optional(v.id("students")),
    borrowerStaffId: v.optional(v.id("staff")),
    days: v.optional(v.number()),
  },
  handler: async (ctx, { bookId, borrowerStudentId, borrowerStaffId, days }) => {
    const session = await requirePermission(ctx, "library.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const book = await getSchoolRecord(ctx, schoolId, "books", bookId);
    if (!borrowerStudentId && !borrowerStaffId) {
      throw new ConvexError("Choose a student or staff borrower.");
    }
    if (borrowerStudentId && borrowerStaffId) {
      throw new ConvexError("A loan can have only one borrower.");
    }
    if (borrowerStudentId) await getSchoolRecord(ctx, schoolId, "students", borrowerStudentId);
    if (borrowerStaffId) await getSchoolRecord(ctx, schoolId, "staff", borrowerStaffId);
    const copy = await ctx.db
      .query("bookCopies")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .collect()
      .then((cs) => cs.find((c) => c.status === "available"));
    if (!copy) throw new ConvexError(`No available copies of "${book.title}".`);
    // Overdue guard: block new issues for borrowers with unpaid overdue loans.
    const borrowerLoans = await ctx.db
      .query("bookLoans")
      .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
      .collect()
      .then((ls) =>
        ls.filter(
          (l) =>
            l.status === "issued" &&
            (borrowerStudentId ? l.borrowerStudentId === borrowerStudentId : l.borrowerStaffId === borrowerStaffId),
        ),
      );
    const today = new Date().toISOString().slice(0, 10);
    const hasOverdue = borrowerLoans.some((l) => l.dueDate < today);
    if (hasOverdue) throw new ConvexError("This borrower has an overdue book. It must be returned first.");
    const loanDays = days && days > 0 ? days : 14;
    const dueDate = new Date(Date.now() + loanDays * 86400000).toISOString().slice(0, 10);
    await ctx.db.patch(copy._id, { status: "issued" });
    const loanId = await ctx.db.insert("bookLoans", {
      schoolId, bookId, bookCopyId: copy._id,
      borrowerStudentId, borrowerStaffId,
      issuedById: session.userId,
      issueDate: today, dueDate,
      fineAmount: 0,
      status: "issued",
    });
    const borrowerName = borrowerStudentId
      ? (await ctx.db.get(borrowerStudentId))?.firstName
      : (await ctx.db.get(borrowerStaffId as Id<"staff">))?.firstName;
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "library.loan.issued",
      entityType: "bookLoans", entityId: loanId,
      description: `Book "${book.title}" (copy ${copy.copyNumber}) issued to ${borrowerName ?? "borrower"} until ${dueDate}`,
    });
    return loanId;
  },
});

export const returnBook = mutation({
  args: { loanId: v.id("bookLoans"), waiveFine: v.optional(v.boolean()) },
  handler: async (ctx, { loanId, waiveFine }) => {
    const session = await requirePermission(ctx, "library.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const loan = await getSchoolRecord(ctx, schoolId, "bookLoans", loanId);
    if (loan.status !== "issued" && loan.status !== "overdue") {
      throw new ConvexError("This loan is not currently out.");
    }
    const today = new Date().toISOString().slice(0, 10);
    const overdueDays = daysBetween(loan.dueDate, today);
    const fine = overdueDays > 0 ? overdueDays * FINE_PER_DAY : 0;
    const waived = waiveFine === true;
    await ctx.db.patch(loan.bookCopyId, { status: "available" });
    await ctx.db.patch(loanId, {
      status: "returned",
      returnDate: today,
      returnedAt: Date.now(),
      fineAmount: waived ? 0 : fine,
      fineWaived: waived && fine > 0 ? true : loan.fineWaived,
    });
    const book = await ctx.db.get(loan.bookId);
    await recordAudit(ctx, {
      userId: session.userId, schoolId, action: "library.loan.returned",
      entityType: "bookLoans", entityId: loanId,
      description: `Book "${book?.title ?? loan.bookId}" returned${overdueDays > 0 ? ` ${overdueDays} day(s) late` : ""}${waived && fine > 0 ? " (fine waived)" : fine > 0 ? ` with fine ${fine}` : ""}`,
    });
    return { fine, overdueDays };
  },
});

/** Mark outstanding loans past due as overdue (also used by the dashboard). */
export const refreshOverdue = mutation({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "library.manage");
    const schoolId = session.schoolId as Id<"schools">;
    const today = new Date().toISOString().slice(0, 10);
    const out = await ctx.db
      .query("bookLoans")
      .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("status", "issued"))
      .collect()
      .then((ls) => ls.filter((l) => l.dueDate < today));
    for (const l of out) await ctx.db.patch(l._id, { status: "overdue" });
    if (out.length > 0) {
      await recordAudit(ctx, {
        userId: session.userId, schoolId, action: "library.overdue.refreshed",
        entityType: "bookLoans",
        description: `${out.length} loan(s) marked overdue`,
      });
    }
    return out.length;
  },
});

/** Borrower directory: students + staff with library-visible identities only. */
export const listBorrowers = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    const session = await requirePermission(ctx, "library.view");
    const schoolId = session.schoolId as Id<"schools">;
    const q = search?.trim().toLowerCase();
    const students = await ctx.db
      .query("students")
      .withIndex("by_school", (q2) => q2.eq("schoolId", schoolId))
      .collect()
      .then((ss) =>
        ss
          .filter((s) => s.studentStatus === "active")
          .map((s) => ({
            id: s._id as Id<"students"> | Id<"staff">,
            kind: "student" as const,
            name: `${s.firstName} ${s.lastName}`,
            ref: s.admissionNumber,
          })),
      );
    const staff = await ctx.db
      .query("staff")
      .withIndex("by_school", (q2) => q2.eq("schoolId", schoolId))
      .collect()
      .then((ss) =>
        ss
          .filter((s) => s.employmentStatus === "active")
          .map((s) => ({
            id: s._id as Id<"students"> | Id<"staff">,
            kind: "staff" as const,
            name: `${s.firstName} ${s.lastName}`,
            ref: s.employeeNumber,
          })),
      );
    const all = [...students, ...staff].sort((a, b) => a.name.localeCompare(b.name));
    return q ? all.filter((b) => b.name.toLowerCase().includes(q) || b.ref.toLowerCase().includes(q)).slice(0, 30) : all.slice(0, 30);
  },
});

export const myLoans = query({
  args: {},
  handler: async (ctx) => {
    const session = await getSession(ctx);
    if (!session.schoolId) return [];
    // Own loans via staff identity (student portal loans arrive in Phase 6 portals).
    const ownStaff = await ctx.db
      .query("staff")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .first();
    if (!ownStaff) return [];
    const loans = await ctx.db
      .query("bookLoans")
      .withIndex("by_staff", (q) => q.eq("borrowerStaffId", ownStaff._id))
      .collect();
    const out = [];
    for (const l of loans.sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))) {
      const book = await ctx.db.get(l.bookId);
      const copy = await ctx.db.get(l.bookCopyId);
      out.push({
        title: book?.title ?? "—",
        copyNumber: copy?.copyNumber ?? "—",
        issueDate: l.issueDate, dueDate: l.dueDate, status: l.status,
        fineAmount: l.fineAmount, returnDate: l.returnDate ?? null,
      });
    }
    return out;
  },
});

/* ================================================================== */
/* Library dashboard                                                   */
/* ================================================================== */

export const libraryDashboard = query({
  args: {},
  handler: async (ctx) => {
    const session = await requirePermission(ctx, "library.view");
    const schoolId = session.schoolId as Id<"schools">;
    const [books, loans] = await Promise.all([
      ctx.db.query("books").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
      ctx.db.query("bookLoans").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const active = loans.filter((l) => l.status === "issued" || l.status === "overdue");
    return {
      titleCount: books.filter((b) => b.status === "active").length,
      activeLoans: active.length,
      overdueLoans: active.filter((l) => l.status === "overdue" || l.dueDate < today).length,
      outstandingFines: loans.filter((l) => l.status !== "returned").reduce((s, l) => s + l.fineAmount, 0),
      returnedThisYear: loans.filter((l) => (l.returnDate ?? "").startsWith(String(new Date().getFullYear()))).length,
    };
  },
});
