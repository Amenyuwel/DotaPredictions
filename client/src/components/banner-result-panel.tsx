import { Caveats } from "@/components/caveats"
import { EmblemCard } from "@/components/emblem-card"
import { TieNote } from "@/components/tie-note"
import { TournamentContext } from "@/components/tournament-context"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { EmblemCatalog } from "@/lib/emblem-catalog"
import { points } from "@/lib/format"
import { ROLE_LABEL } from "@/lib/labels"
import { verdictFor } from "@/lib/ranking"
import type { BannerAnswer, RankedBanner } from "@/types/run"

/**
 * The other direction's answer: banners for a player, not players for a banner.
 *
 * It obeys the same two rules as the unit list and for the same reason —
 * overlapping intervals render as tied with no rank number, and what the model
 * cannot see travels with the number rather than under it. What it adds is the
 * two facts that are specific to choosing a banner:
 *
 *  - **What the ORDER is worth.** Two emblem traits are positional, so the same
 *    five emblems have a best and a worst arrangement. The gap between them is
 *    the only part of this answer a user can act on without owning anything
 *    else, so it is stated as a measured number and not as advice.
 *  - **What was actually searched.** An exhaustive comparison and a screened one
 *    are different claims about the same list, and the reader is the only one
 *    who can decide whether the difference matters to them.
 */
export function BannerResultPanel({
  answer,
  catalog,
}: {
  answer: BannerAnswer
  catalog: EmblemCatalog
}) {
  const best = answer.best
  const unit = answer.unit
  const nicks = unit.players.map((p) => p.nick).join(" + ")

  if (!best) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        {answer.reason ?? "No banner could be built from these emblems."}
      </div>
    )
  }

  const banners = [best, ...answer.alternatives]
  const orderGap = answer.worstOrder ? best.score - answer.worstOrder.score : null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-base font-medium">
          Best banners for {nicks}
        </h2>
        <p className="text-muted-foreground text-sm">
          Scored as the {ROLE_LABEL[unit.role]} slot
          {unit.players.length > 1 ? ", which is this pair's average in the same match" : ""},
          over {answer.search.nGames} matches they all played.
        </p>
      </div>

      <TieNote tied={answer.tied.length} />

      <ul className="space-y-2">
        {banners.map((banner, i) => (
          <BannerRow
            key={banner.bannerId}
            banner={banner}
            catalog={catalog}
            rank={i + 1}
            tied={verdictFor(banner.bannerId, best.bannerId, answer.tied) === "tied"}
          />
        ))}
      </ul>

      {answer.worstOrder && orderGap !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">What the order is worth</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              The same {answer.search.slots} emblems in their worst order score{" "}
              <span className="text-foreground font-medium tabular-nums">
                {points(answer.worstOrder.score)}
              </span>
              , so arranging them is worth{" "}
              <span className="text-foreground font-medium tabular-nums">
                {points(orderGap)}
              </span>{" "}
              and costs nothing. Vampiric takes 10% from each neighbour and Benevolent pays
              each 20%.
            </p>
            <Banner banner={answer.worstOrder} catalog={catalog} />
          </CardContent>
        </Card>
      )}

      <TournamentContext {...answer.tournamentContext} />

      <p className="text-muted-foreground text-xs">
        {answer.search.arrangements.toLocaleString()} legal arrangements of{" "}
        {answer.search.inventory} emblems, in {answer.search.subsets.toLocaleString()} sets.
        {answer.search.rescored < answer.search.arrangements
          ? ` All were compared at ${answer.search.screenSims} simulations; ${answer.search.rescored} were rescored at ${answer.search.sims.toLocaleString()} with an interval.`
          : " Every one was scored in full."}{" "}
        A banner and its mirror image score the same, so only one of each pair is listed.
      </p>

      <Caveats items={answer.caveats} />
    </div>
  )
}

/**
 * A tied row carries no rank number and no emphasis. Ranking overlapping
 * intervals 1, 2, 3 invents a distinction the interval denies.
 */
function BannerRow({
  banner,
  catalog,
  rank,
  tied,
}: {
  banner: RankedBanner
  catalog: EmblemCatalog
  rank: number
  tied: boolean
}) {
  return (
    <li className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-muted-foreground w-6 shrink-0 text-center text-xs tabular-nums">
          {tied ? "—" : rank}
        </span>
        <p className="text-muted-foreground min-w-0 flex-1 text-xs">
          {points(banner.ci.lo)} – {points(banner.ci.hi)} at 90%
        </p>
        {tied && <Badge variant="secondary">tied</Badge>}
        <span className="text-sm font-semibold tabular-nums">{points(banner.score)}</span>
      </div>
      <Banner banner={banner} catalog={catalog} />
    </li>
  )
}

/** The banner itself, top to bottom as the client draws it — numbered, because
 * position is an input to the score rather than a label. */
function Banner({ banner, catalog }: { banner: RankedBanner; catalog: EmblemCatalog }) {
  return (
    <ol className="space-y-1">
      {banner.emblems.map((emblem, i) => (
        <li key={`${emblem.emblemId}:${i}`} className="flex items-center gap-2">
          <span className="text-muted-foreground w-3 shrink-0 text-2xs tabular-nums">
            {i + 1}
          </span>
          <EmblemCard
            emblem={emblem}
            catalog={catalog}
            multiplier={banner.multipliers[i]}
            className="min-w-0 flex-1"
          />
        </li>
      ))}
    </ol>
  )
}
