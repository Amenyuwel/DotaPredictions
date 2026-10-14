import { useState, type ReactNode } from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { points } from "@/lib/format"
import { ROLE_LABEL, ROLE_ORDER } from "@/lib/labels"
import type { FantasyRole } from "@/types/run"

/**
 * The three slots as a tab strip rather than as a column of three answers.
 *
 * Each answer is a banner card, a second one to compare it against, what the
 * order is worth, the tournament context and the caveats -- so stacked, the
 * support answer started two screens below the core one. A reader checking
 * "what am I aiming for" had to scroll past two full answers to reach the
 * third and hold the first in their head to compare them.
 *
 * The number that makes the comparison is lifted onto the tab, so switching is
 * for the emblems rather than for the score. It is the same point estimate the
 * panel below leads with, read from the same answer -- not a second computation
 * that could disagree with it. What qualifies it (the tie, the interval, the
 * caveats) does NOT come up here: it travels with the number in the panel,
 * where there is room to state it, and a tab strip is too small a place to
 * qualify anything.
 *
 * Both tabs of the app use this, so core, mid and support are in one order and
 * one place on either side.
 */
export function RoleTabs({
  render,
  scoreFor,
}: {
  render: (role: FantasyRole) => ReactNode
  /** The slot's headline score, or null while it has none. Omit entirely for a
   * panel whose answer is not one number per slot. */
  scoreFor?: (role: FantasyRole) => number | null
}) {
  const [role, setRole] = useState<string>(ROLE_ORDER[0])

  return (
    <Tabs value={role} onValueChange={(next) => setRole(next as string)} className="gap-4">
      {/* The height override has to carry the primitive's own variant prefix.
          `TabsList` sets its 32px through `group-data-horizontal/tabs:h-8`,
          which compiles to a descendant selector and therefore outranks a bare
          `h-auto` -- and tailwind-merge, seeing two different keys, keeps both.
          The strip stayed locked at 32px, so every bit of padding added below
          was taken back out of the pill: the tabs read as cramped precisely
          because they had been given more room. Prefixed, the two collapse to
          one declaration and the strip grows to whatever the tabs need.

          A one-line strip is not what this is. The tabs carry a label over a
          score, and the score line is drawn even when there is no number, so
          the height is a property of the content rather than a constant. */}
      <TabsList className="w-full p-1.5 group-data-horizontal/tabs:h-auto">
        {ROLE_ORDER.map((r) => (
          <TabsTrigger key={r} value={r} className="h-auto flex-1 flex-col gap-0 px-3 py-2 pointer-coarse:min-h-11">
            {ROLE_LABEL[r]}
            {/* Drawn whether or not there is a number, because a line that
                appears when an answer arrives makes the strip taller than it
                was while the reader was looking at it. */}
            {scoreFor && (
              <span className="text-2xs text-muted-foreground font-normal tabular-nums">
                {scoreFor(r) === null ? " - " : points(scoreFor(r)!)}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>

      {ROLE_ORDER.map((r) => (
        <TabsContent key={r} value={r}>
          {render(r)}
        </TabsContent>
      ))}
    </Tabs>
  )
}
