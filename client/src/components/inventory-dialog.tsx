import { EmblemSetDialog } from "@/components/emblem-set-dialog"
import { InventoryBuilder } from "@/components/inventory-builder"
import type { Emblem, Scoring } from "@/types/run"

/**
 * The emblems already rolled for one roster slot, folded away behind a count.
 *
 * The banner's sibling. Both hold a banner's worth of emblems and both fold
 * into `EmblemSetDialog`; what is different is that this set has no order --
 * the order is the answer here, not the question -- so the count is a plain
 * list length and the builder inside numbers nothing.
 */
export function InventoryDialog({
  role,
  emblems,
  scoring,
  slots,
  slotColors,
  value,
  onChange,
}: {
  /** The slot this inventory belongs to, named as the reader sees it --
   * "Core", "Mid", "Support" -- so the title says which of the three identical
   * cards was opened. */
  role: string
  emblems: Emblem[]
  /** Undefined only when the browser is replaying a cached `/api/run/current`
   * from a server that predates the field. See `buildCatalog`. */
  scoring: Scoring | undefined
  /** Emblems on a banner in this stage, and so how many may be entered. */
  slots: number
  /** The colour of each slot, in banner order. Fixed by role. */
  slotColors: string[]
  value: Emblem[]
  onChange: (next: Emblem[]) => void
}) {
  const short = slots - value.length

  return (
    <EmblemSetDialog
      empty={value.length === 0}
      // The shortfall is the whole point of showing a number out here, so it is
      // said in the words the slot's own answer panel uses. A full inventory
      // says it is full rather than saying nothing, because the absence of a
      // warning is not a confirmation.
      summary={
        value.length === 0
          ? `Add ${slots} emblems`
          : short > 0
            ? `${value.length} of ${slots} emblems · ${short} more`
            : `${slots} of ${slots} emblems`
      }
      title={`${role} inventory`}
      description={
        <>
          The emblems you rolled for this slot. A {role} banner is{" "}
          {slotColors.join("-")} - the colour of each slot is fixed by the role - so this
          is {slots} emblems in those colours, and the answer is which way round to wear
          them.
        </>
      }
    >
      <InventoryBuilder
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
