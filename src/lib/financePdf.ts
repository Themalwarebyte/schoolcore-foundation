import { jsPDF } from "jspdf";

export interface ReceiptPdfData {
  school: { name: string; county?: string | null; phone?: string | null; email?: string | null; postalAddress?: string | null };
  receiptNumber: string;
  paymentNumber: string;
  student: { name: string; admissionNumber: string };
  amount: number;
  method: string;
  referenceNumber?: string | null;
  paymentDate: string;
  receivedBy?: string | null;
  balanceAfter?: number | null;
  invoiceNumber?: string | null;
}

export interface StatementPdfData {
  school: { name: string; county?: string | null; phone?: string | null; email?: string | null; postalAddress?: string | null };
  student: { name: string; admissionNumber: string };
  period: string;
  openingBalance: number;
  lines: Array<{ date: string; type: string; number: string; description: string; debit: number; credit: number; balance: number }>;
  closingBalance: number;
}

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function schoolHeader(doc: jsPDF, school: { name: string; county?: string | null; phone?: string | null; email?: string | null; postalAddress?: string | null }, docTitle: string, docNumber: string): number {
  doc.setFillColor(16, 74, 58);
  doc.rect(0, 0, 210, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(school.name, 14, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const parts = [school.postalAddress, school.county, school.phone, school.email].filter(Boolean) as string[];
  doc.text(parts.join("  ·  "), 14, 19);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(docTitle, 196, 13, { align: "right" });
  doc.setFontSize(10);
  doc.text(docNumber, 196, 19, { align: "right" });
  doc.setTextColor(30, 30, 30);
  return 40;
}

function footer(doc: jsPDF, note: string) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(note, 14, 288);
    doc.text(`Page ${i} of ${pages}`, 196, 288, { align: "right" });
    doc.setTextColor(30, 30, 30);
  }
}

/** Build a payment receipt PDF (A4, school-branded). */
export function buildReceiptPdf(data: ReceiptPdfData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let y = schoolHeader(doc, data.school, "OFFICIAL RECEIPT", data.receiptNumber);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const rows: Array<[string, string]> = [
    ["Received from", data.student.name],
    ["Admission No.", data.student.admissionNumber],
    ["Payment No.", data.paymentNumber],
    ["For (invoice)", data.invoiceNumber ?? "—"],
    ["Payment date", data.paymentDate],
    ["Payment method", data.method],
    ["Reference", data.referenceNumber ?? "—"],
    ["Received by", data.receivedBy ?? "—"],
  ];
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(110, 110, 110);
    doc.text(label, 16, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    doc.text(value, 70, y);
    y += 7;
  }

  y += 4;
  doc.setFillColor(240, 246, 243);
  doc.roundedRect(14, y - 8, 182, 16, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("AMOUNT RECEIVED", 20, y + 2);
  doc.setFontSize(14);
  doc.text(money(data.amount), 192, y + 2, { align: "right" });
  y += 18;

  if (typeof data.balanceAfter === "number") {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Balance after this payment: ${money(data.balanceAfter)}`, 16, y);
    y += 10;
  }

  y += 8;
  doc.setDrawColor(160, 160, 160);
  doc.line(20, y, 80, y);
  doc.line(120, y, 180, y);
  doc.setFontSize(8.5);
  doc.setTextColor(110, 110, 110);
  doc.text("Authorized signature", 20, y + 4);
  doc.text("Date", 120, y + 4);
  footer(doc, "This receipt is system-generated and auditable. Please retain for your records.");
  return doc;
}

/** Build a student account statement PDF (A4, ledger lines with running balance). */
export function buildStatementPdf(data: StatementPdfData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let y = schoolHeader(doc, data.school, "ACCOUNT STATEMENT", data.period);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Student:", 16, y);
  doc.setFont("helvetica", "bold");
  doc.text(`${data.student.name}  (${data.student.admissionNumber})`, 40, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.text(`Opening balance: ${money(data.openingBalance)}`, 16, y);
  y += 8;

  // Table header
  doc.setFillColor(16, 74, 58);
  doc.rect(14, y - 5, 182, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Date", 16, y);
  doc.text("Type", 34, y);
  doc.text("Ref / description", 62, y);
  doc.text("Debit", 150, y, { align: "right" });
  doc.text("Credit", 170, y, { align: "right" });
  doc.text("Balance", 192, y, { align: "right" });
  doc.setTextColor(30, 30, 30);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  if (data.lines.length === 0) {
    doc.text("No financial activity recorded for this account yet.", 16, y);
    y += 8;
  }
  for (const l of data.lines) {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.text(l.date, 16, y);
    doc.text(l.type, 34, y);
    const desc = `${l.number}${l.description ? ` — ${l.description}` : ""}`;
    doc.text(desc.length > 60 ? desc.slice(0, 59) + "…" : desc, 62, y);
    if (l.debit) doc.text(money(l.debit), 150, y, { align: "right" });
    if (l.credit) doc.text(money(l.credit), 170, y, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(money(l.balance), 192, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 6;
  }

  y += 4;
  doc.setDrawColor(160, 160, 160);
  doc.line(140, y, 196, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Closing balance: ${money(data.closingBalance)}`, 196, y, { align: "right" });
  footer(doc, "Balances are computed from the immutable financial ledger. Contact the bursar's office for any queries.");
  return doc;
}

/** Download helper. */
export function downloadPdf(doc: jsPDF, filename: string) {
  doc.save(filename);
}
