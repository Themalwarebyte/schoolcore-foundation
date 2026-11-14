/** SchoolCore Test Primary School — deterministic workbook validation tests.
 * All fixture data is synthetic; no live credentials or school records.
 * Run: bun test scripts/school-workbook-pilot.test.ts
 */
import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/test-primary-workbook.json";
import { validateWorkbook, type SchoolWorkbook } from "../src/lib/schoolWorkbookValidation";

const sample = () => structuredClone(fixture) as SchoolWorkbook;
const validate = (s: SchoolWorkbook) => validateWorkbook(s, "TPS-TEST-001");

describe("pilot onboarding workbook", () => {
  test("the complete populated Test Primary School sample is valid", () => {
    const report = validate(sample());
    expect(report.totalRows).toBe(150);
    expect(report.errors).toHaveLength(0);
  });
  test("duplicate admission numbers block import", () => {
    const s = sample(); s.Students[1].admissionNumber = s.Students[0].admissionNumber;
    expect(validate(s).errors.some(i => i.message.includes("Duplicate key"))).toBe(true);
  });
  test("unknown guardian references block import", () => {
    const s = sample(); s.Guardian_Links[0].guardianKey = "INVALID-TEST-GUARDIAN";
    expect(validate(s).errors.some(i => i.message.includes("Unknown Guardians"))).toBe(true);
  });
  test("workbook of another tenant cannot be imported", () => {
    const s = sample(); s.School[0].schoolCode = "HHS-001";
    expect(validate(s).errors.some(i => i.message.includes("does not match your current school"))).toBe(true);
  });
  test("unbalanced historical financial amounts block import", () => {
    const s = sample(); s.Opening_Balances[0].openingBalanceKES = "999999";
    expect(validate(s).errors.some(i => i.message.includes("Does not equal"))).toBe(true);
  });
  test("unknown boarding beds block import", () => {
    const s = sample(); s.Bed_Assignments[0].bedKey = "INVALID-BED";
    expect(validate(s).errors.some(i => i.message.includes("Unknown Beds"))).toBe(true);
  });
});
