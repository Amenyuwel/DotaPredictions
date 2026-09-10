import { useMemo, useState } from "react"
import { Plus } from "lucide-react"

import { EmblemDialog } from "@/components/emblem-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  axesOf,
  buildCatalog,
  colorStyle,
  tierLabel,
  tierNumeral,
  traitLabel,
  UNCLASSIFIED,
  type Axes,
} from "@/lib/emblem-catalog"
import { cn } from "@/lib/utils"
import type { Emblem, Scoring } from "@/types/run"

/**
 * The banner: five slots, each opening a dialog that builds one emblem.
 *
 * The list is one row per emblem and nothing else, because the emblems are not
 * independent of each other -- Vampiric charges each NEIGHBOUR -10% and
 * Benevolent pays each +20%, so slot 4 is an argument about slots 3 and 5. Four
 * controls per row buried the neighbours below the fold; four controls in a
 * dialog leave the whole banner on one screen.
 *
 * A slot holds a resolved catalog row or nothing. There is no half-built emblem
 * in this state: the dialog holds that, and only a complete emblem comes back.
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
   * from a server that predates the field. See `buildCatalog`. */
  scoring: Scoring | undefined
  slots: number
  value: (Emblem | null)[]
  onChange: (next: (Emblem | null)[]) => void
}) {
  const catalog = useMemo(() => buildCatalog(emblems, scoring), [emblems, scoring])
  const [editing, setEditing] = useState<number | null>(null)

  const setSlot = (index: number, emblem: Emblem | null) => {
    const next = [...value]
    next[index] = emblem
    onChange(next)
    setEditing(null)
  }

  /** What the dialog opens on. A filled slot reopens on its own emblem; an empty
   * one opens on a colour, and slots start on different colours so a fresh
   * banner is not five copies of the same six stats. */
  const openingAxes = (index: number): Axes => {
    const current = value[index] ?? null
    if (current) return axesOf(current, catalog.colorOf)
    return {
      color: catalog.colors[index % Math.max(catalog.colors.length, 1)] ?? UNCLASSIFIED,
      stat: null,
      tier: null,
      trait: null,
    }
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {Array.from({ length: slots }, (_, i) => {
          const current = value[i] ?? null
          const color = current ? catalog.colorOf(current.stat) : null
          const style = color ? colorStyle(color) : null

          return (
            <li key={i} className="flex items-center gap-2">
              <span className="text-muted-foreground w-3 text-xs tabular-nums">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => setEditing(i)}
                // Declared once per row. The colour bar and the colour word are
                // both inside, so both resolve the same hue and cannot disagree.
                {...(style?.attrs ?? {})}
                className={cn(
                  "focus-visible:border-ring focus-visible:ring-ring/50 group relative flex min-h-14 flex-1 items-center gap-3 overflow-hidden rounded-xl border pr-3 text-left transition-colors focus-visible:ring-3",
                  current
                    ? "border-input bg-card hover:bg-accent/50"
                    : "border-input/70 text-muted-foreground hover:border-input hover:bg-accent/40 border-dashed",
                )}
              >
                {/* The colour, as a bar down the edge of the row rather than a
                    swatch to be looked up. The word is right beside it, so the
                    paint is confirmation and never the only signal. */}
                <span
                  aria-hidden
                  className={cn("h-full w-1.5 self-stretch", style?.bar ?? "bg-transparent")}
                />

                {current ? (
                  <>
                    <span className="min-w-0 flex-1 py-2">
                      <span className="block truncate text-sm font-medium">
                        {catalog.statLabels.get(current.stat) ?? current.stat}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-2xs tracking-wider uppercase">
                        <span className={cn("font-semibold", style?.tag)}>{color}</span>
                        <span className="text-muted-foreground/50" aria-hidden>
                          /
                        </span>
                        <span className="text-muted-foreground">
                          {traitLabel(current.trait)}
                        </span>
                      </span>
                    </span>

                    {/* The quality, stamped the way the client stamps it. */}
                    <span
                      aria-label={tierLabel(current.tier)}
                      className="bg-muted/60 text-foreground/80 grid size-8 shrink-0 place-items-center rounded-lg border text-xs font-semibold tabular-nums"
                    >
                      {tierNumeral(current.tier)}
                    </span>
                  </>
                ) : (
                  <span className="flex flex-1 items-center gap-2 py-3 pl-1 text-sm">
                    <Plus aria-hidden className="size-4 shrink-0" />
                    Choose an emblem
                  </span>
                )}
              </button>

              {current && !current.measurable && (
                <Tooltip>
                  {/* Base UI composes through `render`, not `asChild`. */}
                  <TooltipTrigger render={<Badge variant="outline">no data</Badge>} />
                  <TooltipContent>
                    The client marks this stat “no data” in its own emblem picker, and no
                    match-data source publishes it either. An emblem carrying it scores
                    nothing — not here, and not in the client. Reroll it.
                  </TooltipContent>
                </Tooltip>
              )}
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
          <Button variant="ghost" size="sm" onClick={() => onChange(Array(slots).fill(null))}>
            Clear
          </Button>
        )}
      </div>

      {editing !== null && (
        <EmblemDialog
          // Remounted per slot, so the dialog's draft starts from the slot being
          // edited rather than from whichever one was opened last.
          key={editing}
          slot={editing}
          initial={openingAxes(editing)}
          catalog={catalog}
          scoring={scoring}
          usedStats={
            new Set(
              value
                .filter((e, index): e is Emblem => e !== null && index !== editing)
                .map((e) => e.stat),
            )
          }
          onSave={(emblem) => setSlot(editing, emblem)}
          onRemove={() => setSlot(editing, null)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
