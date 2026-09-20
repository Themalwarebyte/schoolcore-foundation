import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Deterministic pseudo-random helpers so the seed is reproducible. */
let seedState = 42;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function intBetween(min: number, max: number): number {
  return Math.floor(rnd() * (max - min + 1)) + min;
}

const FIRST_NAMES_F = [
  "Amina", "Grace", "Faith", "Mercy", "Zawadi", "Neema", "Joy", "Cynthia", "Wanjiru", "Njeri",
  "Halima", "Esther", "Blessing", "Purity", "Sharon", "Winnie", "Doreen", "Lydia", "Rehema", "Baraka",
];
const FIRST_NAMES_M = [
  "Brian", "Kevin", "Dennis", "Collins", "Emmanuel", "Samuel", "Victor", "Elijah", "Mutua", "Otieno",
  "Kamau", "Juma", "Isaac", "Peter", "Simon", "Alex", "Caleb", "Ezra", "Nathan", "Tobias",
];
const LAST_NAMES = [
  "Hassan", "Wanjiku", "Ochieng", "Mutiso", "Njoroge", "Otieno", "Achieng", "Kimani", "Mwangi", "Kiprop",
  "Adepoju", "Barasa", "Chebet", "Wambui", "Onyango", "Kilonzo", "Muthoni", "Abdi", "Wafula", "Kiptoo",
];
const OCCUPATIONS = [
  "Teacher", "Nurse", "Shopkeeper", "Farmer", "Accountant", "Driver", "Engineer", "Trader",
  "Civil servant", "Tailor", "Electrician", "Carpenter",
];

/**
 * Seed the entire demo platform. Guarded by a seed secret so it cannot be
 * invoked casually; skips when data already exists (idempotent).
 * Run: bunx convex run seed:seedAll '{"secret":"schoolcore-dev-seed"}'
 */
