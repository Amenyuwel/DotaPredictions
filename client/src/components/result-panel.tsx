import { Badge } from "@/components/ui/badge"
import { Caveats } from "@/components/caveats"
import { TournamentContext } from "@/components/tournament-context"
import { interval, points, range } from "@/lib/format"
import { unitName } from "@/lib/labels"
import { verdictFor } from "@/lib/ranking"
import type { AnswerResponse, RankedUnit, Stage, Team } from "@/types/run"

/**
 * Which units score best through a fixed banner.
 *
 * The chrome around the list -- the tie sentence, the tournament context, the
 * caveats -- is shared with the banner direction rather than restated here.
 * Both answers are a ranked list with intervals on it, and a reader who saw one
 * of them hedge and the other not would reasonably conclude the second knew
 * more.
 *
 * The first unit is set apart, the rest are a ruled list. Eight rows of equal
 * weight made a reader do the ranking's job a second time: the answer to "who
 * should wear this banner" was the first of eight identical boxes. The lead is
 * drawn like a roster card -- figure, then its interval directly under it --
 * because that is the one shape in the tool a reader already knows how to read.
 * When the top is a tie the lead says so in the same place it says its number,
 * so a reader cannot take the figure without the overlap.
 */
export function ResultPanel({
  answer,
  teams,
  stage,
}: {
  answer: AnswerResponse
  teams?: Team[]
  stage: Stage | undefined
}) {
  const best = answer.best
  if (!best) return null

  // Optional, because a saved banner reopened from the account page is scored
  // without the run's team list in reach. The name is context, not the answer.
  const teamName = (teamId: number) => teams?.find((t) => t.teamId === teamId)?.name

  return (
    <div className="space-y-4">
      {/* The outlook rides in the lead card: it is about the lead unit's team
          only, and under the whole list it read as being about all of them. */}
      <LeadUnit unit={best} team={teamName(best.teamId)} tiedWith={answer.tied.length}>
        <TournamentContext
          {...answer.tournamentContext}
          stage={stage}
          team={teamName(best.teamId)}
          split
        />
      </LeadUnit>

      {answer.alternatives.length > 0 && (
        <ol
          aria-label="The other units, by projected score"
          className="ring-foreground/10 divide-y rounded-xl ring-1"
        >
          {answer.alternatives.map((unit, i) => (
            <UnitRow
              key={unit.unitId}
              unit={unit}
              team={teamName(unit.teamId)}
              rank={i + 2}
              tied={verdictFor(unit.unitId, best.unitId, answer.tied) === "tied"}
            />
          ))}
        </ol>
      )}

      <Caveats items={answer.caveats} />
    </div>
  )
}

function LeadUnit({
  unit,
  team,
  tiedWith,
  children,
}: {
  unit: RankedUnit
  team: string | undefined
  /** How many of the rows below overlap this one. */
  tiedWith: number
  children?: React.ReactNode
}) {
  return (
    // Compendium gold: the answer's own colour, as a fill with no outline,
    // where inputs and the list below stay neutral. See `[data-answer]` in
    // index.css -- everything inside follows the card's palette.
    //
    // Two mirrored halves on one grid: who on the left, the figure on the
    // right, and each row shared across the axis -- name with figure, team
    // with interval -- so both columns start and end on the same lines.
    // Stacked, it was six lines at nearly one weight and a reader had to find
    // the number among them. A container query, not a breakpoint, because the
    // same card renders in the wide column and in the phone's dialog.
    <div data-answer className="@container space-y-5 rounded-xl p-5">
      <div className="grid gap-y-1 @sm:grid-flow-col @sm:grid-cols-[minmax(0,1fr)_auto] @sm:grid-rows-[auto_auto] @sm:items-baseline @sm:gap-x-6">
        {/* The same size, weight and tracking as the figure opposite: the
            answer is "who" and "how much" together, so neither half outranks
            the other. Inter, not the heading face -- player names need its
            Cyrillic and Greek. */}
        <p className="text-4xl leading-none font-semibold tracking-tight text-balance">
          {unitName(unit.players)}
        </p>
        <p className="text-muted-foreground mt-1 text-[0.7rem] leading-none font-semibold tracking-[0.12em] uppercase">
          {team}
        </p>
        <p className="mt-3 text-4xl leading-none font-semibold tracking-tight tabular-nums @sm:mt-0 @sm:text-right">
          {points(unit.score)}
        </p>
        {/* The tie rides on the interval as a badge, the same mark the tied
            rows below carry, so it sits beside the number it qualifies and
            leaves both halves two lines tall. The full sentence stays for a
            screen reader. */}
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums @sm:justify-end">
          {tiedWith > 0 && (
            <Badge variant="secondary">
              <span aria-hidden>tied with {tiedWith}</span>
              <span className="sr-only">Tied with {tiedWith} below: too close to call.</span>
            </Badge>
          )}
          {interval(unit.ci)}
        </p>
      </div>
      {/* A recessed well instead of a rule: the outlook is a separate fact
          about the team, and a tinted floor sets it apart without drawing a
          line through the card. Tinted from the card's own ink, so it stays
          gold in both themes. */}
      {children && <div className="bg-foreground/[0.06] rounded-lg px-4 py-3">{children}</div>}
    </div>
  )
}

/**
 * A tied row carries no rank number and no emphasis. Ranking overlapping
 * intervals 1, 2, 3 invents a distinction the interval denies.
 */
function UnitRow({
  unit,
  team,
  rank,
  tied,
}: {
  unit: RankedUnit
  team: string | undefined
  rank: number
  tied: boolean
}) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5">
      <span className="text-muted-foreground text-center text-xs tabular-nums">
        {tied ? "–" : rank}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{unitName(unit.players)}</span>
          {tied && <Badge variant="secondary">tied</Badge>}
        </p>
        {team && <p className="text-muted-foreground truncate text-xs">{team}</p>}
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums">{points(unit.score)}</p>
        <p className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
          {range(unit.ci)}
        </p>
      </div>
    </li>
  )
}
