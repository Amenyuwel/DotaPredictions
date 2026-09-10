import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { percent } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Emblem, Scoring } from "@/types/run"

/** The colour an unlisted stat falls into.
 *
 * Reachable only if the emblem catalog names a stat the scoring table does not,
 * which is a broken payload. It gets its own visible chip rather than being
 * dropped from the picker: an emblem missing from every dropdown looks like an
 * emblem that does not exist, and a silently unpickable option is exactly the
 * kind of wrong answer this tool must not give.
 */
const UNCLASSIFIED = "unclassified"

/** Colour name -> the dot rendered for it. Unknown names keep a neutral dot, so
 * a colour added to `scoring.yaml` shows up uncoloured rather than not at all. */
const DOT: Record<string, string> = {
  red: "bg-red-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
}

/** The choices that make an emblem. Colour is not one of the emblem's own
 * properties -- it follows from the stat -- but it is the choice the user makes
 * FIRST, and an empty slot needs somewhere to hold it. */
interface Axes {
  color: string
  stat: string | null
  tier: string | null
  trait: string | null
}

/** The letter on a colour chip. Colour is never the only signal: a red dot and
 * a green dot are the same dot to a colourblind reader, so the chip carries the
 * initial and its accessible name is the whole word. */
const initial = (color: string) => color.charAt(0).toUpperCase()

/** "tier_v" -> "Tier V". The catalog ships tier as a key, not a label. */
const tierLabel = (tier: string) => `Tier ${tier.replace(/^tier_/, "").toUpperCase()}`

const traitLabel = (trait: string) => trait.charAt(0).toUpperCase() + trait.slice(1)

/** The stat's own name, taken off the server's `displayName` (which is
 * "<Stat> <TIER> <Trait>") rather than re-prettified here: two prettifiers for
 * one string drift, and the name the user reads should be the name the catalog
 * shipped. */
const statLabel = (emblem: Emblem) => emblem.displayName.split(" ").slice(0, -2).join(" ")

/** A signed percentage: `percent` alone renders -0.1 as "-10%" but 0.5 as "50%",
 * and a bonus that does not say it is a bonus reads like a total. */
const signed = (value: number) => (value > 0 ? `+${percent(value)}` : percent(value))

/**
 * Build a banner, emblem by emblem.
 *
 * An emblem is three independent choices -- STAT, QUALITY and TRAIT -- and the
 * catalog is their full cross product, 450 rows. So the axes are separate
 * controls, and a fourth, COLOUR, narrows the stat list to the six stats of one
 * colour. Each dropdown holds one colour's stats and no other's; no list on this
 * screen is longer than six.
 *
 * The whole banner has to be readable without scrolling, because the emblems are
 * not independent of each other -- Vampiric charges each NEIGHBOUR -10% and
 * Benevolent pays each +20%, so slot 4 is an argument about slots 3 and 5. A
 * builder that shows one emblem at a time hides the input the user is reasoning
 * about. Hence two lines per emblem and no per-slot chrome: the colour picker is
 * three letter-wide chips sharing a line with the stat, so five emblems fit on
 * one screen with colour still its own control.
 *
 * A slot is only worth scoring once all three axes are set. Until then it holds
 * null and the result panel says how many are left, rather than scoring a
 * partial banner as though it were a whole one.
 *
 * A banner may repeat a colour but never a stat, so a stat already placed is
 * unselectable rather than merely discouraged.
 */
