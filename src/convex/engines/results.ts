/**
 * Pure result-calculation engine (no Convex imports) — unit-testable.
 *
 * Percentages are computed to two decimals; weights are percentage points
 * (0–100). A missing mark is NOT zero; it is excluded from the weighted total
 * but reported separately so schools can enforce their own completeness rules.
 */

export interface ScoreInput {
  assessmentId: string;
  title: string;
  maxMarks: number;
  weight: number; // percentage points
  countsTowardFinal: boolean;
  /** undefined when not yet entered */
  score?: number | null;
  status: "entered" | "absent" | "exempt" | "missing";
}

export interface ComponentBreakdown {
  assessmentId: string;
  title: string;
  score: number | null; // raw score if entered
  maxMarks: number;
  percent: number | null; // score/maxMarks*100
  weight: number;
  contribution: number | null; // percent × weight/100
  status: ScoreInput["status"];
}

export interface SubjectResult {
  /** weighted total in percentage points, out of weights that HAVE marks */
  totalScore: number;
  /** percentage achieved out of the weights that have marks */
  percentage: number;
  /** sum of weights for components with entered marks */
  weightsWithMarks: number;
  /** sum of ALL components configured to count toward the final grade */
  totalWeight: number;
  /** sum of weights for assessments marked absent */
  absentWeight: number;
  /** number of components with no mark entered (missing, not absent/exempt) */
  missingCount: number;
  absentCount: number;
  exemptCount: number;
  enteredCount: number;
  components: ComponentBreakdown[];
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Normalize a score to a percentage: 40/50 → 80. Rejects out-of-range inputs
 * upstream (validation happens at mark-entry time); here we just clamp guard.
 */
export function scorePercent(score: number, maxMarks: number): number {
  if (maxMarks <= 0) return 0;
  const pct = (score / maxMarks) * 100;
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return round2(Math.min(pct, 100));
}

/**
 * Weighted result for one student × subject × term.
 *
 * - Each entered component contributes percent × weight/100.
 * - Absent components are excluded from the denominator by default (a student
 *   who missed one assessment is not automatically zeroed); schools that want
 *   absent-as-zero policy can pass `absentCountsAsZero`.
 * - Missing (not entered) marks never contribute and never zero out.
 */
export function computeSubjectResult(
  scores: ScoreInput[],
  opts: { absentCountsAsZero?: boolean } = {},
): SubjectResult {
  const components: ComponentBreakdown[] = [];
  let totalScore = 0;
  let weightsWithMarks = 0;
  let totalWeight = 0;
  let absentWeight = 0;
  let missingCount = 0;
  let absentCount = 0;
  let exemptCount = 0;
  let enteredCount = 0;

  for (const s of scores) {
    const counts = s.countsTowardFinal !== false;
    if (counts) totalWeight = round2(totalWeight + s.weight);

    if (s.status === "entered" && typeof s.score === "number") {
      const percent = scorePercent(s.score, s.maxMarks);
      const contribution = counts ? round2((percent * s.weight) / 100) : 0;
      components.push({
        assessmentId: s.assessmentId,
        title: s.title,
        score: s.score,
        maxMarks: s.maxMarks,
        percent,
        weight: s.weight,
        contribution: counts ? contribution : null,
        status: s.status,
      });
      if (counts) {
        totalScore = round2(totalScore + contribution);
        weightsWithMarks = round2(weightsWithMarks + s.weight);
        enteredCount++;
      }
    } else if (s.status === "absent") {
      absentCount++;
      if (counts) {
        absentWeight = round2(absentWeight + s.weight);
        if (opts.absentCountsAsZero) {
          totalScore = round2(totalScore + 0);
          weightsWithMarks = round2(weightsWithMarks + s.weight);
        }
      }
      components.push({
        assessmentId: s.assessmentId,
        title: s.title,
        score: null,
        maxMarks: s.maxMarks,
        percent: null,
        weight: s.weight,
        contribution: null,
        status: s.status,
      });
    } else if (s.status === "exempt") {
      exemptCount++;
      components.push({
        assessmentId: s.assessmentId,
        title: s.title,
        score: null,
        maxMarks: s.maxMarks,
        percent: null,
        weight: s.weight,
        contribution: null,
        status: s.status,
      });
    } else {
      missingCount++;
      components.push({
        assessmentId: s.assessmentId,
        title: s.title,
        score: null,
        maxMarks: s.maxMarks,
        percent: null,
        weight: s.weight,
        contribution: null,
        status: "missing",
      });
    }
  }

  const percentage =
    weightsWithMarks > 0 ? round2((totalScore / weightsWithMarks) * 100) : 0;

  return {
    totalScore,
    percentage,
    weightsWithMarks,
    totalWeight,
    absentWeight,
    missingCount,
    absentCount,
    exemptCount,
    enteredCount,
    components,
  };
}

/** Map a percentage to a grade band. Bands must not overlap (validated at save). */
export interface GradeBandLike {
  label: string;
  minPercent: number;
  maxPercent: number;
  isPass?: boolean;
}

export function gradeFor(bands: GradeBandLike[], percent: number): GradeBandLike | null {
  for (const b of bands) {
    if (percent >= b.minPercent && percent <= b.maxPercent) return b;
  }
  return null;
}

/** Overall average across subjects (simple mean of percentages). */
export function overallAverage(subjectPercents: number[]): number {
  if (subjectPercents.length === 0) return 0;
  return round2(subjectPercents.reduce((a, b) => a + b, 0) / subjectPercents.length);
}

/**
 * Competition ranking ("1224"): ties share the best rank, next rank skips.
 * Input is expected sorted descending by score. Returns 1-based ranks.
 */
export function competitionRanks(scores: number[]): number[] {
  const ranks: number[] = [];
  let lastScore: number | null = null;
  let lastRank = 0;
  scores.forEach((score, i) => {
    if (lastScore !== null && score === lastScore) {
      ranks.push(lastRank);
    } else {
      lastRank = i + 1;
      lastScore = score;
      ranks.push(lastRank);
    }
  });
  return ranks;
}

/** Completeness summary used by submission checks (§43). */
export interface CompletenessSummary {
  enrolled: number;
  entered: number;
  absent: number;
  exempt: number;
  missing: number;
  /** unresolved = missing marks (absent/exempt are explicit states, not gaps) */
  unresolvedMissing: number;
  hasAnyMarks: boolean;
}

export function completeness(scores: ScoreInput[], enrolled: number): CompletenessSummary {
  let entered = 0;
  let absent = 0;
  let exempt = 0;
  let missing = 0;
  for (const s of scores) {
    if (s.status === "entered") entered++;
    else if (s.status === "absent") absent++;
    else if (s.status === "exempt") exempt++;
    else missing++;
  }
  return {
    enrolled,
    entered,
    absent,
    exempt,
    missing,
    unresolvedMissing: missing,
    hasAnyMarks: entered + absent + exempt > 0,
  };
}

/** Validate a marking grid payload row (§34). */
export function validateScoreRow(
  score: number | null,
  maxMarks: number,
  status: "entered" | "absent" | "exempt",
): string | null {
  if (status === "entered") {
    if (score === null || score === undefined) return "Enter a score or mark the student absent/exempt.";
    if (!Number.isFinite(score)) return "Score must be a number.";
    if (score < 0) return "Score cannot be negative.";
    if (score > maxMarks) return `Score cannot exceed the maximum of ${maxMarks}.`;
  }
  return null;
}
