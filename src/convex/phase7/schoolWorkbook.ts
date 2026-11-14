/**
 * SchoolCore pilot multi-sheet onboarding importer.
 * Only school_admin may view/commit workbook rows. Platform super_admin is
 * explicitly denied, even when they enter a school context.
 *
 * All master data is written in one Convex mutation after server-side revalidation.
 * No passwords, live payment claims or provider settlement records are imported.
 * Opening balances are staged for a DIFFERENT accountant to approve later.
 */
import { ConvexError, v } from "convex/values";
import { query, mutation, type QueryCtx, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireSchoolSession } from "../session";
import { recordAudit } from "../audit";
import { ensureStudentAccount } from "../finance";
import { validateWorkbook, type SchoolWorkbook, type WorkbookIssue } from "../../lib/schoolWorkbookValidation";

const WORKBOOK = v.record(v.string(), v.array(v.record(v.string(), v.string())));
type Context = QueryCtx | MutationCtx;
const trim = (v: string | undefined) => (v ?? "").trim();
const low = (v: string | undefined) => trim(v).toLowerCase();
const yn = (v: string | undefined) => low(v) === "yes";
const num = (v: string | undefined) => Number(v ?? 0);
const opt = (v: string | undefined) => trim(v) || undefined;
const rows = (data: SchoolWorkbook, name: string) => data[name] ?? [];
function must<T>(value: T | null | undefined, explanation: string): NonNullable<T> {
  if (value === undefined || value === null) throw new ConvexError(explanation);
  return value;
}

async function schoolAdmin(ctx: Context) {
  const session = await requireSchoolSession(ctx);
  if (session.isPlatform || session.role.role !== "school_admin") {
    throw new ConvexError("Only an assigned school administrator can upload and review the school's workbook.");
  }
  const school = await ctx.db.get(session.schoolId);
  if (!school) throw new ConvexError("School record not found.");
  return { session, school };
}

/** Pilot only: fail closed on an existing populated school. Protects real tenants. */
async function serverIssues(ctx: Context, schoolId: Id<"schools">, sheets: SchoolWorkbook): Promise<WorkbookIssue[]> {
  const warnings: WorkbookIssue[]=[];
  const problem=(sheet:string,field:string,message:string) => warnings.push({sheet,row:1,field,message,severity:"error"});
  const checks = [
    ["students",await ctx.db.query("students").withIndex("by_school",q=>q.eq("schoolId",schoolId)).first()],
    ["staff",await ctx.db.query("staff").withIndex("by_school",q=>q.eq("schoolId",schoolId)).first()],
    ["guardians",await ctx.db.query("guardians").withIndex("by_school",q=>q.eq("schoolId",schoolId)).first()],
    ["academicYears",await ctx.db.query("academicYears").withIndex("by_school",q=>q.eq("schoolId",schoolId)).first()],
    ["hostels",await ctx.db.query("hostels").withIndex("by_school",q=>q.eq("schoolId",schoolId)).first()],
    ["transportRoutes",await ctx.db.query("transportRoutes").withIndex("by_school",q=>q.eq("schoolId",schoolId)).first()],
    ["feeStructures",await ctx.db.query("feeStructures").withIndex("by_school",q=>q.eq("schoolId",schoolId)).first()],
  ] as const;
  for (const [table,existing] of checks) if (existing) problem("School", "schoolCode", `This school already has ${table} records. Pilot full-workbook import requires an empty test tenant.`);
  const present=Object.values(sheets).reduce((total,rs)=>total+rs.length,0);
  if (present>200) problem("School","rows","Pilot transaction maximum is 200 rows across all worksheets.");
  const required=rows(sheets,"Students").length;
  if(required===0) problem("Students","admissionNumber","At least one student is required for test onboarding.");
  return warnings;
}

/** Never writes anything; returns row-level errors to the school admin. */
export const preview = query({
  args: { sheets: WORKBOOK },
  handler: async(ctx,{sheets}) => {
    const { session,school }=await schoolAdmin(ctx);
    const local=validateWorkbook(sheets,school.code);
    const found=await serverIssues(ctx,session.schoolId,sheets);
    const errors=[...local.issues,...found];
    return {
      schoolCode:school.code,
      totalRows:local.totalRows,
      errorCount:errors.filter(i=>i.severity==="error").length,
      errors,
      ready:errors.every(i=>i.severity!=="error"),
      pendingFinanceRows:rows(sheets,"Opening_Balances").length,
      noCredentialsCreated:true,
    };
  },
});

