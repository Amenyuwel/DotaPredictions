import type { Emblem, FantasyRole, Scoring } from "../validate.js"

/**
 * Which colour sits in which slot, which is the rule that decides what a banner
 * can be at all.
 *
 * The colour of a slot is fixed by role and is not a choice:
 *
 *   core     red green red green red
 *   mid      red blue  green red   green
 *   support  blue green blue green blue
 *
 * A Group Stage banner is the first three of the same row, because the three
 * emblems carry over into the Main Event and two are added. All six sequences
 * are verified against the banners transcribed from the client in
 * `config/ti2026/banners.yaml` -- six transcriptions, six exact matches.
 *
 * This was wrong for a long time and wrong in a way that produced answers
 * rather than errors. The model held "a banner may repeat a colour but never a
 * stat", which is true but is not the rule: Core repeats red because slots 1, 3
 * and 5 ARE red, not because repetition is permitted. Under the loose rule the
 * catalog search happily put Gold Per Min -- a red stat -- on a Support banner,
 * which has no red slot, and reported a confident projection for a banner that
 * cannot exist.
 *
 * A stat belongs to exactly one colour, so a slot's colour is also the list of
 * six stats it can hold. That makes the constraint a narrowing rather than a
 * filter applied afterwards, which is why `bannerColors` travels in the run
 * payload: every direction of the tool reads the same row.
 */

/** The colour of each slot for one role, at this period's length. */
export function slotColors(
  scoring: Scoring,
  role: FantasyRole,
  slots: number,
): string[] | null {
  const row = scoring.bannerColors?.[role]
  // Null rather than a plausible default. A guessed sequence would put a stat
  // on a slot that cannot hold it, and nothing downstream would notice -- the
  // exact failure this module exists to end.
  if (!row || row.length < slots) return null
  return row.slice(0, slots)
}

/** The stats each slot may carry, in banner order. */
export function slotStatPools(
  scoring: Scoring,
  role: FantasyRole,
  slots: number,
): string[][] | null {
  const colors = slotColors(scoring, role, slots)
  if (!colors) return null
  const byColor = new Map<string, string[]>()
  for (const [stat, spec] of Object.entries(scoring.stats)) {
    const list = byColor.get(spec.color)
    if (list) list.push(stat)
    else byColor.set(spec.color, [stat])
  }
  return colors.map((color) => byColor.get(color) ?? [])
}

/**
 * Why this banner is illegal, or null if it is not.
 *
 * Both rules in one place because both are about the same thing -- whether
 * these emblems can sit in these slots -- and a caller that checked one and
 * forgot the other would accept half an impossible banner.
 */
export function bannerRejection(
  banner: Emblem[],
  scoring: Scoring,
  role: FantasyRole,
  slots: number,
): string | null {
  if (banner.length !== slots) {
    return `a banner in this stage is ${slots} emblems; you sent ${banner.length}`
  }

  const seen = new Set<string>()
  for (const emblem of banner) {
    if (seen.has(emblem.stat)) return "no stat may appear twice on a banner"
    seen.add(emblem.stat)
  }

  const colors = slotColors(scoring, role, slots)
  // No row published means the rule cannot be checked. Refusing here would take
  // the tool down for a payload from a server that predates the field; the
  // routes say so in their caveats instead.
  if (!colors) return null

  for (let i = 0; i < slots; i++) {
    const want = colors[i]!
    const got = scoring.stats[banner[i]!.stat]?.color
    if (got !== want) {
      return (
        `slot ${i + 1} of a ${role} banner is ${want}, and ${banner[i]!.stat} is ` +
        `${got ?? "an unknown colour"}. The colour of each slot is fixed by role: ` +
        `${colors.join(" ")}.`
      )
    }
  }
  return null
}
