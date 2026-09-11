import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * One spinner, used wherever the app is waiting.
 *
 * Written once because a busy state should look the same everywhere: three
 * hand-rolled spinners at three sizes read as three different kinds of waiting,
 * and only one of them is ever right.
 *
 * Skeletons stay where they are. The two say different things and both are
 * needed: a skeleton reserves the SHAPE of an answer that has never been on
 * screen, so nothing jumps when it arrives; the spinner says work is happening
 * NOW. Where an answer is already drawn and being replaced, the spinner is the
 * whole story and a skeleton would throw away the layout it was protecting.
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
