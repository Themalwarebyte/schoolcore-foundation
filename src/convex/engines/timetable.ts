/**
 * Pure timetable-conflict engine (no Convex imports) — unit-testable.
 *
 * A timetable entry is identified by (dayOfWeek, periodId). Conflicts:
 *  - teacher: same staffId scheduled twice in the same slot
 *  - class:   same classSectionId scheduled twice in the same slot
 *  - room:    same roomId scheduled twice in the same slot
 */

export interface EntrySlot {
  entryId?: string;
  dayOfWeek: string;
  periodId: string;
  staffId?: string | null;
  classSectionId?: string | null;
  roomId?: string | null;
}

export type ConflictKind = "teacher" | "class" | "room";

export interface Conflict {
  kind: ConflictKind;
  /** human label of the colliding entry, e.g. "Grace Wanjiku — Grade 8 Blue" */
  who: string;
  dayOfWeek: string;
  periodName: string;
}

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export function dayIndex(day: string): number {
  const i = DAY_ORDER.indexOf(day);
  return i < 0 ? 99 : i;
}

/**
 * Detect conflicts for a candidate entry against existing entries in the same
 * week grid. `existing` must already be scoped to the same academic year/term
 * (term semantics: entries are per-year; termId is advisory).
 */
export function detectConflicts(
  candidate: EntrySlot,
  existing: (EntrySlot & { who: string })[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const e of existing) {
    if (e.dayOfWeek !== candidate.dayOfWeek || e.periodId !== candidate.periodId) continue;
    if (candidate.entryId && e.entryId === candidate.entryId) continue; // self
    if (
      candidate.staffId &&
      e.staffId &&
      candidate.staffId === e.staffId
    ) {
      conflicts.push({
        kind: "teacher",
        who: e.who,
        dayOfWeek: candidate.dayOfWeek,
        periodName: candidate.periodId,
      });
    }
    if (
      candidate.classSectionId &&
      e.classSectionId &&
      candidate.classSectionId === e.classSectionId
    ) {
      conflicts.push({
        kind: "class",
        who: e.who,
        dayOfWeek: candidate.dayOfWeek,
        periodName: candidate.periodId,
      });
    }
    if (candidate.roomId && e.roomId && candidate.roomId === e.roomId) {
      conflicts.push({
        kind: "room",
        who: e.who,
        dayOfWeek: candidate.dayOfWeek,
        periodId: candidate.periodId,
        periodName: candidate.periodId,
      } as Conflict);
    }
  }
  return conflicts;
}

/** True when the given day is a configured school day. */
export function isSchoolDay(schoolDays: string[], day: string): boolean {
  return schoolDays.includes(day);
}
