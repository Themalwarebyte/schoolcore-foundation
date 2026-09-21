import { jsPDF } from "jspdf";

/* A4 portrait in millimetres */
const PW = 210;
const PH = 297;
const M = 16; // page margin

export interface ReportCardPdfData {
  school: { name: string; address: string | null; motto?: string };
  student: { fullName: string; admissionNumber: string } | null;
  classLabel: string;
  yearName: string;
  termName: string;
  termEndDate: string | null;
  card: {
    status: string;
    attendance?: {
      present: number; absent: number; late: number; excused: number; percentage: number;
    } | null;
    overallAverage?: number;
    overallGrade?: string;
    rank?: number;
    classSize?: number;
    subjects: {
      subjectName: string;
      totalScore: number;
      percentage: number;
      gradeLabel?: string;
      teacherComment?: string;
      components: { title: string; score?: number; maxMarks: number; weight: number; status: string }[];
    }[];
    classTeacherComment?: string;
    principalComment?: string;
    snapshotVersion: number;
  };
  settings: {
    showAttendance: boolean;
    showSubjectComments: boolean;
    showRank: boolean;
    signatureLabels: string;
    footerText: string;
    nextTermOpeningDate?: string | null;
  };
}

const INK = [30, 41, 59] as const; // slate-800
const MUTED = [100, 116, 139] as const; // slate-500

