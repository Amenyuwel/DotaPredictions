import { traitLabel } from "@/lib/emblem-catalog"
import { cn } from "@/lib/utils"

/**
 * The second line of any emblem row: the trait, and nothing else.
 *
 * The colour word used to sit beside it, and the joining mark between the two
 * was the problem that would not go away -- a slash read as a fraction, a
 * middot read as boilerplate, a plain gap read as one phrase. None of that was
 * the real fault. The row already says its colour three times: the swatch is
 * woven in that colour's pattern, the row is painted in its tones, and an empty
 * slot says "Choose a red emblem" in words. A fourth statement had no job left,
 * so nothing had to be designed to separate it from the trait.
 *
 * It stays in the accessible name, because the weave and the paint are the two
 * channels that do not survive a screen reader, and the colour of a slot is a
 * rule about what may go in it rather than decoration.
 *
 * The two rows that draw this line -- the builder's control and the card that
 * reports a finished emblem -- are separate components on purpose, because one
 * has an empty state and a dialog behind it and the other never does. How an
 * emblem's trait is written is not part of that difference, and written twice
 * it drifts the moment one of the two is edited.
 */
export function EmblemMeta({
  color,
  trait,
  className,
}: {
  /** Not rendered, only announced. See above. */
  color: string
  trait: string
  className?: string
}) {
  return (
    <span className={cn("text-muted-foreground mt-0.5 block truncate text-2xs", className)}>
      <span className="sr-only">{color}, </span>
      {traitLabel(trait)}
    </span>
  )
}
