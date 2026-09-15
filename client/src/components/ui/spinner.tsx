import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * One spinner, used wherever the app is waiting.
 *
 * Written once because a busy state should look the same everywhere: three
 * hand-rolled spinners at three sizes read as three different kinds of waiting,
 * and only one of them is ever right.
 *
 * WHERE IT BELONGS, and the rule is narrow: a spinner goes inside something
 * that is acting -- a button mid-save, an overlay across an answer being
 * recomputed. Anywhere a region is filling for the first time, the placeholder
 * is a `SkeletonPanel` instead.
 *
 * The split is not taste. A spinner reserves no space, so a page waiting on its
 * only query shows one short grey line above an empty screen and then reflows
 * the entire layout in when the data lands. A skeleton reserves the shape, so
 * nothing jumps. The inverse holds where an answer is ALREADY drawn and being
 * replaced: swapping it for skeletons throws away the very layout the skeleton
 * exists to protect, so that case keeps the spinner, over the dimmed answer.
 *
 * Motion is confirmation here, never information: the label beside it says the
 * same thing, so a reader with `prefers-reduced-motion` (where the base layer
 * clamps every duration to near zero) loses nothing but the turning.
 */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 shrink-0 animate-spin", className)} aria-hidden />
}

/**
 * The spinner with its label, which is the form nearly every caller wants.
 *
 * `role="status"` and a polite live region: a screen reader is told once that
 * something is happening, and told what, rather than being handed a lone
 * unlabelled graphic.
 */
export function Loading({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn("text-muted-foreground flex items-center gap-2 text-xs", className)}
    >
      <Spinner className="size-3.5" />
      {children}
    </p>
  )
}
