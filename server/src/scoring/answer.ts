import type { Emblem } from "../validate.js"

/**
 * The two rules every answer this server gives has to obey, in one place.
 *
 * Both directions of the tool produce a ranked list with intervals on it, and
 * both have to say the same two things about it: which rows cannot be told
 * apart, and which emblems the model is blind to. Two implementations of either
 * would be two answers to one question, and the one a user saw would be
 * whichever route they arrived through.
 */

/** Ids whose interval overlaps the leader's, which is a tie and not a ranking.
 *
 * Overlap is the whole reason this tool exists rather than a spreadsheet. On
 * the TI 2026 Main Event banners no slot's first place is separated from its
 * second, and presenting those as 1-2-3 would state a distinction the sampling
 * error denies. */
export function overlapping<T extends { ci: { lo: number; hi: number } }>(
  best: T,
  all: T[],
  idOf: (item: T) => string,
): string[] {
  return all
    .filter(
      (item) =>
        idOf(item) !== idOf(best) && item.ci.lo <= best.ci.hi && best.ci.lo <= item.ci.hi,
    )
    .map(idOf)
}

/** What the model cannot see on this banner, in the words the user needs. The
 * same emblem is blind in the same way whichever end of the question it arrived
 * from, and two wordings of one limitation read as two limitations. */
export function unmeasurableCaveats(banner: Emblem[]): string[] {
  return banner
    .filter((e) => !e.measurable)
    .map(
      (e) =>
        `${e.displayName}: no data, scored 0 here. It still pays in the client.`,
    )
}