function header(doc: jsPDF, data: ReportCardPdfData, startY: number): number {
  let y = startY;
  const cx = PW / 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text(data.school.name.toUpperCase(), cx, y, { align: "center" });
  y += 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  if (data.school.address) {
    doc.text(data.school.address, cx, y, { align: "center" });
    y += 4.5;
  }
  if (data.school.motto) {
    doc.setFont("helvetica", "italic");
    doc.text(`"${data.school.motto}"`, cx, y, { align: "center" });
    y += 4.5;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(`TERM REPORT CARD — ${data.termName} ${data.yearName}`, cx, y + 1.5, { align: "center" });
  y += 6;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(M, y, PW - M, y);
  return y + 5;
}

function infoGrid(doc: jsPDF, data: ReportCardPdfData, startY: number): number {
  const cols: [string, string][] = [
    ["Student", data.student?.fullName ?? "—"],
    ["Admission No.", data.student?.admissionNumber ?? "—"],
    ["Class", data.classLabel],
    ["Term End", data.termEndDate ?? "—"],
  ];
  let y = startY;
  const colW = (PW - M * 2) / 2;
  cols.forEach(([label, value], i) => {
    const x = M + (i % 2) * colW;
    const yy = y + Math.floor(i / 2) * 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, yy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(value || "—", x, yy + 4.5);
  });
  return y + 10 + 6;
}

function attendanceBox(doc: jsPDF, data: ReportCardPdfData, startY: number): number {
  const a = data.card.attendance;
  if (!data.settings.showAttendance || !a) return startY;
  let y = startY;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(M, y, PW - M * 2, 13, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text("ATTENDANCE", M + 4, y + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `Present ${a.present}   ·   Absent ${a.absent}   ·   Late ${a.late}   ·   Excused ${a.excused}   —   ${a.percentage}%`,
    M + 4,
    y + 10,
  );
  return y + 17;
}

function subjectTable(doc: jsPDF, data: ReportCardPdfData, startY: number): number {
  let y = startY;
  const x0 = M;
  const wName = 52;
  const wComp = 62;
  const wScore = 20;
  const wPct = 18;
  const wGrade = (PW - M * 2) - (wName + wComp + wScore + wPct) - (data.settings.showSubjectComments ? 0 : 0);
  const wComment = data.settings.showSubjectComments ? wGrade : 0;
  const wGrade2 = data.settings.showSubjectComments ? 30 : wGrade;

  // Table header
  doc.setFillColor(226, 232, 240);
  doc.rect(x0, y, PW - M * 2, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...INK);
  let x = x0 + 2;
  doc.text("SUBJECT", x, y + 4.8);
  x += wName;
  doc.text("COMPONENTS", x, y + 4.8);
  x += wComp;
  doc.text("SCORE", x, y + 4.8);
  x += wScore;
  doc.text("%", x, y + 4.8);
  x += wPct;
  doc.text("GRADE", x, y + 4.8);
  if (data.settings.showSubjectComments) {
    x += wGrade2;
    doc.text("TEACHER REMARK", x, y + 4.8);
  }
  y += 7;

  doc.setFont("helvetica", "normal");
  for (const s of data.card.subjects) {
    // Components summary text
    const comp = s.components
      .map((c) => `${c.title} ${c.status === "entered" ? `${c.score ?? 0}/${c.maxMarks}` : c.status}`)
      .join(", ");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(comp || "—", wComp - 4) as string[];
    const rowH = Math.max(7, lines.length * 4 + 3);

    // Zebra row
    if (data.card.subjects.indexOf(s) % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(x0, y, PW - M * 2, rowH, "F");
    }

    let xx = x0 + 2;
    doc.setFont("helvetica", "bold");
    doc.text(s.subjectName, xx, y + 5);
    xx += wName;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(lines, xx, y + 4.2);
    xx += wComp;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(String(s.totalScore), xx, y + 5);
    xx += wScore;
    doc.text(`${s.percentage}`, xx, y + 5);
    xx += wPct;
    doc.text(s.gradeLabel ?? "—", xx, y + 5);
    if (data.settings.showSubjectComments) {
      xx += wGrade2;
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      const cLines = doc.splitTextToSize(s.teacherComment ?? "", wComment - 4) as string[];
      doc.text(cLines.slice(0, 2), xx, y + 4.2);
    }
    y += rowH;
  }
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(x0, y, PW - M, y);
  return y + 5;
}

function summaryRow(doc: jsPDF, data: ReportCardPdfData, startY: number): number {
  let y = startY;
  const cells: [string, string][] = [
    ["OVERALL AVERAGE", data.card.overallAverage != null ? `${data.card.overallAverage}%` : "—"],
    ["OVERALL GRADE", data.card.overallGrade ?? "—"],
    [
      "RANK",
      data.settings.showRank && data.card.rank
        ? `${data.card.rank} of ${data.card.classSize ?? "—"}`
        : "—",
    ],
  ];
  const cellW = (PW - M * 2) / 3;
  cells.forEach(([label, value], i) => {
    const x = M + i * cellW;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(x + 1, y, cellW - 2, 14, 1.5, 1.5, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label, x + 5, y + 5.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(value, x + 5, y + 11.5);
  });
  return y + 18;
}

function commentsBlock(doc: jsPDF, data: ReportCardPdfData, startY: number): number {
  let y = startY;
  const draw = (label: string, text: string | undefined) => {
    if (!text) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(text, PW - M * 2) as string[];
    doc.text(lines, M, y + 4.5);
    y += 4.5 + lines.length * 4.5 + 3;
  };
  draw("Class teacher's comment", data.card.classTeacherComment);
  draw("Principal's comment", data.card.principalComment);
  return y;
}

function footer(doc: jsPDF, data: ReportCardPdfData, startY: number) {
  const y = PH - 14;
  const labels = data.settings.signatureLabels
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(M, startY + 8, PW - M, startY + 8);
  // Signature lines
  const slot = (PW - M * 2) / Math.max(labels.length, 1);
  labels.forEach((label, i) => {
    const x = M + i * slot;
    doc.setDrawColor(100, 116, 139);
    doc.line(x, y - 8, x + slot - 12, y - 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(label, x, y - 4.5);
  });
  doc.setFontSize(7.5);
  const extras: string[] = [];
  if (data.settings.nextTermOpeningDate) extras.push(`Next term opens: ${data.settings.nextTermOpeningDate}`);
  if (data.settings.footerText) extras.push(data.settings.footerText);
  if (extras.length > 0) {
    doc.text(extras.join("   ·   "), PW / 2, y + 2, { align: "center" });
  }
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(
    `Snapshot v${data.card.snapshotVersion} · generated ${new Date().toLocaleDateString()}`,
    PW / 2,
    PH - 6,
    { align: "center" },
  );
}

/** Render one report card and return the jsPDF document. */
export function buildReportCardPdf(data: ReportCardPdfData): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  let y = header(doc, data, M);
  y = infoGrid(doc, data, y);
  y = attendanceBox(doc, data, y);
  y = subjectTable(doc, data, y);
  y = summaryRow(doc, data, y);
  y = commentsBlock(doc, data, y);
  footer(doc, data, y);
  return doc;
}

/** Download a single report card as PDF. */
export function downloadReportCardPdf(data: ReportCardPdfData) {
  buildReportCardPdf(data).save(
    `ReportCard-${data.student?.admissionNumber ?? "student"}-${data.termName}-${data.yearName}.pdf`,
  );
}

/** Download a whole class set, one A4 page per student. */
export function downloadClassReportCardsPdf(items: ReportCardPdfData[]) {
  if (items.length === 0) return;
  const doc = buildReportCardPdf(items[0]);
  for (let i = 1; i < items.length; i++) {
    doc.addPage("a4", "portrait");
    // Re-render onto the new page by drawing with an offset helper.
    const data = items[i];
    let y = header(doc, data, M);
    y = infoGrid(doc, data, y);
    y = attendanceBox(doc, data, y);
    y = subjectTable(doc, data, y);
    y = summaryRow(doc, data, y);
    y = commentsBlock(doc, data, y);
    footer(doc, data, y);
  }
  doc.save(`ReportCards-${items[0].classLabel.replace(/\s+/g, "")}-${items[0].termName}-${items[0].yearName}.pdf`);
}
