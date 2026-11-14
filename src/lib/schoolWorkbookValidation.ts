/** SchoolCore workbook v1: pure, deterministic structural validation.
 * No PII is logged. Row numbers correspond to Excel rows (header is row 1).
 */
export type SheetRow = Record<string, string>;
export type SchoolWorkbook = Record<string, SheetRow[]>;
export type WorkbookIssue = { sheet: string; row: number; field: string; message: string; severity: "error" | "warning" };

export const IMPORT_SHEETS = [
  "School", "Years", "Terms", "Grades", "Classes", "Subjects", "Staff", "Guardians", "Students",
  "Guardian_Links", "Teacher_Assignments", "Dormitories", "Rooms", "Beds", "Bed_Assignments",
  "Fee_Structures", "Fee_Items", "Opening_Balances", "Transport_Routes", "Transport_Assignments",
] as const;

export const REQUIRED_HEADERS: Record<string, string[]> = {
  School: ["schoolCode", "schoolName", "currency"],
  Years: ["yearKey", "name", "startDate", "endDate"],
  Terms: ["termKey", "yearKey", "name", "startDate", "endDate"],
  Grades: ["gradeKey", "name"],
  Classes: ["classKey", "yearKey", "gradeKey", "streamName"],
  Subjects: ["subjectCode", "subjectName"],
  Staff: ["employeeNumber", "firstName", "lastName"],
  Guardians: ["guardianKey", "firstName", "lastName", "phone"],
  Students: ["admissionNumber", "firstName", "lastName", "classKey", "boardingStatus"],
  Guardian_Links: ["admissionNumber", "guardianKey", "relationship"],
  Teacher_Assignments: ["employeeNumber", "classKey", "subjectCode"],
  Dormitories: ["dormKey", "name"],
  Rooms: ["roomKey", "dormKey", "roomNumber", "capacity"],
  Beds: ["bedKey", "roomKey", "bedNumber"],
  Bed_Assignments: ["admissionNumber", "bedKey", "yearKey"],
  Fee_Structures: ["feeStructureKey", "yearKey", "termKey", "name", "gradeKey"],
  Fee_Items: ["feeStructureKey", "itemCode", "itemName", "category", "amountKES"],
  Opening_Balances: ["admissionNumber", "invoicedKES", "previouslyPaidKES", "creditNotesKES", "openingBalanceKES", "financeReview"],
  Transport_Routes: ["routeKey", "routeName"],
  Transport_Assignments: ["admissionNumber", "routeKey", "direction"],
};

const key = (v: string | undefined) => (v ?? "").trim().toLowerCase();
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const money = (s: string) => s.trim() !== "" && Number.isFinite(Number(s)) && Number(s) >= 0;

