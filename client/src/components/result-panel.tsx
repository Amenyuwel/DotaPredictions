import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Caveats } from "@/components/caveats"
import { percent, points } from "@/lib/format"
import { verdictFor } from "@/lib/ranking"
import type { AnswerResponse, RankedUnit } from "@/types/run"

/**
 * One panel, shared by both entry paths, because both ask the same question in
 * opposite directions and an answer should not change shape with the route.
 */
export function ResultPanel({ answer }: { answer: AnswerResponse }) {
  const units = [answer.best, ...answer.alternatives]
  const anyTie = answer.tied.length > 0

  return (
    <div className="space-y-4">
      {anyTie && (
        <p className="text-muted-foreground text-sm">
          {answer.tied.length + 1} results cannot be separated at this sample size. They are
          shown as tied, in no meaningful order.
        </p>
      )}

      <ul className="space-y-2">
        {units.map((unit, i) => (
          <UnitRow
            key={unit.unitId}
            unit={unit}
            rank={i + 1}
            tied={verdictFor(unit, answer.best, answer.tied) === "tied"}
          />
        ))}
      </ul>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Tournament context</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <Stat label="Expected series" value={answer.tournamentContext.expectedSeries.toFixed(2)} />
          <Stat label="Advances" value={percent(answer.tournamentContext.advanceProb)} />
          <Stat label="Out early" value={percent(answer.tournamentContext.eliminationRisk)} />
        </CardContent>
      </Card>

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