export const seedAll = action({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    const expected = process.env.SEED_SECRET ?? "schoolcore-dev-seed";
    if (secret !== expected) {
      throw new Error("Invalid seed secret.");
    }
    const existingSchools = await ctx.runQuery(internal.seedHelpers.countSchools, {});
    if (existingSchools > 0) {
      return { skipped: true as const, message: "Seed data already present." };
    }

    // 0. Bootstrap super admin.
    await ctx.runAction(internal.accounts.ensureBootstrapAdmin, {});
    const superAdminId = await ctx.runQuery(internal.seedHelpers.findUserByEmail, {
      email: (process.env.PLATFORM_ADMIN_EMAIL ?? "admin@schoolcore.dev").trim().toLowerCase(),
    });

    /* ---------------- School 1: Greenfield Academy ---------------- */
    const greenfieldId = await ctx.runMutation(internal.seedHelpers.insertSchool, {
      name: "Greenfield Academy",
      code: "GRN-001",
      slug: "greenfield-academy",
      email: "info@greenfieldacademy.ac.ke",
      phone: "+254 700 100 200",
      website: "https://greenfieldacademy.ac.ke",
      county: "Nairobi",
      country: "Kenya",
      timezone: "Africa/Nairobi",
      curriculum: "Competency Based Curriculum (CBC)",
      currency: "KES",
    });

    /* ---------------- School 2: Riverside (isolation test) ---------------- */
    const riversideId = await ctx.runMutation(internal.seedHelpers.insertSchool, {
      name: "Riverside School",
      code: "RVS-002",
      slug: "riverside-school",
      email: "office@riversideschool.ac.ke",
      phone: "+254 711 555 808",
      county: "Kisumu",
      country: "Kenya",
      timezone: "Africa/Nairobi",
      curriculum: "Competency Based Curriculum (CBC)",
    });

    /* ---------------- Users ---------------- */
    const adminId = await ctx.runMutation(internal.seedHelpers.ensureUserRecord, {
      email: "admin@greenfield.ac.ke", name: "Diana Muthoni", role: "school_admin", schoolId: greenfieldId,
    });
    await ctx.runMutation(internal.seedHelpers.ensureUserRecord, {
      email: "principal@greenfield.ac.ke", name: "Robert Kariuki", role: "principal", schoolId: greenfieldId,
    });
    await ctx.runMutation(internal.seedHelpers.ensureUserRecord, {
      email: "accounts@greenfield.ac.ke", name: "Alice Chebet", role: "accountant", schoolId: greenfieldId,
    });
    await ctx.runMutation(internal.seedHelpers.ensureUserRecord, {
      email: "admin@riverside.ac.ke", name: "Peter Ouma", role: "school_admin", schoolId: riversideId,
    });
    await ctx.runAction(internal.accounts.ensurePasswordAccount, { email: "admin@greenfield.ac.ke", password: "Greenfield#2026" });
    await ctx.runAction(internal.accounts.ensurePasswordAccount, { email: "principal@greenfield.ac.ke", password: "Greenfield#2026" });
    await ctx.runAction(internal.accounts.ensurePasswordAccount, { email: "accounts@greenfield.ac.ke", password: "Greenfield#2026" });
    await ctx.runAction(internal.accounts.ensurePasswordAccount, { email: "admin@riverside.ac.ke", password: "Riverside#2026" });
    void adminId;

    /* ---------------- Academic structure: Greenfield ---------------- */
    const year2026 = await ctx.runMutation(internal.seedHelpers.insertYear, {
      schoolId: greenfieldId, name: "2026", startDate: "2026-01-05", endDate: "2026-11-20", isCurrent: true,
    });
    await ctx.runMutation(internal.seedHelpers.insertYear, {
      schoolId: greenfieldId, name: "2025", startDate: "2025-01-06", endDate: "2025-11-21", isCurrent: false,
    });
    const term1 = await ctx.runMutation(internal.seedHelpers.insertTerm, {
      schoolId: greenfieldId, academicYearId: year2026 as Id<"academicYears">, name: "Term 1",
      startDate: "2026-01-05", endDate: "2026-04-03", displayOrder: 1,
    });
    const term2 = await ctx.runMutation(internal.seedHelpers.insertTerm, {
      schoolId: greenfieldId, academicYearId: year2026 as Id<"academicYears">, name: "Term 2",
      startDate: "2026-05-04", endDate: "2026-08-07", displayOrder: 2,
    });
    await ctx.runMutation(internal.seedHelpers.insertTerm, {
      schoolId: greenfieldId, academicYearId: year2026 as Id<"academicYears">, name: "Term 3",
      startDate: "2026-09-07", endDate: "2026-11-20", displayOrder: 3,
    });
    await ctx.runMutation(internal.seedHelpers.setTermCurrent, { termId: term1 as Id<"terms"> });

    const grade7 = await ctx.runMutation(internal.seedHelpers.insertGrade, {
      schoolId: greenfieldId, name: "Grade 7", shortName: "G7", displayOrder: 7,
    });
    const grade8 = await ctx.runMutation(internal.seedHelpers.insertGrade, {
      schoolId: greenfieldId, name: "Grade 8", shortName: "G8", displayOrder: 8,
    });
    const grade6 = await ctx.runMutation(internal.seedHelpers.insertGrade, {
      schoolId: greenfieldId, name: "Grade 6", shortName: "G6", displayOrder: 6,
    });

    const subjectDefs = [
      { name: "Mathematics", code: "MAT", type: "core" },
      { name: "English", code: "ENG", type: "core" },
      { name: "Kiswahili", code: "KIS", type: "core" },
      { name: "Integrated Science", code: "ISC", type: "core" },
      { name: "Social Studies", code: "SST", type: "core" },
      { name: "Religious Education", code: "CRE", type: "elective" },
      { name: "Creative Arts", code: "ART", type: "elective" },
      { name: "Pre-Technical Studies", code: "PTS", type: "core" },
    ];
    const subjectIds: Id<"subjects">[] = [];
    for (const s of subjectDefs) {
      const id = await ctx.runMutation(internal.seedHelpers.insertSubject, {
        schoolId: greenfieldId, name: s.name, code: s.code, subjectType: s.type,
      });
      subjectIds.push(id as Id<"subjects">);
    }

    /* ---------------- Staff: Greenfield ---------------- */
    const staffDefs = [
      { first: "Grace", last: "Wanjiku", gender: "female", title: "Teacher", dept: "Mathematics", type: "permanent", email: "grace.wanjiku@greenfield.ac.ke" },
      { first: "Joseph", last: "Otieno", gender: "male", title: "Teacher", dept: "Sciences", type: "permanent", email: "joseph.otieno@greenfield.ac.ke" },
      { first: "Esther", last: "Njeri", gender: "female", title: "Teacher", dept: "Languages", type: "permanent", email: "esther.njeri@greenfield.ac.ke" },
      { first: "Samuel", last: "Kiptoo", gender: "male", title: "Teacher", dept: "Mathematics", type: "contract", email: "samuel.kiptoo@greenfield.ac.ke" },
      { first: "Rose", last: "Achieng", gender: "female", title: "Teacher", dept: "Languages", type: "permanent", email: "rose.achieng@greenfield.ac.ke" },
      { first: "Daniel", last: "Mutua", gender: "male", title: "Teacher", dept: "Sciences", type: "permanent", email: "daniel.mutua@greenfield.ac.ke" },
      { first: "Naomi", last: "Wambui", gender: "female", title: "Teacher", dept: "Arts", type: "part_time", email: "naomi.wambui@greenfield.ac.ke" },
      { first: "Elijah", last: "Kamau", gender: "male", title: "Teacher", dept: "Social Studies", type: "permanent", email: "elijah.kamau@greenfield.ac.ke" },
      { first: "Beatrice", last: "Owino", gender: "female", title: "Bursar", dept: "Administration", type: "permanent", email: "beatrice.owino@greenfield.ac.ke" },
      { first: "Collins", last: "Barasa", gender: "male", title: "Office Administrator", dept: "Administration", type: "permanent", email: "collins.barasa@greenfield.ac.ke" },
      { first: "Janet", last: "Mwikali", gender: "female", title: "Nurse", dept: "Health", type: "contract", email: "janet.mwikali@greenfield.ac.ke" },
    ];
    const staffIds: Id<"staff">[] = [];
    let empNum = 100;
    for (const s of staffDefs) {
      empNum += 1;
      const id = await ctx.runMutation(internal.seedHelpers.insertStaff, {
        schoolId: greenfieldId,
        employeeNumber: `GF-${empNum}`,
        firstName: s.first, lastName: s.last, gender: s.gender,
        jobTitle: s.title, department: s.dept, employmentType: s.type,
        employmentStatus: "active",
        email: s.email,
        phone: `+254 7${intBetween(10, 99)} ${intBetween(100, 999)} ${intBetween(100, 999)}`,
        hireDate: `20${intBetween(18, 24)}-0${intBetween(1, 9)}-1${intBetween(0, 8)}`,
      });
      staffIds.push(id as Id<"staff">);
    }
    // Give one teacher a login account.
    await ctx.runMutation(internal.seedHelpers.ensureUserRecord, {
      email: "grace.wanjiku@greenfield.ac.ke",
      name: "Grace Wanjiku",
      role: "teacher",
      schoolId: greenfieldId,
    });
    await ctx.runAction(internal.accounts.ensurePasswordAccount, {
      email: "grace.wanjiku@greenfield.ac.ke",
      password: "Greenfield#2026",
    });
    await ctx.runMutation(internal.seedHelpers.linkStaffUser, {
      staffId: staffIds[0],
      email: "grace.wanjiku@greenfield.ac.ke",
    });

    /* ---------------- Class sections: Greenfield ---------------- */
    const sectionDefs = [
      { gradeId: grade6 as Id<"gradeLevels">, stream: "Blue" },
      { gradeId: grade6 as Id<"gradeLevels">, stream: "Green" },
      { gradeId: grade7 as Id<"gradeLevels">, stream: "Blue" },
      { gradeId: grade7 as Id<"gradeLevels">, stream: "Green" },
      { gradeId: grade8 as Id<"gradeLevels">, stream: "Blue" },
      { gradeId: grade8 as Id<"gradeLevels">, stream: "Green" },
    ];
    const sectionIds: Id<"classSections">[] = [];
    for (let i = 0; i < sectionDefs.length; i++) {
      const def = sectionDefs[i];
      const id = await ctx.runMutation(internal.seedHelpers.insertSection, {
        schoolId: greenfieldId,
        academicYearId: year2026 as Id<"academicYears">,
        gradeLevelId: def.gradeId,
        streamName: def.stream,
        capacity: 40,
        classTeacherStaffId: i < staffIds.length ? staffIds[i] : undefined,
      });
      sectionIds.push(id as Id<"classSections">);
    }

    /* ---------------- Teacher allocations ---------------- */
    const coreSubjects = subjectIds.slice(0, 6);
    for (const section of sectionIds) {
      for (let i = 0; i < 5; i++) {
        const staffId = staffIds[i % 8];
        const subjectId = coreSubjects[i % coreSubjects.length];
        await ctx.runMutation(internal.seedHelpers.insertAllocation, {
          schoolId: greenfieldId,
          staffId,
          subjectId,
          classSectionId: section,
          academicYearId: year2026 as Id<"academicYears">,
          termId: undefined,
        }).catch(() => undefined);
      }
    }

    /* ---------------- Students + guardians: Greenfield ---------------- */
    const statusesPool = ["active", "active", "active", "active", "inactive", "graduated"] as const;
    let admission = 1000;
    const createdStudentIds: Id<"students">[] = [];
    const createdGuardianIds: Id<"guardians">[] = [];
    const usedNames = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const gender: "male" | "female" = i % 2 === 0 ? "female" : "male";
      const firstName = gender === "female" ? pick(FIRST_NAMES_F) : pick(FIRST_NAMES_M);
      let lastName = pick(LAST_NAMES);
      // Sibling groups: every 6th student shares a family with a previous student.
      let guardianIndex = createdGuardianIds.length;
      if (i >= 6 && i % 6 === 0 && createdGuardianIds.length > 0) {
        const siblingIndex = Math.max(0, createdStudentIds.length - 6);
        const sibling = await ctx.runQuery(internal.seedHelpers.getStudent, { studentId: createdStudentIds[siblingIndex] });
        lastName = sibling!.lastName;
        const links = await ctx.runQuery(internal.seedHelpers.getGuardianLinks, { studentId: createdStudentIds[siblingIndex] });
        guardianIndex = links.length > 0 ? intBetween(0, createdGuardianIds.length - 1) : createdGuardianIds.length;
      }
      const nameKey = `${firstName} ${lastName}`;
      if (usedNames.has(nameKey)) lastName = `${lastName}-${i}`;
      usedNames.add(nameKey);
      admission += 1;
      const section = sectionIds[i % sectionIds.length];
      const status = i < 70 ? "active" : pick([...statusesPool].filter((s) => s !== "active"));
      const studentId = await ctx.runMutation(internal.seedHelpers.insertStudent, {
        schoolId: greenfieldId,
        admissionNumber: `GA-2026-${admission}`,
        firstName,
        lastName,
        gender,
        dateOfBirth: `20${intBetween(10, 14)}-0${intBetween(1, 9)}-1${intBetween(0, 8)}`,
        nationality: "Kenyan",
        admissionDate: `2026-01-0${intBetween(5, 9)}`,
        studentStatus: status,
        boardingStatus: i % 5 === 0 ? "boarding" : "day",
        previousSchool: i % 4 === 0 ? pick(["Riverside Junior", "Highland Primary", "St. Mary's Junior"]) : undefined,
      });
      createdStudentIds.push(studentId as Id<"students">);

      // Guardian (dedupe for siblings).
      let guardianId: Id<"guardians">;
      if (guardianIndex < createdGuardianIds.length) {
        guardianId = createdGuardianIds[guardianIndex];
      } else {
        const gFirst = pick(FIRST_NAMES_F.concat(FIRST_NAMES_M));
        const gLast = lastName;
        const gPhone = `+254 7${intBetween(20, 99)} ${intBetween(100, 999)} ${intBetween(100, 999)}`;
        guardianId = await ctx.runMutation(internal.seedHelpers.insertGuardian, {
          schoolId: greenfieldId,
          firstName: gFirst,
          lastName: gLast,
          relationship: pick(["mother", "father", "guardian", "grandparent"]),
          phone: gPhone,
          email: `${gFirst.toLowerCase()}.${gLast.toLowerCase().replace(/[^a-z]/g, "")}${guardianIndex}@example.com`,
          occupation: pick(OCCUPATIONS),
          address: pick(["Ngong Road, Nairobi", "Kilimani, Nairobi", "Karen, Nairobi", "Westlands, Nairobi"]),
          nationalId: `${intBetween(10000000, 39999999)}`,
        });
        createdGuardianIds.push(guardianId as Id<"guardians">);
      }
      await ctx.runMutation(internal.seedHelpers.linkGuardian, {
        schoolId: greenfieldId,
        guardianId,
        studentId,
        isPrimary: true,
        isEmergencyContact: true,
        relationship: "guardian",
      });
      await ctx.runMutation(internal.seedHelpers.insertEnrollment, {
        schoolId: greenfieldId,
        studentId,
        academicYearId: year2026 as Id<"academicYears">,
        classSectionId: section,
        enrollmentDate: "2026-01-06",
      }).catch(() => undefined);

      // A second guardian for every third student (non-primary).
      if (i % 3 === 0) {
        const g2First = pick(FIRST_NAMES_F.concat(FIRST_NAMES_M));
        const g2 = await ctx.runMutation(internal.seedHelpers.insertGuardian, {
          schoolId: greenfieldId,
          firstName: g2First,
          lastName,
          relationship: pick(["mother", "father", "aunt_uncle"]),
          phone: `+254 7${intBetween(20, 99)} ${intBetween(100, 999)} ${intBetween(100, 999)}`,
          email: undefined,
          occupation: pick(OCCUPATIONS),
          address: undefined,
          nationalId: undefined,
        });
        await ctx.runMutation(internal.seedHelpers.linkGuardian, {
          schoolId: greenfieldId,
          guardianId: g2 as Id<"guardians">,
          studentId,
          isPrimary: false,
          isEmergencyContact: false,
          relationship: "guardian",
        });
      }
    }

    /* ---------------- Riverside: minimal structure for isolation testing ------- */
    const rvYear = await ctx.runMutation(internal.seedHelpers.insertYear, {
      schoolId: riversideId, name: "2026", startDate: "2026-01-05", endDate: "2026-11-20", isCurrent: true,
    });
    const rvGrade = await ctx.runMutation(internal.seedHelpers.insertGrade, {
      schoolId: riversideId, name: "Grade 7", shortName: "G7", displayOrder: 7,
    });
    const rvSection = await ctx.runMutation(internal.seedHelpers.insertSection, {
      schoolId: riversideId, academicYearId: rvYear as Id<"academicYears">, gradeLevelId: rvGrade as Id<"gradeLevels">, streamName: "Sun", capacity: 30,
      classTeacherStaffId: undefined,
    });
    const rvSubject = await ctx.runMutation(internal.seedHelpers.insertSubject, {
      schoolId: riversideId, name: "Mathematics", code: "MAT", subjectType: "core",
    });
    const rvStaff = await ctx.runMutation(internal.seedHelpers.insertStaff, {
      schoolId: riversideId, employeeNumber: "RS-101", firstName: "Miriam", lastName: "Atieno",
      gender: "female", jobTitle: "Teacher", department: "Mathematics", employmentType: "permanent",
      employmentStatus: "active", email: "miriam.atieno@riverside.ac.ke", phone: "+254 722 000 111",
      hireDate: "2021-01-04",
    });
    const rvStudent = await ctx.runMutation(internal.seedHelpers.insertStudent, {
      schoolId: riversideId, admissionNumber: "RS-2026-001", firstName: "Tom", lastName: "Owira",
      gender: "male", dateOfBirth: "2012-03-14", nationality: "Kenyan", admissionDate: "2026-01-06",
      studentStatus: "active", boardingStatus: "day", previousSchool: undefined,
    });
    await ctx.runMutation(internal.seedHelpers.insertEnrollment, {
      schoolId: riversideId, studentId: rvStudent as Id<"students">,
      academicYearId: rvYear as Id<"academicYears">, classSectionId: rvSection as Id<"classSections">,
      enrollmentDate: "2026-01-06",
    });
    await ctx.runMutation(internal.seedHelpers.insertAllocation, {
      schoolId: riversideId, staffId: rvStaff as Id<"staff">, subjectId: rvSubject as Id<"subjects">,
      classSectionId: rvSection as Id<"classSections">, academicYearId: rvYear as Id<"academicYears">, termId: undefined,
    });

    /* ---------------- Audit trail for seed actions ---------------- */
    await ctx.runMutation(internal.seedHelpers.seedAudit, {
      userId: superAdminId as Id<"users">,
      entries: [
        { action: "school.created", entityType: "schools", entityId: greenfieldId, description: "Seeded Greenfield Academy", schoolId: greenfieldId },
        { action: "school.created", entityType: "schools", entityId: riversideId, description: "Seeded Riverside School", schoolId: riversideId },
      ],
    });
    await ctx.runMutation(internal.seedHelpers.seedAudit, {
      userId: adminId as Id<"users">,
      entries: [
        { action: "student.created", entityType: "students", entityId: undefined, description: "Seeded demo students", schoolId: greenfieldId },
        { action: "teacher_allocation.created", entityType: "teacherAllocations", entityId: undefined, description: "Seeded demo allocations", schoolId: greenfieldId },
      ],
    });

    return {
      skipped: false as const,
      schools: 2,
      students: createdStudentIds.length,
      guardians: createdGuardianIds.length,
      staff: staffIds.length,
      sections: sectionIds.length,
      subjects: subjectIds.length,
      terms: 3,
    };
  },
});
