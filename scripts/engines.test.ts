/**
 * Phase 2 engine unit tests — pure functions from src/convex/engines/*.
 *
 * Run: bun test scripts/engines.test.ts
 *
 * Covers the explicitly requested verification cases:
 *   - 40/50 = 80% with a 20% weight contributes exactly 16 percentage points
 *   - different maximum marks
 *   - missing marks are NOT treated as zero
 *   - absent status (excluded from denominator by default; optional zero policy)
 *   - exempt status
 *   - weights
 *   - grading boundaries
 *   - ranking ties (competition ranking)
 *   - timetable teacher/class/room collision detection
 */
import { describe, expect, test } from "bun:test";
import {
  computeSubjectResult,
  scorePercent,
  gradeFor,
  overallAverage,
  competitionRanks,
  completeness,
  validateScoreRow,
  type ScoreInput,
} from "../src/convex/engines/results";
import { detectConflicts, isSchoolDay, dayIndex } from "../src/convex/engines/timetable";
import { validDate, dayDiff } from "../src/convex/attendance";

function input(partial: Partial<ScoreInput>): ScoreInput {
  return {
    assessmentId: "a1",
    title: "Test",
    maxMarks: 100,
    weight: 50,
    countsTowardFinal: true,
    score: null,
    status: "missing",
    ...partial,
  };
}

describe("scorePercent normalization", () => {
  test("40/50 = 80%", () => {
    expect(scorePercent(40, 50)).toBe(80);
  });

  test("different maximum marks normalize correctly", () => {
    expect(scorePercent(17, 40)).toBe(42.5);
    expect(scorePercent(88, 100)).toBe(88);
    expect(scorePercent(1, 3)).toBe(33.33);
  });

  test("guards against invalid inputs", () => {
    expect(scorePercent(10, 0)).toBe(0); // degenerate maxMarks
    expect(scorePercent(-5, 50)).toBe(0); // negative clamps to 0
  });
});

describe("weighted result calculation (§5 of verification brief)", () => {
  test("40/50 with 20% weight contributes exactly 16 percentage points", () => {
    const r = computeSubjectResult([
      input({ maxMarks: 50, weight: 20, score: 40, status: "entered" }),
      input({ maxMarks: 100, weight: 80, score: 80, status: "entered" }),
    ]);
    // 80% × 20% = 16 pts; 80% × 80% = 64 pts → total 80 of 100
    expect(r.components[0].contribution).toBe(16);
    expect(r.totalScore).toBe(80);
    expect(r.percentage).toBe(80);
  });

  test("missing marks are NOT treated as zero — they shrink the denominator", () => {
    const r = computeSubjectResult([
      input({ weight: 40, score: 80, status: "entered" }),
      input({ weight: 60, status: "missing" }),
    ]);
    // Only the entered component counts: 80% of 40 weight → 100% of achieved weights.
    expect(r.totalScore).toBe(32);
    expect(r.weightsWithMarks).toBe(40);
    expect(r.percentage).toBe(80);
    expect(r.missingCount).toBe(1);
  });

  test("absent is excluded from the denominator by default", () => {
    const r = computeSubjectResult([
      input({ weight: 40, score: 70, status: "entered" }),
      input({ weight: 60, status: "absent" }),
    ]);
    expect(r.percentage).toBe(70);
    expect(r.absentCount).toBe(1);
    expect(r.absentWeight).toBe(60);
  });

  test("absentCountsAsZero policy zeroes absent components instead", () => {
    const r = computeSubjectResult(
      [
        input({ weight: 40, score: 70, status: "entered" }),
        input({ weight: 60, status: "absent" }),
      ],
      { absentCountsAsZero: true },
    );
    expect(r.percentage).toBe(28); // 70% × 40 / 100
  });

  test("exempt removes the component from both numerator and denominator", () => {
    const r = computeSubjectResult([
      input({ weight: 30, score: 90, status: "entered" }),
      input({ weight: 70, status: "exempt" }),
    ]);
    expect(r.percentage).toBe(90);
    expect(r.exemptCount).toBe(1);
    expect(r.weightsWithMarks).toBe(30);
  });

  test("weights accumulate and non-counting assessments are excluded", () => {
    const r = computeSubjectResult([
      input({ weight: 30, score: 100, status: "entered" }),
      input({ weight: 70, score: 50, status: "entered" }),
      input({ weight: 25, score: 0, status: "missing", countsTowardFinal: false }),
    ]);
    expect(r.totalWeight).toBe(100);
    expect(r.totalScore).toBe(65);
    expect(r.percentage).toBe(65);
  });

  test("all-missing result yields zero without throwing", () => {
    const r = computeSubjectResult([input({ weight: 100, status: "missing" })]);
    expect(r.percentage).toBe(0);
    expect(r.missingCount).toBe(1);
  });
});