export const confirm = mutation({
  args: { sheets: WORKBOOK, confirmSchoolCode: v.string() },
  handler: async(ctx,{sheets,confirmSchoolCode}) => {
    const { session,school }=await schoolAdmin(ctx);
    const schoolId=session.schoolId;
    if (confirmSchoolCode.trim()!==school.code) throw new ConvexError("Type the exact school code to confirm this import.");
    const local=validateWorkbook(sheets,school.code);
    const server=await serverIssues(ctx,schoolId,sheets);
    const bad=[...local.errors,...server];
    if (bad.length>0) {
      const first=bad[0];
      throw new ConvexError(`Import blocked: ${bad.length} error(s). ${first.sheet} row ${first.row} (${first.field}): ${first.message}`);
    }
    const schoolRow=must(rows(sheets,"School")[0],"School worksheet is required.");
    await ctx.db.patch(schoolId,{
      email:opt(schoolRow.email),phone:opt(schoolRow.phone),county:opt(schoolRow.county),
      country:opt(schoolRow.country),physicalAddress:opt(schoolRow.physicalAddress),
      curriculum:opt(schoolRow.curriculum),currency:"KES",timezone:opt(schoolRow.timeZone),
    });

    const years=new Map<string,Id<"academicYears">>();
    const terms=new Map<string,Id<"terms">>();
    const grades=new Map<string,Id<"gradeLevels">>();
    const classes=new Map<string,Id<"classSections">>();
    const subjects=new Map<string,Id<"subjects">>();
    const staff=new Map<string,Id<"staff">>();
    const guardians=new Map<string,Id<"guardians">>();
    const students=new Map<string,Id<"students">>();
    const hostels=new Map<string,Id<"hostels">>();
    const dormRooms=new Map<string,Id<"hostelRooms">>();
    const beds=new Map<string,Id<"beds">>();
    const feeStructures=new Map<string,Id<"feeStructures">>();
    const routes=new Map<string,Id<"transportRoutes">>();
    const today=new Date().toISOString().slice(0,10);

    // Academics, then staff identities, classes and teaching allocations.
    for(const y of rows(sheets,"Years")) {
      const id=await ctx.db.insert("academicYears",{schoolId,name:trim(y.name),startDate:trim(y.startDate),endDate:trim(y.endDate),isCurrent:yn(y.isCurrent),status:trim(y.status)||"active"});
      years.set(low(y.yearKey),id);
    }
    for(const t of rows(sheets,"Terms")) {
      const id=await ctx.db.insert("terms",{schoolId,academicYearId:must(years.get(low(t.yearKey)),"Year reference not found"),name:trim(t.name),startDate:trim(t.startDate),endDate:trim(t.endDate),status:"active",isCurrent:yn(t.isCurrent),displayOrder:num(t.displayOrder)||1});
      terms.set(low(t.termKey),id);
    }
    for(const g of rows(sheets,"Grades")) {
      const id=await ctx.db.insert("gradeLevels",{schoolId,name:trim(g.name),displayOrder:num(g.displayOrder)||1,status:"active"});
      grades.set(low(g.gradeKey),id);
    }
    for(const s of rows(sheets,"Subjects")) {
      const id=await ctx.db.insert("subjects",{schoolId,name:trim(s.subjectName),code:trim(s.subjectCode),shortName:opt(s.shortName),status:"active"});
      subjects.set(low(s.subjectCode),id);
    }
    const departments=new Map<string,Id<"departments">>();
    for(const p of rows(sheets,"Staff")) {
      let deptId:Id<"departments">|undefined;
      if(trim(p.department)) {
        const dep=low(p.department);
        if(!departments.has(dep)) departments.set(dep,await ctx.db.insert("departments",{schoolId,name:trim(p.department),status:"active"}));
        deptId=departments.get(dep);
      }
      const id=await ctx.db.insert("staff",{schoolId,employeeNumber:trim(p.employeeNumber),firstName:trim(p.firstName),lastName:trim(p.lastName),gender:opt(p.gender),email:opt(p.email),phone:opt(p.phone),department:opt(p.department),jobTitle:opt(p.jobTitle),employmentType:opt(p.employmentType),employmentStatus:trim(p.employmentStatus)||"active",hireDate:opt(p.hireDate),updatedAt:Date.now()});
      staff.set(low(p.employeeNumber),id);
      await ctx.db.insert("employees",{schoolId,staffId:id,departmentId:deptId,jobTitle:opt(p.jobTitle),hireDate:opt(p.hireDate),status:"active"});
    }
    for(const c of rows(sheets,"Classes")) {
      const id=await ctx.db.insert("classSections",{schoolId,academicYearId:must(years.get(low(c.yearKey)),"Class year missing"),gradeLevelId:must(grades.get(low(c.gradeKey)),"Class grade missing"),streamName:trim(c.streamName),capacity:num(c.capacity)||undefined,classTeacherStaffId:staff.get(low(c.classTeacherEmployeeNo)),status:"active"});
      classes.set(low(c.classKey),id);
    }
    for(const a of rows(sheets,"Teacher_Assignments")) {
      await ctx.db.insert("teacherAllocations",{schoolId,staffId:must(staff.get(low(a.employeeNumber)),"Staff missing"),academicYearId:must(years.get(low(rows(sheets,"Classes").find(c=>low(c.classKey)===low(a.classKey))?.yearKey)),"Academic year missing"),classSectionId:must(classes.get(low(a.classKey)),"Class missing"),subjectId:must(subjects.get(low(a.subjectCode)),"Subject missing"),termId:terms.get(low(a.termKey)),status:"active"});
    }

    // Guardians are separate people; links explicitly capture parental permissions.
    for(const g of rows(sheets,"Guardians")) {
      const id=await ctx.db.insert("guardians",{schoolId,firstName:trim(g.firstName),lastName:trim(g.lastName),relationship:opt(g.relationship),email:opt(g.email),phone:opt(g.phone),altPhone:opt(g.alternatePhone),address:opt(g.address),occupation:opt(g.occupation),status:"active",updatedAt:Date.now()});
      guardians.set(low(g.guardianKey),id);
    }
    for(const s of rows(sheets,"Students")) {
      const id=await ctx.db.insert("students",{schoolId,admissionNumber:trim(s.admissionNumber),firstName:trim(s.firstName),middleName:opt(s.middleName),lastName:trim(s.lastName),gender:trim(s.gender),dateOfBirth:opt(s.dateOfBirth),admissionDate:trim(s.admissionDate)||today,nationality:opt(s.nationality),studentStatus:"active",boardingStatus:low(s.boardingStatus)==="boarding"?"boarding":"day",previousSchool:opt(s.previousSchool),notes:opt(s.notes),updatedAt:Date.now()});
      students.set(low(s.admissionNumber),id);
      const classKey=low(s.classKey);
      const classRow=must(rows(sheets,"Classes").find(c=>low(c.classKey)===classKey),"Referenced class row missing");
      await ctx.db.insert("enrollments",{schoolId,studentId:id,academicYearId:must(years.get(low(classRow.yearKey)),"Year missing"),classSectionId:must(classes.get(classKey),"Class missing"),enrollmentDate:trim(s.admissionDate)||today,status:"active"});
      await ensureStudentAccount(ctx,schoolId,id);
    }
    for(const l of rows(sheets,"Guardian_Links")) {
      await ctx.db.insert("guardianStudents",{schoolId,studentId:must(students.get(low(l.admissionNumber)),"Student missing"),guardianId:must(guardians.get(low(l.guardianKey)),"Guardian missing"),relationship:opt(l.relationship),isPrimary:yn(l.isPrimary),isEmergencyContact:yn(l.isEmergencyContact),receivesAcademicCommunication:yn(l.receivesAcademicCommunication),receivesFinancialCommunication:yn(l.receivesFinancialCommunication),pickupAuthorized:yn(l.pickupAuthorized)});
    }

    // Boarding: all relationships constructed with IDs from the current school.
    for(const d of rows(sheets,"Dormitories")) {
      const id=await ctx.db.insert("hostels",{schoolId,name:trim(d.name),gender:opt(d.gender),capacity:num(d.capacity)||undefined,wardenStaffId:staff.get(low(d.wardenEmployeeNo)),status:"active"});
      hostels.set(low(d.dormKey),id);
    }
    for(const r of rows(sheets,"Rooms")) {
      const id=await ctx.db.insert("hostelRooms",{schoolId,hostelId:must(hostels.get(low(r.dormKey)),"Dorm not found"),roomNumber:trim(r.roomNumber),capacity:num(r.capacity),status:"active"});
      dormRooms.set(low(r.roomKey),id);
    }
    for(const b of rows(sheets,"Beds")) {
      const id=await ctx.db.insert("beds",{schoolId,roomId:must(dormRooms.get(low(b.roomKey)),"Room not found"),bedNumber:trim(b.bedNumber),status:"free"});
      beds.set(low(b.bedKey),id);
    }
    for(const a of rows(sheets,"Bed_Assignments")) {
      const bedRow=must(rows(sheets,"Beds").find(b=>low(b.bedKey)===low(a.bedKey)),"Bed missing");
      const roomRow=must(rows(sheets,"Rooms").find(r=>low(r.roomKey)===low(bedRow.roomKey)),"Room missing");
      const status=low(a.status)==="ended"?"ended":"active";
      const bedId=must(beds.get(low(a.bedKey)),"Bed missing");
      await ctx.db.insert("boardingAllocations",{schoolId,studentId:must(students.get(low(a.admissionNumber)),"Student missing"),bedId,roomId:must(dormRooms.get(low(bedRow.roomKey)),"Room missing"),hostelId:must(hostels.get(low(roomRow.dormKey)),"Dorm missing"),academicYearId:years.get(low(a.yearKey)),startDate:trim(a.startDate)||today,status,allocatedById:session.userId,createdAt:Date.now()});
      if(status==="active") await ctx.db.patch(bedId,{status:"occupied"});
    }

    // Fee structures are DRAFTS. No invoices/receipts are generated by import.
    for(const f of rows(sheets,"Fee_Structures")) {
      const id=await ctx.db.insert("feeStructures",{schoolId,academicYearId:must(years.get(low(f.yearKey)),"Year missing"),termId:must(terms.get(low(f.termKey)),"Term missing"),name:trim(f.name),applicableGradeLevelIds:[must(grades.get(low(f.gradeKey)),"Grade missing")],status:"inactive",createdBy:session.userId});
      feeStructures.set(low(f.feeStructureKey),id);
    }
    for(const f of rows(sheets,"Fee_Items")) {
      await ctx.db.insert("feeItems",{schoolId,feeStructureId:must(feeStructures.get(low(f.feeStructureKey)),"Fee structure missing"),name:trim(f.itemName),category:trim(f.category),amount:num(f.amountKES),mandatory:yn(f.mandatory),status:"inactive"});
    }

    // Transport: route fees are descriptive workbook metadata only until a
    // finance-authorized fee schedule is configured; not charged on import.
    for(const r of rows(sheets,"Transport_Routes")) {
      const id=await ctx.db.insert("transportRoutes",{schoolId,name:trim(r.routeName),status:"active"});
      routes.set(low(r.routeKey),id);
      if(trim(r.pickupPoint)) await ctx.db.insert("routeStops",{schoolId,routeId:id,stopName:trim(r.pickupPoint),pickupTime:trim(r.pickupTime),displayOrder:1});
    }
    const routeFeeRows=rows(sheets,"Transport_Routes").filter(r=>trim(r.feeKES));
    if(routeFeeRows.length) await ctx.db.insert("importJobs",{
      schoolId,kind:"transport_fees_review",filename:"school-workbook.xlsx",status:"validated",columnMap:{},
      rowsTotal:routeFeeRows.length,rowsValid:routeFeeRows.length,rowsInvalid:0,errors:[],
      stagedRows:routeFeeRows,dedupeStrategy:"skip",createdById:session.userId,createdAt:Date.now(),
    });
    for(const a of rows(sheets,"Transport_Assignments")) {
      await ctx.db.insert("transportAssignments",{schoolId,studentId:must(students.get(low(a.admissionNumber)),"Student missing"),routeId:must(routes.get(low(a.routeKey)),"Route missing"),direction:trim(a.direction)||"both",academicYearId:years.values().next().value,status:"active",assignedById:session.userId,assignedAt:Date.now()});
    }

    const balanceRows=rows(sheets,"Opening_Balances");
    let reviewJob:Id<"importJobs">|null=null;
    if(balanceRows.length) reviewJob=await ctx.db.insert("importJobs",{
      schoolId,kind:"opening_balances",filename:"school-workbook.xlsx",status:"validated",columnMap:{},
      rowsTotal:balanceRows.length,rowsValid:balanceRows.length,rowsInvalid:0,errors:[],
      stagedRows:balanceRows,dedupeStrategy:"skip",createdById:session.userId,createdAt:Date.now(),
    });
    const record=await ctx.db.query("onboardingRecords").withIndex("by_school",q=>q.eq("schoolId",schoolId)).first();
    if(record) await ctx.db.patch(record._id,{importDone:true,updatedAt:Date.now()});
    await recordAudit(ctx,{userId:session.userId,schoolId,action:"school.workbook.imported",entityType:"importJobs",entityId:reviewJob??null,description:`School workbook imported (${local.totalRows} rows), ${balanceRows.length} opening balances pending independent finance approval`});
    return {ok:true as const,schoolCode:school.code,rowsProcessed:local.totalRows,students:students.size,guardians:guardians.size,staff:staff.size,boarders:rows(sheets,"Bed_Assignments").length,openingBalancesPending:balanceRows.length,transportFeesPending:routeFeeRows.length,financeReviewJobId:reviewJob};
  },
});

