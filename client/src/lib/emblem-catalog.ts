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
 * `idle` and `selected` are the same hue at two strengths, so selection reads as
 * more of the same colour rather than as a different one. An unknown colour --
 * only reachable from a payload whose scoring table and catalog disagree --
 * falls back to the neutral chrome every other control uses.
 */
const COLOR_STYLES: Record<
  string,
  { idle: string; selected: string; tag: string; bar: string }
> = {
  red: {
    idle: "border-red-200/80 text-red-700 bg-linear-to-br from-red-500/5 to-transparent hover:from-red-500/15 dark:border-red-900 dark:text-red-300",
    selected:
      "border-red-500 text-red-900 bg-linear-to-br from-red-500/30 via-red-500/10 to-transparent ring-2 ring-red-500/25 dark:text-red-100 dark:from-red-500/35",
    tag: "text-red-700 dark:text-red-300",
    bar: "bg-linear-to-b from-red-400 to-red-600",
  },
  blue: {
    idle: "border-blue-200/80 text-blue-700 bg-linear-to-br from-blue-500/5 to-transparent hover:from-blue-500/15 dark:border-blue-900 dark:text-blue-300",
    selected:
      "border-blue-500 text-blue-900 bg-linear-to-br from-blue-500/30 via-blue-500/10 to-transparent ring-2 ring-blue-500/25 dark:text-blue-100 dark:from-blue-500/35",
    tag: "text-blue-700 dark:text-blue-300",
    bar: "bg-linear-to-b from-blue-400 to-blue-600",
  },
  green: {
    idle: "border-emerald-200/80 text-emerald-700 bg-linear-to-br from-emerald-500/5 to-transparent hover:from-emerald-500/15 dark:border-emerald-900 dark:text-emerald-300",
    selected:
      "border-emerald-500 text-emerald-900 bg-linear-to-br from-emerald-500/30 via-emerald-500/10 to-transparent ring-2 ring-emerald-500/25 dark:text-emerald-100 dark:from-emerald-500/35",
    tag: "text-emerald-700 dark:text-emerald-300",
    bar: "bg-linear-to-b from-emerald-400 to-emerald-600",
  },
}

const NEUTRAL_STYLE = {
  idle: "border-input text-muted-foreground hover:bg-accent",
  selected: "border-ring bg-secondary ring-2 ring-ring/20",
  tag: "text-muted-foreground",
  bar: "bg-muted-foreground/40",
}

export const colorStyle = (color: string) => COLOR_STYLES[color] ?? NEUTRAL_STYLE

/** The choices that make an emblem. Colour is not one of the emblem's own
 * properties -- it follows from the stat -- but it is the choice a user makes
 * FIRST, and a half-built emblem needs somewhere to hold it. */
export interface Axes {
  color: string
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
