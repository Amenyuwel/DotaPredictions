import { Badge } from "@/components/ui/badge"
import { Caveats } from "@/components/caveats"
import { TieNote } from "@/components/tie-note"
import { TournamentContext } from "@/components/tournament-context"
import { points } from "@/lib/format"
import { verdictFor } from "@/lib/ranking"
import type { AnswerResponse, RankedUnit } from "@/types/run"

/**
 * Which units score best through a fixed banner.
 *
 * The chrome around the list -- the tie sentence, the tournament context, the
 * caveats -- is shared with the banner direction rather than restated here.
 * Both answers are a ranked list with intervals on it, and a reader who saw one
 * of them hedge and the other not would reasonably conclude the second knew
 * more.
 */
export function ResultPanel({ answer }: { answer: AnswerResponse }) {
  const best = answer.best
  if (!best) return null
  const units = [best, ...answer.alternatives]

  return (
    <div className="space-y-4">
      <TieNote tied={answer.tied.length} />

      <ul className="space-y-2">
        {units.map((unit, i) => (
          <UnitRow
            key={unit.unitId}
            unit={unit}
            rank={i + 1}
            tied={verdictFor(unit.unitId, best.unitId, answer.tied) === "tied"}
          />
        ))}
      </ul>

      <TournamentContext {...answer.tournamentContext} />

      <Caveats items={answer.caveats} />
    </div>
  )
}

/**
 * A tied row carries no rank number and no emphasis. Ranking overlapping
 * intervals 1, 2, 3 invents a distinction the interval denies.
 */
function UnitRow({ unit, rank, tied }: { unit: RankedUnit; rank: number; tied: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border p-3">
      <span className="text-muted-foreground w-6 shrink-0 text-center text-xs tabular-nums">
        {tied ? "—" : rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {unit.players.map((p) => p.nick).join(" + ")}
        </p>
        <p className="text-muted-foreground text-xs">
          {points(unit.ci.lo)} – {points(unit.ci.hi)} at 90%
        </p>
      </div>
      {tied && <Badge variant="secondary">tied</Badge>}
      <span className="text-sm font-semibold tabular-nums">{points(unit.score)}</span>
    </li>
  )
}