/** School accountant only; staged cutover debt is NOT a provider payment. */
export const pendingOpeningBalances = query({
  args:{},
  handler: async(ctx) => {
    const session=await requireSchoolSession(ctx);
    if(session.isPlatform || !["accountant","school_admin"].includes(session.role.role)) throw new ConvexError("Finance approval is school scoped.");
    return (await ctx.db.query("importJobs").withIndex("by_school",q=>q.eq("schoolId",session.schoolId)).collect())
      .filter(job=>job.kind==="opening_balances" && job.status==="validated")
      .map(job=>({_id:job._id,createdAt:job.createdAt,rowsTotal:job.rowsTotal,stagedRows:job.stagedRows}));
  },
});

export const approveOpeningBalances = mutation({
  args:{jobId:v.id("importJobs")},
  handler:async(ctx,{jobId})=>{
    const session=await requireSchoolSession(ctx);
    if(session.isPlatform || session.role.role!=="accountant") throw new ConvexError("A separate school accountant must approve opening balances.");
    const job=await ctx.db.get(jobId);
    if(!job || job.schoolId!==session.schoolId || job.kind!=="opening_balances" || job.status!=="validated") throw new ConvexError("Pending finance review not found in this school.");
    if(job.createdById===session.userId) throw new ConvexError("You cannot approve your own import.");
    const map=new Map((await ctx.db.query("students").withIndex("by_school",q=>q.eq("schoolId",session.schoolId)).collect()).map(s=>[low(s.admissionNumber),s._id]));
    for(const r of job.stagedRows) {
      const student=map.get(low(r.admissionNumber));
      if(!student) throw new ConvexError("Student missing from finance review.");
      const account=await ctx.db.query("studentAccounts").withIndex("by_school_student",q=>q.eq("schoolId",session.schoolId).eq("studentId",student)).first();
      if(!account || account.openingBalance!==0) throw new ConvexError("Account is missing or opening balance already set; cannot double-post.");
      const txns=await ctx.db.query("ledgerTransactions").withIndex("by_student",q=>q.eq("studentId",student)).first();
      if(txns) throw new ConvexError("Student already has financial transactions; cutover requires manual reconciliation.");
      if(!Number.isFinite(Number(r.openingBalanceKES)) || Number(r.openingBalanceKES)<0) throw new ConvexError("Invalid opening balance.");
    }
    for(const r of job.stagedRows) {
      const sid=must(map.get(low(r.admissionNumber)),"Student missing");
      const account=must(await ctx.db.query("studentAccounts").withIndex("by_school_student",q=>q.eq("schoolId",session.schoolId).eq("studentId",sid)).first(),"Account missing");
      await ctx.db.patch(account._id,{openingBalance:Number(r.openingBalanceKES),updatedAt:Date.now()});
    }
    await ctx.db.patch(jobId,{status:"imported",completedAt:Date.now()});
    await recordAudit(ctx,{userId:session.userId,schoolId:session.schoolId,action:"school.opening_balances.approved",entityType:"importJobs",entityId:jobId,description:`Approved ${job.rowsTotal} reviewed opening balances (historical cutover only; no payments created)`});
    return {ok:true as const,approved:job.rowsTotal};
  },
});
