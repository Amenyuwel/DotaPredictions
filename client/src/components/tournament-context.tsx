import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { percent } from "@/lib/format"

/**
 * How far the model thinks this team gets, which is half of every score above
 * it.
 *
 * E[best series] is an expected maximum over however many series a team plays,
 * so a side that goes out early has fewer attempts at a good one and scores
 * less through the same banner. Printing the banner's number without this makes
 * it look like a property of the emblems.
 *
 * Shared by both directions because it is the same three numbers about the same
 * team either way.
 */
export function TournamentContext({
  expectedSeries,
  advanceProb,
  eliminationRisk,
}: {
  expectedSeries: number
  advanceProb: number
  eliminationRisk: number
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Tournament context</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-4 text-sm">
        <Stat label="Expected series" value={expectedSeries.toFixed(2)} />
        <Stat label="Advances" value={percent(advanceProb)} />
        <Stat label="Out early" value={percent(eliminationRisk)} />
      </CardContent>
    </Card>
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
