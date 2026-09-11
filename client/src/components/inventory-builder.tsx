import { useMemo, useState } from "react"
import { Plus } from "lucide-react"

import { EmblemCard } from "@/components/emblem-card"
import { EmblemDialog } from "@/components/emblem-dialog"
import { Button } from "@/components/ui/button"
import { axesOf, buildCatalog, type Axes } from "@/lib/emblem-catalog"
import type { Emblem, Scoring } from "@/types/run"

/**
 * The emblems you are putting on this unit, which is the search space.
 *
 * Unordered, unlike the banner builder: the order is the answer rather than the
 * question, and what the arrangement alone is worth comes back measured. The
 * SIZE is the banner's -- three in a group stage, five in a main event -- so
 * exactly one banner's worth of emblems goes in and which way round to wear
 * them comes out.
 *
 * The cap is `slots`, read off the run rather than typed in here, for the same
 * reason the banner builder reads it: a period with a different banner size
 * must work without a client release. The server's `maxInventory` is a looser
 * latency bound behind it and never binds first.
 *
 * Two rules bite at this size, and both would otherwise leave the search with
 * no legal arrangement and nothing to report:
 *
 *  - **No stat twice.** A stat entered twice cannot be placed twice, so a stat
 *    already entered is unselectable, exactly as it is on a banner.
 *  - **The colours have to match the slots.** The colour of each banner slot is
 *    fixed by role -- Core is red-green-red-green-red -- so a Core inventory is
 *    three reds and two greens, not any five emblems. A colour that has met its
 *    quota is closed, and the line underneath says what is still wanted, because
 *    "5 of 5" with the wrong colours is the one full inventory that cannot be
 *    worn.
 */
export function InventoryBuilder({
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
  /** Emblems on a banner in this stage, and so how many may be entered. */
  slots: number
  /** The colour of each slot, in banner order. Fixed by role; it is what makes
   * this a quota per colour rather than a count. Empty for a run published
   * before the rule was on the wire, and then only the stat rule applies. */
  slotColors: string[]
  value: Emblem[]
  onChange: (next: Emblem[]) => void
}) {
  const catalog = useMemo(() => buildCatalog(emblems, scoring), [emblems, scoring])
  /** The index being edited, or `value.length` for one being added. */
  const [editing, setEditing] = useState<number | null>(null)

  const save = (index: number, emblem: Emblem) => {
    const next = [...value]
    next[index] = emblem
    onChange(next)
    setEditing(null)
  }

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
    setEditing(null)
  }

  const opening = (index: number): Axes =>
    value[index]
      ? axesOf(value[index], catalog.colorOf)
      : { color: null, stat: null, tier: null, trait: null }

  const short = slots - value.length

  // How many of each colour the banner wants, less what is already entered.
  // Empty when the run publishes no row, and then nothing here is closed.
  const wanted = new Map<string, number>()
  for (const color of slotColors) wanted.set(color, (wanted.get(color) ?? 0) + 1)
  for (const emblem of value) {
    const color = catalog.colorOf(emblem.stat)
    if (wanted.has(color)) wanted.set(color, wanted.get(color)! - 1)
  }
  const missing = [...wanted.entries()].filter(([, n]) => n > 0)
  // A colour is closed once its slots are spoken for. Entering a sixth red for a
  // Core banner is not a choice between reds -- there is no third red slot to
  // put it in.
  const fullColors = new Set(
    [...wanted.entries()].filter(([, n]) => n <= 0).map(([color]) => color),
  )

  return (
    <div className="space-y-3">
      {/* A grid of controls rather than a list of them. The emblems have no
          order here -- that is the answer, not the input -- so numbering them
          or marking them up as a sequence would assert something false. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {value.map((emblem, i) => (
          <button
            key={emblem.emblemId}
            type="button"
            onClick={() => setEditing(i)}
            className="focus-visible:border-ring focus-visible:ring-ring/50 hover:bg-accent/40 rounded-lg text-left transition-colors focus-visible:ring-3"
          >
            <EmblemCard emblem={emblem} catalog={catalog} className="bg-transparent" />
            <span className="sr-only">Edit or remove {emblem.displayName}</span>
          </button>
        ))}

        {value.length < slots && (
          <Button
            variant="outline"
            onClick={() => setEditing(value.length)}
            className="border-input/70 text-muted-foreground hover:border-input min-h-11 justify-start border-dashed"
          >
            <Plus aria-hidden />
            Add an emblem
          </Button>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {missing.length > 0
            ? `Still wanted: ${missing.map(([color, n]) => `${n} ${color}`).join(", ")}. ` +
              `A ${slotColors.length > 0 ? slotColors.join("-") : "banner"} is the shape of this slot's banner, so the colours are not a choice.`
            : short > 0
              ? `A banner in this stage is ${slots} emblems. ${short} more before there is anything to arrange.`
              : `${slots} of ${slots}, in the right colours. Remove one to put a different emblem in its place.`}
        </p>
        {value.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange([])}
          >
            Clear
          </Button>
        )}
      </div>

      {editing !== null && (
        <EmblemDialog
          // Remounted per slot, so the dialog's draft starts from the emblem
          // being edited rather than from whichever one was opened last.
          key={editing}
          slot={editing}
          initial={opening(editing)}
          catalog={catalog}
          scoring={scoring}
          // A stat already entered is unavailable, as on a banner -- see above:
          // at one banner's worth of emblems a repeat leaves nothing to place.
          usedStats={
            new Set([
              ...value.filter((_, i) => i !== editing).map((e) => e.stat),
              // Every stat of a colour whose slots are already spoken for. Said
              // as unavailable stats rather than as an unavailable colour so the
              // reason is visible in the list the reader is actually looking at.
              ...[...fullColors].flatMap((color) =>
                editing < value.length && catalog.colorOf(value[editing]!.stat) === color
                  ? []
                  : (catalog.statsByColor.get(color) ?? []).map((o) => o.stat),
              ),
            ])
          }
          onSave={(emblem) => save(editing, emblem)}
          onRemove={() => remove(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
