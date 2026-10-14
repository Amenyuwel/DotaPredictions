import { percent } from "@/lib/format"
import type { Stage } from "@/types/run"

/**
 * How far the model thinks this team gets, which is half of every score above
 * it.
 *
 * E[best series] is an expected maximum over however many series a team plays,
 * so a side that goes out early has fewer attempts at a good one and scores
 * less through the same banner. Printing the banner's number without this makes
 * it look like a property of the emblems.
 *
 * Worded per stage, because the same two fields mean different things in each:
 *
 *  - **Group Stage.** `advanceProb` is reaching the Main Event, and
 *    `eliminationRisk` is published as exactly 1 - that (a Swiss team cannot go
 *    out "early" -- everyone plays at least four series). Shown both, they were
 *    83.8% and 16.2% side by side: one fact twice, reading like two.
 *  - **Main Event.** `advanceProb` is the bracket win probability -- winning
 *    the event -- and `eliminationRisk` is going out within two series.
 *
 * Labelled "advance" and "out early" for both, the line read as three numbers
 * nobody could place, about a team it did not name. Now each value carries its
 * own plain phrase, and the line says whose outlook it is.
 *
 * Stage unknown (a caller with no run in hand) prints the series count only:
 * the two probabilities cannot be named honestly without it.
 */
export function TournamentContext({
  stage,
  team,
  split = false,
  expectedSeries,
  advanceProb,
  eliminationRisk,
}: {
  stage: Stage | undefined
  /** Whose outlook this is. Omitted where the surrounding card already says. */
  team?: string
  /** Facts as equal columns, value over label, outer ones flush to the edges,
   * for a card laid out in mirrored halves. The heading is dropped there
   * because the card's own name already says whose outlook it is; it stays on
   * the list for a screen reader. */
  split?: boolean
  expectedSeries: number
  advanceProb: number
  eliminationRisk: number
}) {
  const facts: [string, string][] = [[`~${expectedSeries.toFixed(1)}`, "series to play"]]
  if (stage === "group") facts.push([percent(advanceProb), "chance to reach the Main Event"])
  if (stage === "main") {
    facts.push([percent(eliminationRisk), "chance to be out within 2 series"])
    facts.push([percent(advanceProb), "chance to win the event"])
  }
  const heading = team ? `${team} outlook` : "Team outlook"

  if (split) {
    return (
      <ul aria-label={heading} className="grid auto-cols-fr grid-flow-col gap-4">
        {facts.map(([value, label]) => (
          <li
            key={label}
            className="text-center first:text-left last:text-right only:text-left"
          >
            <p className="text-base leading-tight font-semibold tabular-nums">{value}</p>
            <p className="text-muted-foreground mt-0.5 text-xs text-balance">{label}</p>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="text-xs">
      {/* Set in the Label role so it reads as a heading over the facts, not as
          a third caption: in body ink it was the same line as everything else. */}
      <p className="text-muted-foreground mb-2 text-[0.7rem] leading-none font-semibold tracking-[0.12em] uppercase">
        {heading}
      </p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {facts.map(([value, label]) => (
          <li key={label} className="text-muted-foreground">
            <span className="text-foreground font-medium tabular-nums">{value}</span> {label}
          </li>
        ))}
      </ul>
    </div>
  )
}