export function BannerBuilder({
  emblems,
  scoring,
  slots,
  value,
  onChange,
}: {
  emblems: Emblem[]
  /** Undefined only when the browser is replaying a cached `/api/run/current`
   * from a server that predates the field -- the response is cached for an hour,
   * so a deploy that adds a field has a window where old bodies are still in
   * play. Handled rather than assumed away: a missing colour table must cost the
   * colour split, not the whole page. */
  scoring: Scoring | undefined
  slots: number
  value: (Emblem | null)[]
  onChange: (next: (Emblem | null)[]) => void
}) {
  const usedStats = new Set(value.filter(Boolean).map((e) => e!.stat))

  const colorOf = useMemo(() => {
    // Read off the published scoring table rather than a map kept here: the
    // colour of a stat is a scoring rule, and a second copy in the browser is
    // one `scoring.yaml` edit away from disagreeing with the engine.
    const byStat = scoring?.stats ?? {}
    return (stat: string) => byStat[stat]?.color ?? UNCLASSIFIED
  }, [scoring])

  /** Catalog-derived option lists. Every axis is read off the emblems that
   * exist rather than off a list hardcoded here, so a stage shipping a sixth
   * tier or a new trait offers it without a client release. */
  const { colors, statsByColor, statById, tiers, traits, byId } = useMemo(() => {
    const groups = new Map<
      string,
      { stat: string; label: string; measurable: boolean }[]
    >()
    const statById = new Map<string, string>()
    const tiers: string[] = []
    const traits: string[] = []
    const byId = new Map<string, Emblem>()

    for (const emblem of emblems) {
      byId.set(emblem.emblemId, emblem)
      if (!statById.has(emblem.stat)) {
        const label = statLabel(emblem)
        statById.set(emblem.stat, label)
        const list = groups.get(colorOf(emblem.stat)) ?? []
        list.push({ stat: emblem.stat, label, measurable: emblem.measurable })
        groups.set(colorOf(emblem.stat), list)
      }
      if (!tiers.includes(emblem.tier)) tiers.push(emblem.tier)
      if (!traits.includes(emblem.trait)) traits.push(emblem.trait)
    }
    for (const list of groups.values()) list.sort((a, b) => a.label.localeCompare(b.label))

    // Colours in the scoring table's own order, with anything it does not list
    // appended rather than hidden.
    const listed = (scoring?.colors ?? []).filter((c) => groups.has(c))
    const rest = [...groups.keys()].filter((c) => !listed.includes(c))

    // Tiers ascend by what they pay, not by the order the catalog happened to
    // list them: Tier I through Tier V is the order a reader expects to scan.
    const quality = scoring?.quality ?? {}
    tiers.sort((a, b) => (quality[a] ?? 0) - (quality[b] ?? 0))

    return {
      colors: [...listed, ...rest],
      statsByColor: groups,
      statById,
      tiers,
      traits,
      byId,
    }
  }, [emblems, colorOf, scoring])

  // Only the axes of an UNFINISHED slot need remembering -- a resolved slot
  // reads all three off the emblem in it, so a banner loaded from a save lands
  // on the right controls without this state being told about it, and there is
  // no second copy to disagree with the banner being scored.
  const [partial, setPartial] = useState<Axes[]>([])

  const axesAt = (index: number): Axes => {
    const current = value[index] ?? null
    if (current) {
      return {
        color: colorOf(current.stat),
        stat: current.stat,
        tier: current.tier,
        trait: current.trait,
      }
    }
    const held = partial[index]
    return {
      // Slots start on different colours, so a fresh banner opens showing all
      // three rather than five copies of the same six stats.
      color: held?.color ?? colors[index % Math.max(colors.length, 1)] ?? UNCLASSIFIED,
      stat: held?.stat ?? null,
      tier: held?.tier ?? null,
      trait: held?.trait ?? null,
    }
  }

  /**
   * Apply one axis and re-resolve the slot.
   *
   * Resolution is a catalog lookup, never a constructed id: an id built from
   * three strings would happily name a row that does not exist and send it to
   * the scorer. A combination with no row leaves the slot empty and visibly
   * unfinished instead.
   */
  const change = (index: number, patch: Partial<Axes>) => {
    const next = { ...axesAt(index), ...patch }
    // A stat belongs to exactly one colour, so switching colour drops the stat
    // but keeps quality and trait -- those are colour-independent, and making
    // the user re-pick them would punish browsing.
    if (patch.color && next.stat && colorOf(next.stat) !== patch.color) next.stat = null

    setPartial((prev) => {
      const copy = [...prev]
      copy[index] = next
      return copy
    })

    const banner = [...value]
    banner[index] =
      next.stat && next.tier && next.trait
        ? (byId.get(`${next.stat}:${next.tier}:${next.trait}`) ?? null)
        : null
    onChange(banner)
  }

  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Banner emblems</legend>

      <ol className="space-y-2.5">
        {Array.from({ length: slots }, (_, i) => {
          const current = value[i] ?? null
          const axes = axesAt(i)

          return (
            <li
              key={i}
              className="grid grid-cols-[0.75rem_auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1.5"
            >
              <span className="text-muted-foreground text-xs tabular-nums">{i + 1}</span>

              <fieldset className="flex">
                <legend className="sr-only">Emblem {i + 1} colour</legend>
                {colors.map((c, position) => (
                  <label
                    key={c}
                    title={c}
                    className={cn(
                      "border-input flex min-h-10 cursor-pointer items-center justify-center border px-1.5 text-xs font-medium transition-colors",
                      "hover:bg-accent has-[:focus-visible]:border-ring has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:z-10 has-[:focus-visible]:ring-3",
                      position === 0 && "rounded-l-lg",
                      position === colors.length - 1 && "rounded-r-lg",
                      position > 0 && "-ml-px",
                      axes.color === c
                        ? "border-ring bg-secondary z-10"
                        : "text-muted-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name={`slot-${i}-color`}
                      value={c}
                      checked={axes.color === c}
                      onChange={() => change(i, { color: c })}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "mr-1 size-1.5 rounded-full",
                        DOT[c] ?? "bg-muted-foreground",
                      )}
                    />
                    <span aria-hidden>{initial(c)}</span>
                    <span className="sr-only">{c}</span>
                  </label>
                ))}
              </fieldset>

              <div className="flex min-w-0 items-center gap-1.5">
                <Select
                  value={axes.stat ?? ""}
                  onValueChange={(next) => change(i, { stat: next })}
                >
                  {/* Labelled by `aria-label` rather than a visible <label> per
                      control: fifteen labels for five emblems is three screens
                      of chrome, and a chosen value ("Tier V", "Vampiric") names
                      its own axis. The placeholder names it until then. */}
                  <SelectTrigger
                    aria-label={`Emblem ${i + 1} stat`}
                    className="min-h-10 w-full"
                  >
                    <SelectValue>
                      {(v: string) => (v ? (statById.get(v) ?? v) : "Stat")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(statsByColor.get(axes.color) ?? []).map((s) => (
                      <SelectItem
                        key={s.stat}
                        value={s.stat}
                        disabled={usedStats.has(s.stat) && s.stat !== current?.stat}
                      >
                        {s.label}
                        {!s.measurable && " — no data"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {current && !current.measurable && (
                  <Tooltip>
                    {/* Base UI composes through `render`, not `asChild`. */}
                    <TooltipTrigger render={<Badge variant="outline">no data</Badge>} />
                    <TooltipContent>
                      This stat has no field in the match data at any depth, so it scores 0
                      for every player here. It is worth real points in the client — the
                      model simply cannot see them.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              <div className="col-span-2 col-start-2 grid grid-cols-2 gap-1.5">
                <Select
                  value={axes.tier ?? ""}
                  onValueChange={(next) => change(i, { tier: next })}
                >
                  <SelectTrigger
                    aria-label={`Emblem ${i + 1} quality`}
                    className="min-h-10 w-full"
                  >
                    <SelectValue>{(v: string) => (v ? tierLabel(v) : "Quality")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {tiers.map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        <span className="flex flex-col items-start">
                          <span>{tierLabel(tier)}</span>
                          <span className="text-muted-foreground text-xs">
                            {signed(scoring?.quality[tier] ?? 0)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={axes.trait ?? ""}
                  onValueChange={(next) => change(i, { trait: next })}
                >
                  <SelectTrigger
                    aria-label={`Emblem ${i + 1} trait`}
                    className="min-h-10 w-full"
                  >
                    <SelectValue>{(v: string) => (v ? traitLabel(v) : "Trait")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {traits.map((trait) => (
                      <SelectItem key={trait} value={trait}>
                        <span className="flex flex-col items-start">
                          <span>{traitLabel(trait)}</span>
                          <span className="text-muted-foreground text-xs">
                            {traitDetail(scoring, trait)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          1 to {slots} is top to bottom on your banner: Vampiric takes 10% from each
          neighbour, Benevolent pays each 20%.
        </p>
        {value.some(Boolean) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPartial([])
              onChange(Array(slots).fill(null))
            }}
          >
            Clear
          </Button>
        )}
      </div>
    </fieldset>
  )
}

/** What a trait pays, in the scoring table's own numbers rather than a sentence
 * written here -- a hand-typed "+50%" goes stale the day the table moves. */
function traitDetail(scoring: Scoring | undefined, trait: string) {
  const spec = scoring?.traits[trait]
  if (!spec) return ""
  const parts: string[] = []
  if (spec.bonus) parts.push(signed(spec.bonus))
  if (spec.adjacentBonus) parts.push(`${signed(spec.adjacentBonus)} to each neighbour`)
  const base = parts.join(", ") || "no bonus"
  return spec.condition ? `${base} if ${spec.condition}` : base
}
