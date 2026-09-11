import { colorStyle, tierLabel, tierNumeral, traitLabel, type EmblemCatalog } from "@/lib/emblem-catalog"
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
 * calling `colorStyle` rather than by repeating any of them: the stripe carries
 * the colour, the word "red" sits beside it in the same ink, and the tier is
 * stamped as its numeral. Colour is confirmation, never the only signal.
 */
export function EmblemCard({
  emblem,
  catalog,
  multiplier,
  className,
}: {
  emblem: Emblem
  catalog: EmblemCatalog
  /** What this emblem pays where it stands, if it is standing somewhere. A
   * banner's multipliers depend on neighbours, so an emblem on its own in an
   * inventory has no multiplier to show and this is omitted. */
  multiplier?: number
  className?: string
}) {
  const color = catalog.colorOf(emblem.stat)
  const style = colorStyle(color)

  return (
    <span
      // Declared once, here: the stripe and the colour word are both inside, so
      // they resolve the same hue and cannot disagree.
      {...style.attrs}
      className={cn(
        "bg-card flex min-h-11 items-center gap-2 overflow-hidden rounded-lg border pr-2 text-left",
        className,
      )}
    >
      <span aria-hidden className={cn("w-1 self-stretch", style.bar)} />

      <span className="min-w-0 flex-1 py-1.5">
        <span className="block truncate text-xs font-medium">
          {catalog.statLabels.get(emblem.stat) ?? emblem.stat}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-2xs tracking-wider uppercase">
          <span className={cn("font-semibold", style.tag)}>{color}</span>
          <span className="text-muted-foreground/50" aria-hidden>
            /
          </span>
          <span className="text-muted-foreground truncate">{traitLabel(emblem.trait)}</span>
        </span>
      </span>

      {multiplier !== undefined && (
        <span
          className="text-muted-foreground shrink-0 text-2xs tabular-nums"
          title="What this emblem pays here, after its neighbours"
        >
          {percent(multiplier)}
        </span>
      )}

      <span
        aria-label={tierLabel(emblem.tier)}
        className="bg-muted/60 text-foreground/80 grid size-6 shrink-0 place-items-center rounded-md border text-2xs font-semibold tabular-nums"
      >
        {tierNumeral(emblem.tier)}
      </span>
    </span>
  )
}
