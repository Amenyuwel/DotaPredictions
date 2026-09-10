/**
 * One view over the emblem catalog, for every screen that offers a choice from
 * it.
 *
 * The published catalog is a flat cross product -- every stat x tier x trait,
 * 450 rows for a Main Event. Nothing in the UI wants it in that shape: the
 * builder wants "what can slot 3 become", the dialog wants "which stats are
 * red". Both want the same answer, so the reshaping happens once, here, rather
 * than in each component with its own idea of the axes.
 *
 * Every list is derived from the emblems that actually exist rather than from a
 * list hardcoded here, so a stage shipping a sixth tier or a new trait offers it
 * without a client release.
 */
import { percent } from "@/lib/format"
import type { Emblem, Scoring } from "@/types/run"

/** The colour an unlisted stat falls into.
 *
 * Reachable only if the catalog names a stat the scoring table does not, which
 * is a broken payload. It gets its own visible chip rather than being dropped
 * from the picker: an emblem missing from every list looks like an emblem that
 * does not exist, and a silently unpickable option is exactly the kind of wrong
 * answer this tool must not give.
 */
export const UNCLASSIFIED = "unclassified"

/**
 * Colour name -> how a control wearing that colour is painted.
 *
 * The chip IS the colour rather than carrying a swatch beside it: a dot is a
 * legend for a thing that could have been drawn in the colour itself. Colour is
 * still never the only signal -- every one of these is drawn behind the word
 * "Red", "Blue" or "Green" -- so the paint is confirmation, not information, and
 * a reader who cannot separate red from green loses nothing.
 *
 * `idle` contributes no paint at all -- a resting chip is the same control as
 * every other button on the screen, and only says which colour it is with the
 * word inside it. The weave arrives on hover and stays for a selected chip, one
 * pair of tones deeper. So colour here is what a pointer or a choice reveals,
 * and a reader who cannot separate red from green loses nothing, because the
 * word was doing the work the whole time.
 *
 * `tag` and `bar` are the exception, and deliberately: they are not buttons.
 * The word under a builder row and the stripe down its edge are the standing
 * record of what a banner is, so they are painted always -- `tag` in ink on the
 * card, `bar` in the mark, which is the colour flat because six pixels of weave
 * is mush rather than a pattern.
 */
/**
 * One recipe, at whatever hue the element declares.
 *
 * These were three near-identical blocks -- the same classes with "red", "blue"
 * and "emerald" swapped in -- which drift the moment one is edited and were
 * never actually equal: Tailwind's red-200, blue-200 and emerald-200 sit at
 * different lightness and chroma, so the three buttons read as three different
 * weights of control.
 *
 * Now the strings are identical for every colour and the hue arrives as a data
 * attribute, resolved by the `[data-emblem]` block in index.css where lightness
 * and chroma are shared. Two colours cannot look different weights, because
 * there is only one set of classes.
 *
 * What the three do not share is the pattern -- the client gives red a
 * checkerboard, blue stripes and green a lattice -- but that too arrives
 * through the attribute, as `--emblem-pattern`. So the pattern differs without
 * the classes differing, which is the whole point of the split.
 */
const SKIN =
  "bg-[var(--emblem-ground)] bg-[image:var(--emblem-pattern)] bg-[length:var(--emblem-pattern-size)]"

/** The same weave, revealed on hover.
 *
 * Written out with the prefix on each class rather than built from `SKIN` with
 * a map at runtime: Tailwind reads this file as text, so a class name that only
 * exists once the strings are joined is a class name it never generates, and
 * the rule silently does not exist.
 *
 * It also does the second job of beating `Choice`'s own `hover:bg-accent`.
 * Without a hover background declared here that grey wins the merge, and the
 * hover that is supposed to show the pattern shows chrome instead. */
const SKIN_HOVER =
  "hover:bg-[var(--emblem-ground)] hover:bg-[image:var(--emblem-pattern)] hover:bg-[length:var(--emblem-pattern-size)]"

/** The deeper pair. Both halves are needed: moving the ground alone would leave
 * the pattern at its old lightness, which is the one way these two tones end up
 * further apart than any state is drawn. */
const DEEPER = "[--emblem-ground:var(--emblem-ground-on)] [--emblem-pat:var(--emblem-pat-on)]"

const TONE = {
  idle: SKIN_HOVER,
  selected: `${SKIN} ${DEEPER} border-[var(--emblem-mark)] text-[var(--emblem-ink)] ring-2 ring-[var(--emblem-ring)]`,
  tag: "text-[var(--emblem-ink)]",
  bar: "bg-[var(--emblem-mark)]",
} as const

/**
 * The classes for an emblem colour, plus the attribute that selects its hue.
 *
 * Spread `attrs` onto the same element the classes go on -- the custom
 * properties are declared by that attribute, so the two cannot be separated.
 */
export const colorStyle = (color: string) => ({
  ...TONE,
  attrs: { "data-emblem": COLOR_HUES.has(color) ? color : UNCLASSIFIED },
})

/** Colours index.css declares a hue for. Anything else is drawn at zero chroma
 * rather than given a style of its own. */
const COLOR_HUES = new Set(["red", "blue", "green"])

