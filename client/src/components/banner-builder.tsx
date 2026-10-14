import { useMemo, useState } from "react"
import { Plus, Undo2, X } from "lucide-react"

import { EmblemDialog } from "@/components/emblem-dialog"
import { EmblemMeta } from "@/components/emblem-meta"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  // The banner as it was before the last removal, and what to call it. One
  // press empties a slot (or all of them), so one press puts it back: undo
  // rather than a confirmation, because clearing is safe to reverse and a
  // "are you sure?" on every X is a tax on the reader who meant it.
  const [undo, setUndo] = useState<{ before: (Emblem | null)[]; label: string } | null>(
    null,
  )

  const setSlot = (index: number, emblem: Emblem | null) => {
    const next = [...value]
    next[index] = emblem
    onChange(next)
    setEditing(null)
    setUndo(null)
  }

  const remove = (next: (Emblem | null)[], label: string) => {
    setUndo({ before: value, label })
    onChange(next)
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
              {/* The remove control sits INSIDE the row's outline but is not
                  inside its button: a sibling laid over the right edge, with
                  the button padded clear of it so their hit areas never
                  overlap. Beside the row it made every filled slot narrower
                  than the empty ones, so the right edge of the banner jumped
                  each time an emblem was placed. */}
              <div className="relative flex min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setEditing(i)}
                // Declared once per row. The colour swatch and the colour word
                // are both inside, so both resolve the same hue and cannot
                // disagree.
                {...(style?.attrs ?? {})}
                className={cn(
                  "focus-visible:border-ring focus-visible:ring-ring/50 group relative flex min-h-14 flex-1 items-center gap-3 overflow-hidden rounded-xl border px-3 text-left transition-[color,background-color,border-color,transform] focus-visible:ring-3 active:translate-y-px",
                  current
                    ? "border-input bg-card hover:bg-accent/50 pr-12 pointer-coarse:pr-14"
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
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">
                          {catalog.statLabels.get(current.stat) ?? current.stat}
                        </span>
                        {/* Inside the row, beside the stat it describes. The
                            full sentence -- scored 0 here, still pays in the
                            client -- is in the answer's Limits, which is where
                            it qualifies a number. */}
                        {!current.measurable && (
                          <Badge variant="outline" title="No data: scored 0 here">
                            no data
                          </Badge>
                        )}
                      </span>
                      <EmblemMeta color={color!} trait={current.trait} />
                    </span>

                    {/* The quality, stamped the way the client stamps it. A bare
                        numeral, not a bordered square: boxed, it was the same
                        shape as the clear button beside the row and read as a
                        second control that did nothing. */}
                    <span
                      aria-label={tierLabel(current.tier)}
                      className="font-heading text-foreground/80 w-8 shrink-0 text-center text-sm font-semibold tabular-nums"
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

              {current && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  // Quiet at rest and on hover: removing is undoable, so it is
                  // not an alarm and does not wear the alarm colour.
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                  aria-label={`Remove emblem ${i + 1}, ${current.displayName}`}
                  onClick={() => {
                    const next = [...value]
                    next[i] = null
                    remove(
                      next,
                      `${catalog.statLabels.get(current.stat) ?? current.stat} removed`,
                    )
                  }}
                >
                  <X aria-hidden />
                </Button>
              )}
              </div>
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
      {/* One line under the banner: what was just removed, with its undo, on
          the left; clearing everything on the right. Indented to the rows so
          it reads as part of the banner rather than as the dialog's footer.
          Reserved height, so the undo appearing does not move the footer. */}
      <div className="flex min-h-8 items-center gap-2 pl-5">
        <p aria-live="polite" className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          {undo?.label}
        </p>
        {undo && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(undo.before)
              setUndo(null)
            }}
          >
            <Undo2 aria-hidden />
            Undo
          </Button>
        )}
        {value.some(Boolean) && !undo && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => remove(Array(slots).fill(null), "Banner cleared")}
          >
            Clear all
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
