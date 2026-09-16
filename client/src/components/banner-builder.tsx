import { useMemo, useState } from "react"
import { Plus, X } from "lucide-react"

import { EmblemDialog } from "@/components/emblem-dialog"
import { EmblemMeta } from "@/components/emblem-meta"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  axesOf,
  buildCatalog,
  colorStyle,
  tierLabel,
  tierNumeral,
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
  slotColors,
  value,
  onChange,
}: {
  emblems: Emblem[]
  /** Undefined only when the browser is replaying a cached `/api/run/current`
   * from a server that predates the field. See `buildCatalog`. */
  scoring: Scoring | undefined
  slots: number
  /**
   * The colour of each slot, in banner order.
   *
   * Not a hint: it is the rule. A Core banner is red-green-red-green-red and a
   * Support banner has no red slot at all, so slot 2 offers six stats rather
   * than eighteen. Empty only for a run published before the rule was on the
   * wire, and then every colour is offered -- the old behaviour, which is how
   * a red stat reached a Support banner in the first place.
   */
  slotColors: string[]
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
   * one opens on nothing at all.
   *
   * Empty slots used to open on a colour, rotated by index so a fresh banner
   * was not five copies of the same six stats. That is a real problem but this
   * was the wrong answer to it: a slot that opens on red and is saved on red
   * looks the same afterwards whether the user picked red or never touched the
   * field, and a banner nobody actually chose still produces a confident
   * projection. Let the choice be visibly absent instead. */
  const openingAxes = (index: number): Axes => {
    const current = value[index] ?? null
    if (current) return axesOf(current, catalog.colorOf)
    // The slot's own colour, which is not a default the user has to confirm --
    // it is the only colour this slot can hold.
    return { color: slotColors[index] ?? null, stat: null, tier: null, trait: null }
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {Array.from({ length: slots }, (_, i) => {
          const current = value[i] ?? null
          // An EMPTY slot still has a colour, so it is painted with it. The row
          // then says what belongs there before anything is chosen, rather than
          // looking like a blank that could take anything.
          const color = current ? catalog.colorOf(current.stat) : (slotColors[i] ?? null)
          const style = color ? colorStyle(color) : null

          return (
            <li key={i} className="flex items-center gap-2">
              <span className="text-muted-foreground w-3 text-xs tabular-nums">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => setEditing(i)}
                // Declared once per row. The colour swatch and the colour word
                // are both inside, so both resolve the same hue and cannot
                // disagree.
                {...(style?.attrs ?? {})}
                className={cn(
                  "focus-visible:border-ring focus-visible:ring-ring/50 group relative flex min-h-14 flex-1 items-center gap-3 overflow-hidden rounded-xl border px-3 text-left transition-colors focus-visible:ring-3",
                  current
                    ? "border-input bg-card hover:bg-accent/50"
                    : "border-input/70 text-muted-foreground hover:border-input hover:bg-accent/40 border-dashed",
                )}
              >
                {/* The colour as a sample of its weave -- checkered, striped or
                    latticed -- so the three are told apart by pattern before
                    hue. The word is right beside it either way, so the paint is
                    confirmation and never the only signal. An empty slot keeps
                    the box and drops the weave, rather than letting the row
                    resize when an emblem arrives. */}
                <span
                  aria-hidden
                  // See `SAMPLE`: the weave's tones are overridden on the
                  // element that declares them, so the attribute rides here too.
                  {...(style?.attrs ?? {})}
                  className={cn(
                    "size-6 shrink-0 rounded-md",
                    style ? style.swatch : "border-input/70 border border-dashed",
                  )}
                />

                {current ? (
                  <>
                    <span className="min-w-0 flex-1 py-2">
                      <span className="block truncate text-sm font-medium">
                        {catalog.statLabels.get(current.stat) ?? current.stat}
                      </span>
                      <EmblemMeta color={color!} trait={current.trait} />
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
                    {color ? `Choose a ${color} emblem` : "Choose an emblem"}
                  </span>
                )}
              </button>

              {/* One press to empty a filled slot, beside the row rather than
                  inside it: nested, its hit area would sit on top of the one
                  that opens the emblem, and the two would be a slot emptied by
                  a thumb aiming to change it. `Remove` inside the dialog stays
                  -- that is the take-back for a reader who has already opened
                  the slot -- but reaching it meant opening a four-field form to
                  undo a mis-tap. */}
              {current && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label={`Clear emblem ${i + 1}, ${current.displayName}`}
                  onClick={() => setSlot(i, null)}
                >
                  <X aria-hidden />
                </Button>
              )}

              {current && !current.measurable && (
                <Tooltip>
                  {/* Base UI composes through `render`, not `asChild`. */}
                  <TooltipTrigger render={<Badge variant="outline">no data</Badge>} />
                  <TooltipContent>
                    {/* This used to say the emblem scores nothing and to reroll it.
                        That was false and it was advice: the client's own scoring
                        list pays Lotuses Grabbed 176 per lotus. What is true is
                        narrower and less useful, which is why it has to be said
                        plainly rather than rounded up into a recommendation. */}
                    No match-data source publishes {current.stat}, so this tool scores it
                    as 0 and every banner carrying it is understated. It still pays in
                    the client - the number here is a floor, not a verdict on the emblem.
                  </TooltipContent>
                </Tooltip>
              )}
            </li>
          )
        })}
      </ol>

      {/* No note under the list. What it said -- 1 to N is top to bottom, and
          what Vampiric and Benevolent do to their neighbours -- is the dialog's
          own description, three inches above it in the same box; the rest, that
          a slot's colour is fixed by the role, is said by the emblem dialog at
          the moment it offers six stats instead of eighteen. Both were already
          where a reader can act on them, and a second copy is the one they
          compare against the first. */}
      {value.some(Boolean) && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onChange(Array(slots).fill(null))}>
            Clear
          </Button>
        </div>
      )}

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
          // The slot decides the colour, so the dialog shows it rather than
          // asking. Only its six stats are then on offer.
          lockedColor={slotColors[editing] ?? null}
          onSave={(emblem) => setSlot(editing, emblem)}
          onRemove={() => setSlot(editing, null)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