describe("grading boundaries", () => {
  const bands = [
    { label: "Exceeding", minPercent: 90, maxPercent: 100, isPass: true },
    { label: "Meeting", minPercent: 75, maxPercent: 89.99, isPass: true },
    { label: "Approaching", minPercent: 58, maxPercent: 74.99, isPass: true },
    { label: "Below", minPercent: 40, maxPercent: 57.99, isPass: false },
    { label: "Intervention", minPercent: 0, maxPercent: 39.99, isPass: false },
  ];

  test("exact boundaries map to the correct band", () => {
    expect(gradeFor(bands, 90)?.label).toBe("Exceeding");
    expect(gradeFor(bands, 89.99)?.label).toBe("Meeting");
    expect(gradeFor(bands, 75)?.label).toBe("Meeting");
    expect(gradeFor(bands, 74.99)?.label).toBe("Approaching");
    expect(gradeFor(bands, 0)?.label).toBe("Intervention");
    expect(gradeFor(bands, 100)?.label).toBe("Exceeding");
  });

  test("out-of-range percentages yield no band", () => {
    expect(gradeFor(bands, -1)).toBeNull();
    expect(gradeFor(bands, 100.5)).toBeNull();
  });
});

describe("ranking (competition '1224' ties)", () => {
  test("ties share the best rank and the next rank skips", () => {
    expect(competitionRanks([90, 80, 80, 70])).toEqual([1, 2, 2, 4]);
    expect(competitionRanks([95, 95, 95])).toEqual([1, 1, 1]);
    expect(competitionRanks([])).toEqual([]);
  });
});

describe("overall average", () => {
  test("simple mean of subject percentages", () => {
    expect(overallAverage([80, 60])).toBe(70);
    expect(overallAverage([])).toBe(0);
  });
});

describe("completeness summary", () => {
  test("missing is unresolved; absent/exempt are explicit states", () => {
    const c = completeness(
      [
        input({ status: "entered" }),
        input({ status: "missing" }),
        input({ status: "absent" }),
        input({ status: "exempt" }),
      ],
      4,
    );
    expect(c.entered).toBe(1);
    expect(c.missing).toBe(1);
    expect(c.unresolvedMissing).toBe(1);
    expect(c.absent).toBe(1);
    expect(c.exempt).toBe(1);
    expect(c.hasAnyMarks).toBe(true);
  });
});

describe("mark validation", () => {
  test("rejects out-of-range and missing entered scores", () => {
    expect(validateScoreRow(null, 100, "entered")).toContain("Enter a score");
    expect(validateScoreRow(120, 100, "entered")).toContain("cannot exceed");
    expect(validateScoreRow(-1, 100, "entered")).toContain("negative");
    expect(validateScoreRow(null, 100, "absent")).toBeNull();
    expect(validateScoreRow(null, 100, "exempt")).toBeNull();
  });
});

describe("timetable conflict detection", () => {
  const slot = { dayOfWeek: "mon", periodId: "P1", who: "existing" };

  test("teacher collision detected in same slot", () => {
    const conflicts = detectConflicts(
      { dayOfWeek: "mon", periodId: "P1", staffId: "T1" },
      [{ ...slot, staffId: "T1" }],
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("teacher");
  });

  test("class collision detected in same slot", () => {
    const conflicts = detectConflicts(
      { dayOfWeek: "mon", periodId: "P1", classSectionId: "C1" },
      [{ ...slot, classSectionId: "C1" }],
    );
    expect(conflicts.some((c) => c.kind === "class")).toBe(true);
  });

  test("room collision detected in same slot", () => {
    const conflicts = detectConflicts(
      { dayOfWeek: "mon", periodId: "P1", roomId: "R1" },
      [{ ...slot, roomId: "R1" }],
    );
    expect(conflicts.some((c) => c.kind === "room")).toBe(true);
  });

  test("no collision in different slot", () => {
    const conflicts = detectConflicts(
      { dayOfWeek: "tue", periodId: "P1", staffId: "T1", classSectionId: "C1", roomId: "R1" },
      [{ ...slot, staffId: "T1", classSectionId: "C1", roomId: "R1" }],
    );
    expect(conflicts).toHaveLength(0);
  });

  test("self entry is ignored when updating", () => {
    const conflicts = detectConflicts(
      { entryId: "E1", dayOfWeek: "mon", periodId: "P1", staffId: "T1" },
      [{ ...slot, entryId: "E1", staffId: "T1" }],
    );
    expect(conflicts).toHaveLength(0);
  });
});

describe("school day helpers", () => {
  test("isSchoolDay and dayIndex", () => {
    expect(isSchoolDay(["mon", "tue"], "mon")).toBe(true);
    expect(isSchoolDay(["mon", "tue"], "sun")).toBe(false);
    expect(dayIndex("mon")).toBe(0);
    expect(dayIndex("unknown")).toBe(99);
  });
});

describe("attendance date helpers", () => {
  test("validDate and dayDiff", () => {
    expect(validDate("2026-02-10")).toBe(true);
    expect(validDate("2026-2-10")).toBe(false);
    expect(validDate("not-a-date")).toBe(false);
    expect(dayDiff("2026-02-10", "2026-02-05")).toBe(5);
    expect(dayDiff("2026-02-05", "2026-02-10")).toBe(-5);
  });
});
