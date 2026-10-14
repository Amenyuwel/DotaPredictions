import { ArrowRight } from "lucide-react"

import { SlotTargetCard } from "@/components/slot-target-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { EmblemCatalog } from "@/lib/emblem-catalog"
import { points } from "@/lib/format"
import { ROLE_ORDER } from "@/lib/labels"
import { rosterTotal, type BannerQuery, type Roster } from "@/lib/roster"
import type { FantasyRole, Stage } from "@/types/run"

/**
 * The roster's three answers as three cards, with their total on top once all
 * three have one.
 *
 * The total is a plain sum of each slot's best score, not a re-optimisation
 * across them -- `enumerate_fantasy_rosters` in the engine treats the three
 * slots the same way, because the client scores core, mid and support as
 * separate averages and adds them. No interval is shown on the total: summing
 * the three point estimates is exact, but summing their confidence intervals
 * would overstate the combined uncertainty, and understating it is worse than
 * leaving it off.
 *
 * What it sums is the REALISTIC rung of each slot, not the ceiling. Quality
 * cannot be rerolled -- the client rolls stats and traits and nothing else --
 * so a total built from five Tier V emblems per slot is a number no run of luck
 * can be planned towards. It is still one tab along on every card, because the
 * ceiling is what a real goal is measured against.
 *
 * Rendered in three places -- the wide layout's column, the narrow layout's
 * dialog, and the dialog a saved row opens -- from one definition. The saved
 * row asks the same question about a roster nobody has put in the pickers, and
 * a second answer written for it would be a second arithmetic to keep in step.
 */
export function RosterAnswer({
  roster,
  targets,
  run,
  slots,
  catalog,
  onAskBanner,
}: {
  roster: Roster
  targets: Record<FantasyRole, BannerQuery>
  run: { tournamentId: string; stage: Stage } | undefined
  slots: number
  catalog: EmblemCatalog
  /** Switches to the banner tab. Only the live page has one to switch to; the
   * saved-roster dialog never shows the empty state, so it passes nothing. */
  onAskBanner?: () => void
}) {
  const total = rosterTotal(targets)

  // Before the first player is picked the three slots have nothing to say
  // apart from each other, and saying it three times fills the whole answer
  // column with a paragraph repeated with one word changed. One sentence until
  // there is something to be specific about.
  if (ROLE_ORDER.every((r) => roster[r] === null)) {
    return <Orientation slots={slots} onAskBanner={onAskBanner} />
  }

  return (
    <div className="space-y-4">
      {total !== null && (
        // Compendium gold, the answer's colour, and the only gold on this tab:
        // the total is the output; the slot cards under it are its parts.
        // Fill, no outline -- the fill is the signal.
        <Card size="sm" data-answer className="ring-0">
          <CardContent className="flex flex-col gap-1">
            <p className="font-heading text-sm font-medium">Projected roster total</p>
            <p className="mt-1 text-4xl leading-none font-semibold tracking-tight tabular-nums">
              {points(total)}
            </p>
            {/* Where every other figure prints its interval, this one says why
                it has none -- in the same caption slot, so the gap reads as a
                stated limit rather than a missing line. The paragraph that used
                to sit here (realistic rung, no quality rerolls, no trade-off
                between slots) is the FAQ's "How is the roster total worked
                out?", a tap away instead of 70 words under the number. */}
            <p className="text-muted-foreground text-xs text-pretty">
              Realistic targets, added up. Each slot shows its own range.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Three cards rather than three stacked answers, and rather than one
          answer behind a tab: the three numbers the ceiling is the sum of are
          then on the page together, which is the comparison a reader came for.
          The emblems are what they act on one slot at a time, so those open. */}
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-3">
        {ROLE_ORDER.map((slotRole) => (
          <SlotTargetCard
            key={slotRole}
            role={slotRole}
            player={roster[slotRole]}
            run={run}
            target={targets[slotRole]}
            catalog={catalog}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * The answer column before anything is picked, for a reader who arrived cold.
 *
 * This is the first thing a stranger from a Reddit link sees beside the
 * pickers, and it used to be one dashed box repeating the instruction the
 * pickers already gave. It now says what the tool answers, how to read the
 * number it will print, and where the other question lives -- the three things
 * the first answer assumes. No sample figure: an illustrative number on this
 * page is indistinguishable from a real one, which is the one thing the tool
 * promises never to print.
 */
function Orientation({ slots, onAskBanner }: { slots: number; onAskBanner?: () => void }) {
  return (
    <section
      aria-labelledby="orientation-heading"
      className="ring-foreground/10 space-y-5 rounded-xl p-5 ring-1 sm:p-6"
    >
      <div className="space-y-2">
        <h3
          id="orientation-heading"
          className="font-heading text-lg leading-snug font-medium text-balance"
        >
          Which banner should each of your fantasy slots roll for?
        </h3>
        <p className="text-muted-foreground max-w-[30rem] text-sm text-pretty">
          Pick a core, a mid and a support. Each gets the {slots}-emblem banner worth most
          to it, from recent pro games and how far its team should go.
        </p>
      </div>

      {/* Two terms, not three: the run date is already on every screen. */}
      <dl className="grid max-w-[30rem] gap-3 text-sm sm:grid-cols-2 sm:gap-4">
        <div>
          <dt className="font-medium">The figure</dt>
          <dd className="text-muted-foreground">Expected best series.</dd>
        </div>
        <div>
          <dt className="font-medium">The range</dt>
          <dd className="text-muted-foreground">90% likely. Overlapping ranges are tied.</dd>
        </div>
      </dl>

      {onAskBanner && (
        <div className="border-t pt-4">
          <p className="text-muted-foreground text-sm">Already rolled a banner?</p>
          <Button variant="outline" className="mt-2" onClick={onAskBanner}>
            Rank who should wear it
            <ArrowRight aria-hidden />
          </Button>
        </div>
      )}
    </section>
  )
}
