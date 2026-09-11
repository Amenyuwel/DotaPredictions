import { EmblemMeta } from "@/components/emblem-meta"
import { TierPicker } from "@/components/tier-picker"
import {
  colorStyle,
  TIER_CHIP,
  tierLabel,
  tierNumeral,
  type EmblemCatalog,
} from "@/lib/emblem-catalog"
import { percent } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Emblem } from "@/types/run"

/**
 * One emblem, drawn as a record of a choice already made.
 *
 * This is NOT the banner builder's row, which looks similar and is a different
 * thing: that row is a control with an empty state, a "no data" badge and a
 * dialog behind it, and half its markup exists for the emblem that is not there
 * yet. Here the emblem always exists. The inventory shows twelve of these at
 * once and a result row shows five side by side, so the shape is compact by
 * requirement rather than by taste.
 *
 * What it does share with that row is the palette rules, and it shares them by
 * calling `colorStyle` rather than by repeating any of them: the swatch carries
 * the colour's weave, the word "red" sits beside it in the same ink, and the
 * tier is stamped as its numeral. Colour is confirmation, never the only
 * signal -- the pattern says which of the three this is before the hue does.
 */
export function EmblemCard({
  emblem,
  catalog,
  multiplier,
  onTierChange,
  className,
}: {
  emblem: Emblem
  catalog: EmblemCatalog
  /** What this emblem pays where it stands, if it is standing somewhere. A
   * banner's multipliers depend on neighbours, so an emblem on its own in an
   * inventory has no multiplier to show and this is omitted. */
  multiplier?: number
  /** Given only where the tier is an INPUT rather than a result: the custom
   * goal, where the reader is saying which emblems they actually have. The
   * stamp then becomes the control, in place, because it is the same fact
   * being set instead of read. */
  onTierChange?: (tier: string) => void
  className?: string
}) {
  const color = catalog.colorOf(emblem.stat)
  const style = colorStyle(color)

  return (
    <span
      // Declared once, here: the swatch and the colour word are both inside, so
      // they resolve the same hue and cannot disagree.
      {...style.attrs}
      className={cn(
        "bg-card flex min-h-11 items-center gap-2 overflow-hidden rounded-lg border px-2 text-left",
        className,
      )}
    >
      {/* The weave, not a painted edge. See `swatch` in emblem-catalog. Square
          and the same size as the tier stamp at the other end of the row, so
          the two bookends are peers rather than two different ideas. */}
      <span
        aria-hidden
        // The attribute rides along here as well as on the card: the weave's
        // tones are overridden on whichever element declares them, so this is
        // the element that has to declare them. Both come from one
        // `colorStyle` call, so the two cannot name different colours.
        {...style.attrs}
        className={cn("size-6 shrink-0 rounded-md", style.swatch)}
      />

      <span className="min-w-0 flex-1 py-1.5">
        <span className="block truncate text-xs font-medium">
          {catalog.statLabels.get(emblem.stat) ?? emblem.stat}
        </span>
        <EmblemMeta color={color} trait={emblem.trait} />
      </span>

      {multiplier !== undefined && (
        <span
          className="text-muted-foreground shrink-0 text-2xs tabular-nums"
          title="What this emblem pays here, after its neighbours"
        >
          {percent(multiplier)}
        </span>
      )}

      {onTierChange ? (
        <TierPicker
          value={emblem.tier}
          tiers={catalog.tiers}
          onChange={onTierChange}
          label={catalog.statLabels.get(emblem.stat) ?? emblem.stat}
        />
      ) : (
        <span aria-label={tierLabel(emblem.tier)} className={TIER_CHIP}>
          {tierNumeral(emblem.tier)}
        </span>
      )}
    </span>
  )
}
