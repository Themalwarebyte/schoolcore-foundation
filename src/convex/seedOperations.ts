import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Phase 5 operations-ERP seeding (HR, payroll, library, transport, boarding,
 * inventory, procurement, medical) — idempotent, safe to run repeatedly.
 *
 * Identity rule: employees extend existing staff records, library/transport/
 * boarding/medical attach to existing students. No duplicate people are
 * created and every row is school-scoped.
 */
export const seedOperations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const schools = await ctx.db.query("schools").collect();
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const summary = {
      departments: 0, employees: 0, contracts: 0, leaveTypes: 0, leaveRequests: 0,
      salaryStructures: 0, payrollRuns: 0, payslips: 0, books: 0, loans: 0,
      vehicles: 0, routes: 0, assignments: 0, hostels: 0, allocations: 0,
      assets: 0, inventoryItems: 0, suppliers: 0, purchaseRequests: 0,
      medicalProfiles: 0, clinicVisits: 0,
    };

    for (const school of schools) {
      const schoolId = school._id;
      const isGreenfield = school.code === "GRN-001";
      const admin = await ctx.db
        .query("users")
        .withIndex("email", (q) =>
          q.eq("email", isGreenfield ? "admin@greenfield.ac.ke" : "admin@riverside.ac.ke"),
        )
        .first();
      if (!admin) continue;
      const staff = await ctx.db
        .query("staff")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      if (staff.length === 0) continue;
      const students = await ctx.db
        .query("students")
        .withIndex("by_school_status", (q) => q.eq("schoolId", schoolId).eq("studentStatus", "active"))
        .collect();

      /* ---------- HR: departments ---------- */
      const deptDefs = [
        { name: "Administration", description: "School administration and support" },
        { name: "Teaching", description: "Academic staff" },
        { name: "Finance", description: "Bursary and accounts" },
        { name: "Health", description: "Clinic and wellness" },
      ];
      const deptByName = new Map<string, Id<"departments">>();
      for (const d of deptDefs) {
        const existing = await ctx.db
          .query("departments")
          .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
          .collect();
        const found = existing.find((x) => x.name === d.name);
        if (found) { deptByName.set(d.name, found._id); continue; }
        const id = await ctx.db.insert("departments", {
          schoolId, name: d.name, description: d.description, status: "active",
        });
        deptByName.set(d.name, id);
        summary.departments++;
      }

      /* ---------- HR: employees (extend existing staff — one identity) ---------- */
      const employeesByStaffId = new Map<string, Id<"employees">>();
      for (const s of staff) {
        const existing = await ctx.db
          .query("employees")
          .withIndex("by_staff", (q) => q.eq("staffId", s._id))
          .first();
        if (existing) { employeesByStaffId.set(s._id, existing._id); continue; }
        const deptName = s.department && deptByName.has(s.department) ? s.department : "Teaching";
        const empId = await ctx.db.insert("employees", {
          schoolId,
          staffId: s._id,
          departmentId: deptByName.get(deptName),
          jobTitle: s.jobTitle,
          hireDate: s.hireDate,
          qualifications: s.jobTitle === "Teacher" ? "B.Ed, Registered Teacher" : undefined,
          emergencyContactName: `${s.firstName} Kin`,
          emergencyContactPhone: "+254 720 000 000",
          emergencyContactRelationship: "sibling",
          status: "active",
          updatedAt: Date.now(),
          updatedById: admin._id,
        });
        employeesByStaffId.set(s._id, empId);
        summary.employees++;
      }

      /* ---------- HR: contracts (one active per employee) ---------- */
      for (const s of staff) {
        const employeeId = employeesByStaffId.get(s._id);
        if (!employeeId) continue;
        const existing = await ctx.db
          .query("contracts")
          .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
          .collect();
        if (existing.length > 0) continue;
        await ctx.db.insert("contracts", {
          schoolId,
          employeeId,
          staffId: s._id,
          contractNumber: `CT-${s.employeeNumber}`,
          contractType: s.employmentType === "contract" ? "fixed_term" : "permanent",
          startDate: s.hireDate ?? "2023-01-09",
          endDate: s.employmentType === "contract" ? "2026-12-31" : undefined,
          status: "active",
          createdById: admin._id,
          updatedAt: Date.now(),
        });
        summary.contracts++;
      }

      /* ---------- HR: leave types ---------- */
      const existingLeaveTypes = await ctx.db
        .query("leaveTypes")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const leaveTypeByName = new Map<string, Id<"leaveTypes">>();
      if (existingLeaveTypes.length === 0) {
        for (const lt of [
          { name: "Annual Leave", annualDays: 21, paid: true, requiresApproval: true },
          { name: "Sick Leave", annualDays: 10, paid: true, requiresApproval: true },
          { name: "Emergency Leave", annualDays: 5, paid: true, requiresApproval: true },
          { name: "Maternity Leave", annualDays: 90, paid: true, requiresApproval: true },
          { name: "Paternity Leave", annualDays: 14, paid: true, requiresApproval: true },
        ]) {
          const id = await ctx.db.insert("leaveTypes", { schoolId, ...lt, status: "active" });
          leaveTypeByName.set(lt.name, id);
          summary.leaveTypes++;
        }
      } else {
        for (const lt of existingLeaveTypes) leaveTypeByName.set(lt.name, lt._id);
      }

      /* ---------- HR: leave requests (one pending, one approved) ---------- */
      const leaveSeed: Array<{
        staffEmail: string; typeName: string; startDate: string; endDate: string;
        days: number; reason: string; status: "pending" | "approved";
      }> = isGreenfield
        ? [
            { staffEmail: "grace.wanjiku@greenfield.ac.ke", typeName: "Annual Leave", startDate: "2026-10-05", endDate: "2026-10-09", days: 5, reason: "Family trip upcountry", status: "pending" },
            { staffEmail: "janet.mwikali@greenfield.ac.ke", typeName: "Sick Leave", startDate: "2026-09-14", endDate: "2026-09-15", days: 2, reason: "Malaria treatment", status: "approved" },
          ]
        : [
            { staffEmail: "miriam.atieno@riverside.ac.ke", typeName: "Annual Leave", startDate: "2026-11-02", endDate: "2026-11-06", days: 5, reason: "Personal", status: "pending" },
          ];
      for (const lr of leaveSeed) {
        const staffRow = staff.find((s) => s.email === lr.staffEmail);
        const leaveTypeId = leaveTypeByName.get(lr.typeName);
        if (!staffRow || !leaveTypeId) continue;
        const dup = await ctx.db
          .query("leaveRequests")
          .withIndex("by_staff", (q) => q.eq("staffId", staffRow._id))
          .collect()
          .then((rows) => rows.some((r) => r.leaveTypeId === leaveTypeId && r.startDate === lr.startDate));
        if (dup) continue;
        await ctx.db.insert("leaveRequests", {
          schoolId,
          staffId: staffRow._id,
          employeeId: employeesByStaffId.get(staffRow._id),
          leaveTypeId,
          startDate: lr.startDate,
          endDate: lr.endDate,
          days: lr.days,
          reason: lr.reason,
          status: lr.status,
          requestedById: admin._id,
          decidedById: lr.status === "approved" ? admin._id : undefined,
          decidedAt: lr.status === "approved" ? Date.now() : undefined,
          decisionNote: lr.status === "approved" ? "Approved — arrange class cover" : undefined,
          createdAt: Date.now(),
        });
        summary.leaveRequests++;
      }

      /* ---------- Payroll: salary structures + components ---------- */
      const existingStructures = await ctx.db
        .query("salaryStructures")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      let teacherStructureId = existingStructures.find((s) => s.name === "Teaching Staff Scale")?._id;
      let supportStructureId = existingStructures.find((s) => s.name === "Support Staff Scale")?._id;
      if (!teacherStructureId && !supportStructureId) {
        teacherStructureId = await ctx.db.insert("salaryStructures", {
          schoolId, name: "Teaching Staff Scale", basicSalary: 45000, status: "active",
          createdById: admin._id, createdAt: Date.now(),
        });
        supportStructureId = await ctx.db.insert("salaryStructures", {
          schoolId, name: "Support Staff Scale", basicSalary: 28000, status: "active",
          createdById: admin._id, createdAt: Date.now(),
        });
        summary.salaryStructures += 2;
        const structureComponents: Array<[Id<"salaryStructures">, Array<{ componentType: string; name: string; calculation: string; amount: number }>]> = [
          [teacherStructureId, [
            { componentType: "earning", name: "House Allowance", calculation: "fixed_amount", amount: 8000 },
            { componentType: "earning", name: "Commuter Allowance", calculation: "fixed_amount", amount: 3000 },
            { componentType: "deduction", name: "Pension (6%)", calculation: "percentage_of_basic", amount: 6 },
            { componentType: "deduction", name: "NHIF", calculation: "fixed_amount", amount: 1700 },
          ]],
          [supportStructureId, [
            { componentType: "earning", name: "Commuter Allowance", calculation: "fixed_amount", amount: 2000 },
            { componentType: "deduction", name: "Pension (6%)", calculation: "percentage_of_basic", amount: 6 },
            { componentType: "deduction", name: "NHIF", calculation: "fixed_amount", amount: 1300 },
          ]],
        ];
        for (const [structureId, comps] of structureComponents) {
          for (const c of comps) {
            await ctx.db.insert("salaryComponents", {
              schoolId, salaryStructureId: structureId, ...c, status: "active",
            });
          }
        }
      }

      /* ---------- Payroll: a paid September run with payslips ---------- */
      const existingRuns = await ctx.db
        .query("payrollRuns")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      if (existingRuns.length === 0 && teacherStructureId && supportStructureId) {
        const runStaff = staff.filter((s) => s.employmentStatus === "active");
        const slipData: Array<{
          staffId: Id<"staff">; employeeId: Id<"employees">; basicSalary: number;
          grossPay: number; totalDeductions: number; netPay: number;
          lines: Array<{ name: string; componentType: string; amount: number }>;
          salaryStructureId: Id<"salaryStructures">; contractId?: Id<"contracts">;
        }> = [];
        for (const s of runStaff) {
          const employeeId = employeesByStaffId.get(s._id);
          if (!employeeId) continue;
          const isTeacher = s.jobTitle === "Teacher";
          const structureId = isTeacher ? teacherStructureId : supportStructureId;
          const basic = isTeacher ? 45000 : 28000;
          const lines: Array<{ name: string; componentType: string; amount: number }> = isTeacher
            ? [
                { name: "Basic Salary", componentType: "earning", amount: basic },
                { name: "House Allowance", componentType: "earning", amount: 8000 },
                { name: "Commuter Allowance", componentType: "earning", amount: 3000 },
                { name: "Pension (6%)", componentType: "deduction", amount: round2(basic * 0.06) },
                { name: "NHIF", componentType: "deduction", amount: 1700 },
              ]
            : [
                { name: "Basic Salary", componentType: "earning", amount: basic },
                { name: "Commuter Allowance", componentType: "earning", amount: 2000 },
                { name: "Pension (6%)", componentType: "deduction", amount: round2(basic * 0.06) },
                { name: "NHIF", componentType: "deduction", amount: 1300 },
              ];
          const gross = lines.filter((l) => l.componentType === "earning").reduce((sum, l) => sum + l.amount, 0);
          const deductions = lines.filter((l) => l.componentType === "deduction").reduce((sum, l) => sum + l.amount, 0);
          const contract = await ctx.db
            .query("contracts")
            .withIndex("by_employee", (q) => q.eq("employeeId", employeeId))
            .first();
          slipData.push({
            staffId: s._id, employeeId, basicSalary: basic, grossPay: gross,
            totalDeductions: deductions, netPay: round2(gross - deductions),
            lines, salaryStructureId: structureId, contractId: contract?._id,
          });
        }
        if (slipData.length > 0) {
          const totalGross = round2(slipData.reduce((sum, s) => sum + s.grossPay, 0));
          const totalDeductions = round2(slipData.reduce((sum, s) => sum + s.totalDeductions, 0));
          const runId = await ctx.db.insert("payrollRuns", {
            schoolId,
            runNumber: "PR-2026-09",
            periodLabel: "September 2026",
            periodYear: 2026,
            periodMonth: 9,
            totalGross,
            totalDeductions,
            totalNet: round2(totalGross - totalDeductions),
            employeeCount: slipData.length,
            status: "paid",
            createdById: admin._id,
            approvedById: admin._id,
            approvedAt: Date.now(),
            paidAt: Date.now(),
            createdAt: Date.now(),
          });
          for (const s of slipData) {
            await ctx.db.insert("payslips", {
              schoolId, payrollRunId: runId, ...s, generatedAt: Date.now(),
            });
            summary.payslips++;
          }
          summary.payrollRuns++;
        }
      }

      /* ---------- Library: categories, books, copies ---------- */
      const existingBooks = await ctx.db
        .query("books")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      if (existingBooks.length === 0) {
        const catIds = new Map<string, Id<"libraryCategories">>();
        for (const c of ["Set Books", "Reference", "Fiction", "Science"]) {
          catIds.set(c, await ctx.db.insert("libraryCategories", { schoolId, name: c, status: "active" }));
        }
        const bookDefs = [
          { title: "The River and the Source", author: "Margaret Ogola", categoryId: catIds.get("Set Books"), totalCopies: 12 },
          { title: "Blossoms of the Savannah", author: "Henry Ole Kulet", categoryId: catIds.get("Set Books"), totalCopies: 10 },
          { title: "Oxford Advanced Dictionary", categoryId: catIds.get("Reference"), totalCopies: 6 },
          { title: "Things Fall Apart", author: "Chinua Achebe", categoryId: catIds.get("Fiction"), totalCopies: 8 },
          { title: "Integrated Science Revision", categoryId: catIds.get("Science"), totalCopies: 15 },
        ];
        for (const b of bookDefs) {
          const bookId = await ctx.db.insert("books", {
            schoolId,
            title: b.title,
            author: b.author,
            categoryId: b.categoryId,
            totalCopies: b.totalCopies,
            status: "active",
          });
          summary.books++;
          for (let i = 1; i <= b.totalCopies; i++) {
            await ctx.db.insert("bookCopies", {
              schoolId,
              bookId,
              copyNumber: `CP-${String(i).padStart(3, "0")}`,
              status: i <= 2 ? "issued" : "available",
            });
          }
        }
      }

      /* ---------- Library: demo loans (one active, one overdue) ---------- */
      const copies = await ctx.db
        .query("bookCopies")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const availableCopies = copies.filter((c) => c.status === "available");
      const allLoans = await ctx.db
        .query("bookLoans")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      const loanTargets = students.slice(0, 2);
      const loanSpecs = [
        { issueDate: "2026-09-10", dueDate: "2026-09-24", status: "issued" },
        { issueDate: "2026-08-20", dueDate: "2026-09-03", status: "overdue" },
      ];
      for (let i = 0; i < loanTargets.length; i++) {
        const student = loanTargets[i];
        const copy = availableCopies[i];
        const spec = loanSpecs[i];
        if (!student || !copy || !spec) continue;
        if (allLoans.some((l) => l.borrowerStudentId === student._id)) continue;
        await ctx.db.insert("bookLoans", {
          schoolId,
          bookId: copy.bookId,
          bookCopyId: copy._id,
          borrowerStudentId: student._id,
          issuedById: admin._id,
          issueDate: spec.issueDate,
          dueDate: spec.dueDate,
          fineAmount: 0,
          status: spec.status,
        });
        await ctx.db.patch(copy._id, { status: "issued" });
        summary.loans++;
      }

      /* ---------- Transport ---------- */
      const existingVehicles = await ctx.db
        .query("vehicles")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      if (existingVehicles.length === 0) {
        const driverId = await ctx.db.insert("drivers", {
          schoolId,
          staffId: staff.find((s) => s.jobTitle === "Driver")?._id,
          fullName: "John Mwangi",
          phone: "+254 733 111 222",
          licenseNumber: "DL-0092831",
          licenseExpiry: "2027-03-01",
          isExternal: false,
          status: "active",
        });
        const vehicleId = await ctx.db.insert("vehicles", {
          schoolId,
          registrationNumber: isGreenfield ? "KDA 101X" : "KDB 202Y",
          vehicleType: "Bus",
          capacity: 45,
          driverId,
          status: "active",
        });
        summary.vehicles++;
        const routeId = await ctx.db.insert("transportRoutes", {
          schoolId,
          name: isGreenfield ? "Ngong Road Route" : "Kisumu Town Route",
          vehicleId,
          status: "active",
        });
        summary.routes++;
        const stopDefs = isGreenfield
          ? [
              { stopName: "Junction Mall", pickupTime: "06:40", displayOrder: 1 },
              { stopName: "Karen Hardy", pickupTime: "06:55", displayOrder: 2 },
              { stopName: "Ngong Town", pickupTime: "07:10", displayOrder: 3 },
            ]
          : [
              { stopName: "Kondele", pickupTime: "06:45", displayOrder: 1 },
              { stopName: "Milimani", pickupTime: "07:00", displayOrder: 2 },
            ];
        const stopIds: Id<"routeStops">[] = [];
        for (const st of stopDefs) {
          stopIds.push(await ctx.db.insert("routeStops", { schoolId, routeId, ...st }));
        }
        for (let i = 0; i < 2 && i < students.length; i++) {
          const existing = await ctx.db
            .query("transportAssignments")
            .withIndex("by_student", (q) => q.eq("studentId", students[i]._id))
            .collect()
            .then((rows) => rows.some((r) => r.status === "active"));
          if (existing) continue;
          await ctx.db.insert("transportAssignments", {
            schoolId,
            studentId: students[i]._id,
            routeId,
            stopId: stopIds[i % stopIds.length],
            vehicleId,
            direction: "both",
            status: "active",
            assignedById: admin._id,
            assignedAt: Date.now(),
          });
          summary.assignments++;
        }
      }

      /* ---------- Boarding ---------- */
      const existingHostels = await ctx.db
        .query("hostels")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      if (existingHostels.length === 0) {
        const warden = staff.find((s) => s.jobTitle === "Teacher") ?? staff[0];
        const hostelId = await ctx.db.insert("hostels", {
          schoolId,
          name: isGreenfield ? "Greenfield Boys Hostel" : "Riverside Hostel",
          gender: "male",
          wardenStaffId: warden._id,
          capacity: 40,
          status: "active",
        });
        summary.hostels++;
        const bedIds: Array<{ id: Id<"beds">; roomId: Id<"hostelRooms"> }> = [];
        for (let r = 1; r <= 3; r++) {
          const roomId = await ctx.db.insert("hostelRooms", {
            schoolId, hostelId, roomNumber: `R-${r}`, capacity: 4, status: "active",
          });
          for (let b = 1; b <= 4; b++) {
            bedIds.push({
              id: await ctx.db.insert("beds", {
                schoolId, roomId, bedNumber: `B-${b}`, status: "free",
              }),
              roomId,
            });
          }
        }
        const boardingStudents = students.filter((s) => s.boardingStatus === "boarding");
        for (let i = 0; i < Math.min(boardingStudents.length, bedIds.length); i++) {
          const bed = bedIds[i];
          const existing = await ctx.db
            .query("boardingAllocations")
            .withIndex("by_student", (q) => q.eq("studentId", boardingStudents[i]._id))
            .collect()
            .then((rows) => rows.some((r) => r.status === "active"));
          if (existing) continue;
          await ctx.db.insert("boardingAllocations", {
            schoolId,
            studentId: boardingStudents[i]._id,
            hostelId,
            roomId: bed.roomId,
            bedId: bed.id,
            startDate: "2026-01-06",
            status: "active",
            allocatedById: admin._id,
            createdAt: Date.now(),
          });
          await ctx.db.patch(bed.id, { status: "occupied" });
          summary.allocations++;
        }
      }

      /* ---------- Inventory & assets ---------- */
      const existingItems = await ctx.db
        .query("inventoryItems")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      if (existingItems.length === 0) {
        for (const item of [
          { name: "Exercise Books (A4)", category: "Stationery", unit: "dozen", quantity: 240, reorderLevel: 40, unitCost: 320 },
          { name: "Whiteboard Markers", category: "Stationery", unit: "piece", quantity: 90, reorderLevel: 20, unitCost: 60 },
          { name: "Chlorine Tablets", category: "Cleaning", unit: "packet", quantity: 14, reorderLevel: 20, unitCost: 450 },
          { name: "Volleyballs", category: "Sports", unit: "piece", quantity: 8, reorderLevel: 4, unitCost: 1200 },
        ]) {
          await ctx.db.insert("inventoryItems", {
            schoolId, ...item, status: "active",
            createdById: admin._id, updatedAt: Date.now(),
          });
        }
        summary.inventoryItems += 4;
        const chlorine = (await ctx.db
          .query("inventoryItems")
          .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
          .collect())
          .find((it) => it.name === "Chlorine Tablets");
        if (chlorine) {
          await ctx.db.insert("stockMovements", {
            schoolId,
            itemId: chlorine._id,
            movementType: "adjustment",
            quantity: 6,
            balanceAfter: chlorine.quantity,
            reference: "Initial stock take",
            createdById: admin._id,
            createdAt: Date.now(),
          });
        }
      }
      const existingAssets = await ctx.db
        .query("assets")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      if (existingAssets.length === 0) {
        for (const asset of [
          { assetNumber: "AST-001", name: "School Bus", category: "Transport", purchaseDate: "2022-01-12", purchaseValue: 4500000, location: "Garage", condition: "good" },
          { assetNumber: "AST-002", name: "Projector — Science Lab", category: "Electronics", purchaseDate: "2024-05-02", purchaseValue: 45000, location: "Science Lab", condition: "new" },
          { assetNumber: "AST-003", name: "Photocopier", category: "Office", purchaseDate: "2021-08-19", purchaseValue: 180000, location: "Admin Block", condition: "fair" },
        ]) {
          await ctx.db.insert("assets", {
            schoolId,
            ...asset,
            custodianStaffId: staff[0]._id,
            status: "active",
            createdById: admin._id,
            updatedAt: Date.now(),
          });
          summary.assets++;
        }
      }

      /* ---------- Procurement ---------- */
      const existingSuppliers = await ctx.db
        .query("suppliers")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      let supplierId: Id<"suppliers"> | undefined;
      if (existingSuppliers.length === 0) {
        supplierId = await ctx.db.insert("suppliers", {
          schoolId,
          name: "Nairobi School Supplies Ltd",
          contactPerson: "Alice Kariuki",
          phone: "+254 720 555 100",
          email: "sales@nairobisupplies.co.ke",
          category: "Stationery",
          address: "Industrial Area, Nairobi",
          status: "active",
        });
        summary.suppliers++;
      } else {
        supplierId = existingSuppliers[0]._id;
      }
      const existingRequests = await ctx.db
        .query("purchaseRequests")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      if (existingRequests.length === 0 && supplierId) {
        const requestId = await ctx.db.insert("purchaseRequests", {
          schoolId,
          requestNumber: "PRQ-2026-001",
          supplierId,
          requestedById: admin._id,
          neededBy: "2026-10-10",
          justification: "Term 3 stationery restock",
          estimatedTotal: 38400,
          status: "approved",
          decidedById: admin._id,
          decidedAt: Date.now(),
          decisionNote: "Approved within budget",
          createdAt: Date.now(),
        });
        summary.purchaseRequests++;
        await ctx.db.insert("purchaseRequestItems", {
          schoolId, purchaseRequestId: requestId, description: "Exercise Books (A4)", quantity: 100, unitCost: 320,
        });
        await ctx.db.insert("purchaseRequestItems", {
          schoolId, purchaseRequestId: requestId, description: "Whiteboard Markers", quantity: 40, unitCost: 60,
        });
        await ctx.db.insert("purchaseOrders", {
          schoolId,
          orderNumber: "PO-2026-001",
          purchaseRequestId: requestId,
          supplierId,
          total: 34400,
          orderDate: "2026-09-12",
          status: "submitted",
          createdById: admin._id,
          createdAt: Date.now(),
        });
      }

      /* ---------- Clinic / medical (sensitive, school-scoped) ---------- */
      const existingProfiles = await ctx.db
        .query("medicalProfiles")
        .withIndex("by_school", (q) => q.eq("schoolId", schoolId))
        .collect();
      if (existingProfiles.length === 0) {
        const nurse = staff.find((s) => s.jobTitle === "Nurse");
        // Clinic visits are recorded by a platform user; the nurse (a staff
        // row, not a user) is captured on the provider field instead.
        const providerName = nurse ? `${nurse.firstName} ${nurse.lastName}` : "School Clinic";
        for (const student of students.slice(0, 2)) {
          await ctx.db.insert("medicalProfiles", {
            schoolId,
            studentId: student._id,
            bloodGroup: student.gender === "female" ? "O+" : "A+",
            allergies: student.gender === "female" ? ["Peanuts"] : [],
            conditions: [],
            emergencyNotes: student.gender === "female" ? "Carries antihistamine in clinic fridge" : undefined,
            updatedAt: Date.now(),
            updatedById: admin._id,
          });
          summary.medicalProfiles++;
          await ctx.db.insert("clinicVisits", {
            schoolId,
            studentId: student._id,
            visitDate: "2026-09-15",
            complaint: "Headache and mild fever",
            assessment: "Likely viral infection",
            treatment: "Paracetamol, rest",
            provider: providerName,
            disposition: "returned_to_class",
            recordedById: admin._id,
            createdAt: Date.now(),
          });
          summary.clinicVisits++;
        }
      }
    }

    return summary;
  },
});
