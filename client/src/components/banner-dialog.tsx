import { BannerBuilder } from "@/components/banner-builder"
import { EmblemSetDialog } from "@/components/emblem-set-dialog"
import { colorStyle } from "@/lib/emblem-catalog"
import { cn } from "@/lib/utils"
import type { Emblem, Scoring } from "@/types/run"

/**
 * The banner for one slot, folded away behind its count.
 *
 * The inventory's sibling, and the difference is the whole reason both exist:
 * this one is ORDERED and exactly `slots` long. Vampiric takes 10% from each
 * neighbour and Benevolent pays each 20%, so position is an input here and the
 * slots stay numbered inside. An inventory has no order to show.
 *
 * That is also why the trigger counts differently. A banner slot can be empty
 * with a filled slot after it -- the builder holds nulls in place rather than
 * closing the gap -- so the summary counts what is PLACED out of `slots`, not
 * the length of a list.
 */
export function BannerDialog({
  role,
  emblems,
  scoring,
  slots,
  slotColors,
  value,
  onChange,
}: {
  /** The slot this banner is for, named as the reader sees it -- "Core",
   * "Mid", "Support" -- so the title says which of the three identical cards
   * was opened. */
  role: string
  emblems: Emblem[]
  /** Undefined only when the browser is replaying a cached `/api/run/current`
   * from a server that predates the field. See `buildCatalog`. */
  scoring: Scoring | undefined
  slots: number
  /** The colour of each slot, in banner order. Fixed by role. */
  slotColors: string[]
  value: (Emblem | null)[]
  onChange: (next: (Emblem | null)[]) => void
}) {
  const placed = value.filter((e) => e !== null).length
  const short = slots - placed

  return (
    <EmblemSetDialog
      empty={placed === 0}
      // Said in the words the slot's own answer panel uses. A full banner says
      // it is full rather than saying nothing, because the absence of a warning
      // is not a confirmation.
      summary={
        placed === 0
          ? `Build a ${slots}-emblem banner`
          : short > 0
            ? `${placed} of ${slots} placed · ${short} more`
            : `${slots} of ${slots} placed`
      }
      title={`${role} banner`}
      // The banner itself, small, beside its count. Folded down to "5 of 5
      // placed", the one object the reader built was invisible next to the
      // ranking it produced, and checking what a slot was wearing meant
      // opening it. One weave per slot in banner order, the slot's own colour
      // because that is fixed by role, dashed where nothing is placed yet --
      // the same two states the builder draws inside.
      preview={
        placed > 0 &&
        value.map((emblem, i) => {
          const style = slotColors[i] ? colorStyle(slotColors[i]) : null
          return (
            <span
              key={i}
              aria-hidden
              {...(emblem && style ? style.attrs : {})}
              className={cn(
                "size-6 rounded-md",
                emblem && style ? style.swatch : "border-input border border-dashed",
              )}
            />
          )
        })
      }
    >
      <BannerBuilder
        emblems={emblems}
        scoring={scoring}
        slots={slots}
        slotColors={slotColors}
        value={value}
        onChange={onChange}
      />
    </EmblemSetDialog>
  )
}