/** The choices that make an emblem. Colour is not one of the emblem's own
 * properties -- it follows from the stat -- but it is the choice a user makes
 * FIRST, and a half-built emblem needs somewhere to hold it.
 *
 * Every axis is nullable, colour included. An empty slot opens with nothing
 * chosen rather than on a colour picked for the user: a preselected red is
 * indistinguishable from a red the user chose, and the difference matters when
 * the thing being built is a projection someone will act on. */
export interface Axes {
  color: string | null
  stat: string | null
  tier: string | null
  trait: string | null
}

export interface StatOption {
  stat: string
  label: string
  measurable: boolean
}

export interface EmblemCatalog {
  /** Colours in the scoring table's own order, with anything it does not list
   * appended rather than hidden. */
  colors: string[]
  statsByColor: Map<string, StatOption[]>
  /** Stat key -> the name a reader sees. */
  statLabels: Map<string, string>
  /** Ascending by what they pay, which is the order a reader expects to scan --
   * not the order the catalog happened to list them in. */
  tiers: string[]
  traits: string[]
  colorOf: (stat: string) => string
  /** Resolve three axes to a catalog row, or null if no such row exists. */
  resolve: (axes: Axes) => Emblem | null
}

/** "tier_v" -> "V". The catalog ships tier as a key, not a label, and the
 * numeral alone is what the client stamps on an emblem. */
export const tierNumeral = (tier: string) => tier.replace(/^tier_/, "").toUpperCase()

/** "tier_v" -> "Tier V", for anywhere the numeral needs saying out loud. */
export const tierLabel = (tier: string) => `Tier ${tierNumeral(tier)}`

export const traitLabel = (trait: string) =>
  trait.charAt(0).toUpperCase() + trait.slice(1)

/** A signed percentage: `percent` alone renders -0.1 as "-10%" but 0.5 as "50%",
 * and a bonus that does not say it is a bonus reads like a total. */
export const signed = (value: number) => (value > 0 ? `+${percent(value)}` : percent(value))

/** What a trait pays, in the scoring table's own numbers rather than a sentence
 * written here -- a hand-typed "+50%" goes stale the day the table moves. */
export function traitDetail(scoring: Scoring | undefined, trait: string) {
  const spec = scoring?.traits[trait]
  if (!spec) return ""
  const parts: string[] = []
  if (spec.bonus) parts.push(signed(spec.bonus))
  if (spec.adjacentBonus) parts.push(`${signed(spec.adjacentBonus)} to each neighbour`)
  const base = parts.join(", ") || "no bonus"
  return spec.condition ? `${base} if ${spec.condition}` : base
}

/** The three axes of an emblem, as the dialog holds them. */
export const axesOf = (emblem: Emblem, colorOf: (stat: string) => string): Axes => ({
  color: colorOf(emblem.stat),
  stat: emblem.stat,
  tier: emblem.tier,
  trait: emblem.trait,
})

/**
 * `scoring` may be undefined only when the browser is replaying a cached
 * `/api/run/current` from a server that predates the field -- the response is
 * cached for an hour, so a deploy that adds a field has a window where old
 * bodies are still in play. Handled rather than assumed away: a missing scoring
 * table must cost the colour split, not the whole page.
 */
export function buildCatalog(
  emblems: Emblem[],
  scoring: Scoring | undefined,
): EmblemCatalog {
  const stats = scoring?.stats ?? {}
  const colorOf = (stat: string) => stats[stat]?.color ?? UNCLASSIFIED

  const statsByColor = new Map<string, StatOption[]>()
  const statLabels = new Map<string, string>()
  const tiers: string[] = []
  const traits: string[] = []
  const byId = new Map<string, Emblem>()

  for (const emblem of emblems) {
    byId.set(emblem.emblemId, emblem)
    if (!statLabels.has(emblem.stat)) {
      // The stat's own name, taken off the server's `displayName` (which is
      // "<Stat> <TIER> <Trait>") rather than re-prettified here: two
      // prettifiers for one string drift, and the name the user reads should be
      // the name the catalog shipped.
      const label = emblem.displayName.split(" ").slice(0, -2).join(" ")
      statLabels.set(emblem.stat, label)
      const color = colorOf(emblem.stat)
      const list = statsByColor.get(color) ?? []
      list.push({ stat: emblem.stat, label, measurable: emblem.measurable })
      statsByColor.set(color, list)
    }
    if (!tiers.includes(emblem.tier)) tiers.push(emblem.tier)
    if (!traits.includes(emblem.trait)) traits.push(emblem.trait)
  }

  for (const list of statsByColor.values()) list.sort((a, b) => a.label.localeCompare(b.label))

  const listed = (scoring?.colors ?? []).filter((c) => statsByColor.has(c))
  const rest = [...statsByColor.keys()].filter((c) => !listed.includes(c))

  const quality = scoring?.quality ?? {}
  tiers.sort((a, b) => (quality[a] ?? 0) - (quality[b] ?? 0))

  return {
    colors: [...listed, ...rest],
    statsByColor,
    statLabels,
    tiers,
    traits,
    colorOf,
    // A lookup, never a constructed id: an id built from three strings would
    // happily name a row that does not exist and send it to the scorer.
    resolve: ({ stat, tier, trait }) =>
      stat && tier && trait ? (byId.get(`${stat}:${tier}:${trait}`) ?? null) : null,
  }
}
