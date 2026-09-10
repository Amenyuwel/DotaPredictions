/**
 * How to label a result once the server has decided what is separable.
 *
 * The rule this enforces is the reason the tool exists, not a display nicety.
 * On the TI 2026 Main Event banners no slot's first place is separated from its
 * second: core leads by 45 points against a 737-point joint sampling error, mid
 * by 146 against 580, support by 280 against 565. Presenting those as a ranked
 * list with a winner states something the numbers do not support.
 *
 * The overlap test itself lives on the server, which sends `tied` with every
 * answer. It is deliberately NOT reimplemented here: two implementations of one
 * number are two answers that can disagree, and the one the user sees would be
 * whichever happened to run last.
 */
import type { RankedUnit } from "@/types/run"

/**
 * How to label a row. `lead` is reserved for a gap the interval supports;
 * anything overlapping is `tied`, and the UI must give both the same weight.
 */
export type Verdict = "lead" | "tied"

export function verdictFor(unit: RankedUnit, best: RankedUnit, tied: string[]): Verdict {
  if (unit.unitId === best.unitId) return tied.length > 0 ? "tied" : "lead"
  return tied.includes(unit.unitId) ? "tied" : "lead"
}
