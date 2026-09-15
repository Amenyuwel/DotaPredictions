import { ArrowUpRight } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * What the bar says, or null when there is no answer yet.
 *
 * `value` is the one number the answer leads with, when the answer IS one
 * number. The banner tab's three rankings are not one number, so it stays
 * undefined there rather than being invented -- a headline figure on the bar
 * that is not in the panel behind it is a second number to reconcile.
 */
export type AnswerSummary = { title: string; value?: string }

/**
 * The answer, on a screen with no room to put it beside the questions.
 *
 * Above 1024px the answer is the right-hand column and is never further than a
 * glance. Below it there is one column, and the three input cards plus the
 * saved list put anything underneath them a full screen past the fold -- so a
 * reader who has just picked their third player sees nothing happen.
 *
 * Pinned to the bottom rather than laid out down there, and it opens the answer
 * over the page rather than scrolling to it: a phone can show the questions or
 * the answer, not both, so moving between them is a change of view. A scroll
 * pretends otherwise and leaves the reader to find their own way back to the
 * picker they were about to change.
 *
 * Always drawn, in both of its states. Only appearing once there is a number
 * would mean the narrow layout says nothing at all about what the page is for
 * until after the reader has worked it out, and a control that materialises
 * under a thumb already on its way down is worse than one that was always
 * there.
 *
 * Sticky rather than fixed: at the end of the scroll it settles into the flow
 * above the footer instead of covering the run's date, which is the one line on
 * the page that says the numbers are not stale.
 */
export function AnswerBar({
  summary,
  hint,
  onOpen,
}: {
  summary: AnswerSummary | null
  /** What to do to get an answer, shown in place of one. One line: the full
   * version of this is in the panel the button opens. */
  hint: string
  onOpen: () => void
}) {
  return (
    // Opaque, not translucent: the answer's own cards scroll under this and a
    // number showing through the bar that reports it is the one confusion this
    // whole control exists to prevent.
    <div className="bg-background sticky bottom-0 z-40 border-t">
      <div
        className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:px-6"
        aria-live="polite"
      >
        {summary ? (
          <>
            <div className="min-w-0">
              <p className="text-muted-foreground truncate text-xs">{summary.title}</p>
              {summary.value && (
                <p className="text-base font-semibold tabular-nums">{summary.value}</p>
              )}
            </div>
            <Button size="sm" className="ml-auto shrink-0" onClick={onOpen}>
              See the answer
              <ArrowUpRight aria-hidden />
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">{hint}</p>
        )}
      </div>
    </div>
  )
}
