/**
 * Internal payment posting used by the bank import. Wraps the canonical
 * finance engine pieces (payment row → ledger → receipt → invoice status)
 * with an explicit actor — the accountant confirming the bank import.
 * Kept separate from finance.ts to avoid a circular module import.
 */
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { ensureStudentAccount, nextNumber, postLedgerTransaction, refreshInvoiceStatus, studentBalance, ACC } from "../finance";

export async function recordPaymentInternal(
  ctx: import("../_generated/server").MutationCtx,
  args: {
    schoolId: Id<"schools">;
    userId: Id<"users">;
    studentId: Id<"students">;
    invoiceId?: Id<"invoices">;
    amount: number;
    method: string;
    referenceNumber: string;
    notes?: string;
  },
): Promise<{ paymentId: Id<"payments">; paymentNumber: string; receiptNumber: string | null }> {
  const { schoolId, userId, studentId, invoiceId, amount, method, referenceNumber, notes } = args;
  if (!(amount > 0)) throw new ConvexError("Payment amount must be positive.");
  const student = await ctx.db.get(studentId);
  if (!student || student.schoolId !== schoolId) throw new ConvexError("Student not found in this school.");

  // Reference idempotency.
  const all = await ctx.db.query("payments").withIndex("by_school", (q) => q.eq("schoolId", schoolId)).collect();
  if (all.some((p) => p.referenceNumber === referenceNumber && p.status !== "reversed")) {
    throw new ConvexError(`Payment reference "${referenceNumber}" has already been used.`);
  }

  let invoice = null;
  if (invoiceId) {
    invoice = await ctx.db.get(invoiceId);
    if (!invoice || invoice.schoolId !== schoolId) throw new ConvexError("Invoice not found in this school.");
    if (invoice.status === "cancelled") throw new ConvexError("Cannot pay a cancelled invoice.");
  }

  const accountId = await ensureStudentAccount(ctx, schoolId, studentId);
  const paymentNumber = await nextNumber(ctx, schoolId, "PAY");
  const paymentDate = new Date().toISOString().slice(0, 10);
  const paymentId = await ctx.db.insert("payments", {
    schoolId,
    paymentNumber,
    studentId,
    accountId,
    invoiceId,
    amount,
    paymentDate,
    method,
    referenceNumber,
    notes: notes ?? undefined,
    receivedById: userId,
    status: "confirmed",
    confirmedAt: Date.now(),
  });
  // Bank-sourced money lands in the bank account (1020).
  await postLedgerTransaction(ctx, schoolId, userId, {
    transactionType: "payment",
    date: paymentDate,
    amount,
    description: `Payment ${paymentNumber} — ${student.firstName} ${student.lastName} (bank import)`,
    studentId,
    accountId,
    invoiceId,
    paymentId,
    lines: [
      { code: ACC.BANK, direction: "debit", amount },
      { code: ACC.RECEIVABLE, direction: "credit", amount },
    ],
  });
  const balanceAfter = await studentBalance(ctx, schoolId, accountId);
  const receiptNumber = await nextNumber(ctx, schoolId, "REC");
  await ctx.db.insert("receipts", {
    schoolId, receiptNumber, paymentId, studentId, accountId,
    amount, balanceAfter, method, paymentDate,
    issuedById: userId, issuedAt: Date.now(),
  });
  if (invoice) await refreshInvoiceStatus(ctx, invoice._id);
  return { paymentId, paymentNumber, receiptNumber };
}
