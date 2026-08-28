/**
 * Whether two answers are actually distinguishable.
 *
 * This is the rule the tool exists to enforce, not a display nicety. On the
 * TI 2026 Main Event banners no slot's first place is separated from its
 * second: core leads by 45 points against a 737-point joint sampling error,
 * mid by 146 against 580, support by 280 against 565. Presenting those as a
 * ranked list with a winner states something the numbers do not support.
 *
 * The server sends `tied` so both sides agree on the verdict. This function is
 * the local fallback and the definition of the rule: intervals that overlap
 * are a tie.
 */
import type { RankedUnit } from "@/types/run"

export function overlaps(a: RankedUnit, b: RankedUnit): boolean {
  return a.ci.lo <= b.ci.hi && b.ci.lo <= a.ci.hi
}

/** Ids from `units` that cannot be separated from `best`, `best` excluded. */
export function tiedWith(best: RankedUnit, units: RankedUnit[]): string[] {
  return units.filter((u) => u.unitId !== best.unitId && overlaps(best, u)).map((u) => u.unitId)
}

/**
 * How to label a result. `lead` is reserved for a gap the interval supports;
 * everything overlapping is `tied`, and the UI must give both the same weight.
 */
export type Verdict = "lead" | "tied"

export function verdictFor(unit: RankedUnit, best: RankedUnit, tied: string[]): Verdict {
  if (unit.unitId === best.unitId) return tied.length > 0 ? "tied" : "lead"
  return tied.includes(unit.unitId) ? "tied" : "lead"
}
