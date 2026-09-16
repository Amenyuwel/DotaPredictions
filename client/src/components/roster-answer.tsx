import { SlotTargetCard } from "@/components/slot-target-card"
import { AwaitingInput } from "@/components/states"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
}: {
  roster: Roster
  targets: Record<FantasyRole, BannerQuery>
  run: { tournamentId: string; stage: Stage } | undefined
  slots: number
  catalog: EmblemCatalog
}) {
  const total = rosterTotal(targets)

  // Before the first player is picked the three slots have nothing to say
  // apart from each other, and saying it three times fills the whole answer
  // column with a paragraph repeated with one word changed. One sentence until
  // there is something to be specific about.
  if (ROLE_ORDER.every((r) => roster[r] === null)) {
    return (
      <AwaitingInput>
        Pick a core, a mid and a support. Each one gets the {slots} emblems that score
        best for it out of the whole catalog -- the banner to go and roll for -- and the
        three are added up.
      </AwaitingInput>
    )
  }

  return (
    <div className="space-y-4">
      {total !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Projected roster total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{points(total)}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Sum of each slot's realistic target, so it is what this roster is worth on a
              hand of emblems an ordinary set of crafts leaves you with - not the ceiling.
              Quality cannot be rerolled, so the perfect banner is a number to measure
              against rather than one to plan for; each card opens on the whole ladder.
              The game scores core, mid and support as separate averages, so there is
              nothing for the slots to trade off against each other.
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
