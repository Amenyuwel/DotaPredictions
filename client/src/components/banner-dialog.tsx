import { BannerBuilder } from "@/components/banner-builder"
import { EmblemSetDialog } from "@/components/emblem-set-dialog"
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