/** Offline validation is repeated on the Convex server at confirm time. */
export function validateWorkbook(sheets: SchoolWorkbook, expectedCode?: string) {
  const issues: WorkbookIssue[] = [];
  const problem = (sheet: string, row: number, field: string, message: string, severity: "error" | "warning" = "error") =>
    issues.push({ sheet, row, field, message, severity });
  for (const name of IMPORT_SHEETS) {
    if (!(name in sheets)) problem(name, 1, "sheet", `Required worksheet ${name} is missing.`);
    if ((sheets[name] ?? []).length > 60) problem(name, 1, "sheet", "Pilot import limit is 60 data rows per worksheet. For larger schools use the queued production importer.");
    for (const [i, row] of (sheets[name] ?? []).entries()) {
      for (const field of REQUIRED_HEADERS[name]) {
        if (!Object.prototype.hasOwnProperty.call(row, field)) problem(name, 1, field, `Missing column ${field}.`);
        else if (!String(row[field] ?? "").trim()) {
          if (!(name === "Opening_Balances" && field === "financeReview")) problem(name, i + 2, field, "Required value is blank.");
        }
      }
    }
  }
  const map: Record<string, Set<string>> = {};
  function unique(sheet: string, column: string) {
    const vals = new Set<string>();
    for (const [i, row] of (sheets[sheet] ?? []).entries()) {
      const v = key(row[column]);
      if (!v) continue;
      if (vals.has(v)) problem(sheet, i + 2, column, `Duplicate key ${row[column]}.`);
      vals.add(v);
    }
    map[sheet] = vals;
  }
  for (const [sheet, field] of [
    ["Years","yearKey"],["Terms","termKey"],["Grades","gradeKey"],["Classes","classKey"],
    ["Subjects","subjectCode"],["Staff","employeeNumber"],["Guardians","guardianKey"],
    ["Students","admissionNumber"],["Dormitories","dormKey"],["Rooms","roomKey"],
    ["Beds","bedKey"],["Fee_Structures","feeStructureKey"],["Transport_Routes","routeKey"],
  ] as [string,string][]) unique(sheet,field);
  const checkRef = (sheet: string, row: SheetRow, i: number, field: string, target: string, optional = false) => {
    const value = key(row[field]);
    if (!value && optional) return;
    if (!map[target]?.has(value)) problem(sheet, i + 2, field, `Unknown ${target} reference: ${row[field] ?? "(blank)"}.`);
  };
  const school = (sheets.School ?? [])[0];
  if ((sheets.School ?? []).length !== 1) problem("School", 1, "school", "Exactly one School row is required.");
  if (school && expectedCode && key(school.schoolCode) !== key(expectedCode)) problem("School", 2, "schoolCode", "Workbook school code does not match your current school. This is a tenant isolation rule.");
  if (school && key(school.currency) !== "kes") problem("School", 2, "currency", "Pilot importer expects KES only.");
  const dobMap = new Map((sheets.Students ?? []).map(s => [key(s.admissionNumber),key(s.gender)]));
  const dormMap = new Map((sheets.Dormitories ?? []).map(d => [key(d.dormKey),key(d.gender)]));
  const roomDorm = new Map((sheets.Rooms ?? []).map(r => [key(r.roomKey),key(r.dormKey)]));
  const bedRoom = new Map((sheets.Beds ?? []).map(b => [key(b.bedKey),key(b.roomKey)]));
  for (const [sheet, rows] of Object.entries(sheets)) {
    if (!(IMPORT_SHEETS as readonly string[]).includes(sheet)) continue;
    rows.forEach((row,i) => {
      if (sheet === "Terms" || sheet === "Classes" || sheet === "Fee_Structures" || sheet === "Bed_Assignments") checkRef(sheet,row,i,"yearKey","Years",sheet === "Fee_Structures" ? false : false);
      if (sheet === "Terms") {
        for (const f of ["startDate","endDate"]) if (row[f] && !validDate(row[f])) problem(sheet,i+2,f,"Expected ISO date YYYY-MM-DD.");
        if (row.endDate && row.startDate && row.endDate < row.startDate) problem(sheet,i+2,"endDate","Term end must be after start.");
      }
      if (sheet === "Classes") {
        checkRef(sheet,row,i,"gradeKey","Grades");
        checkRef(sheet,row,i,"classTeacherEmployeeNo","Staff",true);
      }
      if (sheet === "Students") {
        checkRef(sheet,row,i,"classKey","Classes");
        if (!['male','female','other'].includes(key(row.gender))) problem(sheet,i+2,"gender","Use male, female or other.");
        if (!['boarding','day'].includes(key(row.boardingStatus))) problem(sheet,i+2,"boardingStatus","Use boarding or day.");
        if (row.dateOfBirth && !validDate(row.dateOfBirth)) problem(sheet,i+2,"dateOfBirth","Expected ISO date YYYY-MM-DD.");
      }
      if (sheet === "Guardian_Links") {
        checkRef(sheet,row,i,"admissionNumber","Students");
        checkRef(sheet,row,i,"guardianKey","Guardians");
      }
      if (sheet === "Teacher_Assignments") {
        checkRef(sheet,row,i,"employeeNumber","Staff");
        checkRef(sheet,row,i,"classKey","Classes");
        checkRef(sheet,row,i,"subjectCode","Subjects");
        checkRef(sheet,row,i,"termKey","Terms",true);
      }
      if (sheet === "Dormitories") checkRef(sheet,row,i,"wardenEmployeeNo","Staff",true);
      if (sheet === "Rooms") {
        checkRef(sheet,row,i,"dormKey","Dormitories");
        if (!Number.isInteger(Number(row.capacity)) || Number(row.capacity) < 1) problem(sheet,i+2,"capacity","Room capacity must be a positive integer.");
      }
      if (sheet === "Beds") checkRef(sheet,row,i,"roomKey","Rooms");
      if (sheet === "Bed_Assignments") {
        checkRef(sheet,row,i,"admissionNumber","Students");
        checkRef(sheet,row,i,"bedKey","Beds");
        const gender = dobMap.get(key(row.admissionNumber));
        const dormGender = dormMap.get(roomDorm.get(bedRoom.get(key(row.bedKey)) ?? "") ?? "");
        if (gender && dormGender && dormGender !== "other" && gender !== dormGender) problem(sheet,i+2,"bedKey","Assigned bed is in a gender-incompatible dormitory.");
        if (!['active','ended'].includes(key(row.status))) problem(sheet,i+2,"status","Use active or ended.");
      }
      if (sheet === "Fee_Structures") {
        checkRef(sheet,row,i,"termKey","Terms");
        checkRef(sheet,row,i,"gradeKey","Grades");
      }
      if (sheet === "Fee_Items") {
        checkRef(sheet,row,i,"feeStructureKey","Fee_Structures");
        if (!money(row.amountKES ?? "")) problem(sheet,i+2,"amountKES","KES amount must be a non-negative number.");
      }
      if (sheet === "Opening_Balances") {
        checkRef(sheet,row,i,"admissionNumber","Students");
        for (const f of ["invoicedKES","previouslyPaidKES","creditNotesKES","openingBalanceKES"]) if (!money(row[f] ?? "")) problem(sheet,i+2,f,"Enter a non-negative KES amount.");
        if (["invoicedKES","previouslyPaidKES","creditNotesKES","openingBalanceKES"].every(f => money(row[f] ?? ""))) {
          const expected = Number(row.invoicedKES)-Number(row.previouslyPaidKES)-Number(row.creditNotesKES);
          if (Math.abs(expected-Number(row.openingBalanceKES)) > 0.01) problem(sheet,i+2,"openingBalanceKES","Does not equal invoiced - paid - credits.");
        }
        if (key(row.financeReview)!=='pending') problem(sheet,i+2,"financeReview","Balances must begin in PENDING finance review state.");
      }
      if (sheet === "Transport_Routes") {
        if (row.pickupTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.pickupTime)) problem(sheet,i+2,"pickupTime","Use 24-hour HH:MM format.");
        if (row.feeKES && !money(row.feeKES)) problem(sheet,i+2,"feeKES","Transport fee must be non-negative KES.");
      }
      if (sheet === "Transport_Assignments") {
        checkRef(sheet,row,i,"admissionNumber","Students");
        checkRef(sheet,row,i,"routeKey","Transport_Routes");
      }
    });
  }
  for (const [sheet, fields] of [["Guardian_Links",["admissionNumber","guardianKey"]],["Teacher_Assignments",["employeeNumber","classKey","subjectCode","termKey"]],["Bed_Assignments",["admissionNumber"]],["Bed_Assignments",["bedKey"]],["Fee_Items",["feeStructureKey","itemCode"]],["Opening_Balances",["admissionNumber"]],["Transport_Assignments",["admissionNumber","routeKey"]]] as [string,string[]][]) {
    const seen = new Set<string>();
    (sheets[sheet] ?? []).forEach((row,i) => {
      const k = fields.map(f=>key(row[f])).join('|');
      if(seen.has(k)) problem(sheet,i+2,fields.join('+'),"Duplicate relationship or assignment in workbook.");
      seen.add(k);
    });
  }
  const guardianLinks=new Map<string,number>();
  const primaryLinks=new Map<string,number>();
  (sheets.Guardian_Links??[]).forEach((r)=>{
    const k=key(r.admissionNumber); guardianLinks.set(k,(guardianLinks.get(k)??0)+1);
    if(key(r.isPrimary)==="yes") primaryLinks.set(k,(primaryLinks.get(k)??0)+1);
  });
  (sheets.Students??[]).forEach((r,i)=>{
    const k=key(r.admissionNumber);
    if(!guardianLinks.has(k)) problem("Students",i+2,"admissionNumber","Every student must have an authorized Guardian_Links row.");
    if((primaryLinks.get(k)??0)!==1) problem("Guardian_Links",1,"isPrimary",`Student ${r.admissionNumber} must have exactly one primary guardian.`);
  });
  const counts=new Map<string,number>();
  (sheets.Students??[]).forEach(r=>counts.set(key(r.classKey),(counts.get(key(r.classKey))??0)+1));
  (sheets.Classes??[]).forEach((r,i)=>{
    if(r.capacity && (!Number.isInteger(Number(r.capacity))||Number(r.capacity)<1)) problem("Classes",i+2,"capacity","Capacity must be a positive integer.");
    if(Number(r.capacity)>0 && (counts.get(key(r.classKey))??0)>Number(r.capacity)) problem("Classes",i+2,"capacity","Enrolled learners exceed class capacity.");
  });

  (sheets.Bed_Assignments??[]).forEach((r,i)=>{
    const pupil=(sheets.Students??[]).find(s=>key(s.admissionNumber)===key(r.admissionNumber));
    if(pupil&&key(pupil.boardingStatus)!=="boarding") problem("Bed_Assignments",i+2,"admissionNumber","A day student cannot be allocated a boarding bed.");
  });
  const bedCounts=new Map<string,number>();
  (sheets.Beds??[]).forEach(b=>bedCounts.set(key(b.roomKey),(bedCounts.get(key(b.roomKey))??0)+1));
  (sheets.Rooms??[]).forEach((r,i)=>{if((bedCounts.get(key(r.roomKey))??0)>Number(r.capacity)) problem("Rooms",i+2,"capacity","Number of beds exceeds declared room capacity.");});
  // Stable layout: sort by worksheet order then Excel line.
  issues.sort((a,b)=>IMPORT_SHEETS.indexOf(a.sheet as (typeof IMPORT_SHEETS)[number])-IMPORT_SHEETS.indexOf(b.sheet as (typeof IMPORT_SHEETS)[number]) || a.row-b.row);
  return { issues, errors: issues.filter(i=>i.severity==='error'), totalRows: IMPORT_SHEETS.reduce((s,n)=>s+(sheets[n]?.length ?? 0),0) };
}
