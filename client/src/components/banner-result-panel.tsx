import { Caveats } from "@/components/caveats"
import { EmblemCard } from "@/components/emblem-card"
import { TournamentContext } from "@/components/tournament-context"
import { Badge } from "@/components/ui/badge"
import type { EmblemCatalog } from "@/lib/emblem-catalog"
import { interval, points, range } from "@/lib/format"
import { verdictFor } from "@/lib/ranking"
import type { BannerAnswer, RankedBanner, Stage } from "@/types/run"

/**
 * The other direction's answer: banners for a player, not players for a banner.
 *
 * Drawn inside the slot dialog, which already names the slot and the unit, so
 * nothing here repeats them. What the model cannot see travels with the number,
 * and an overlapping interval is marked tied -- the same two rules the unit
 * list follows. What it adds is two facts specific to choosing a banner, each
 * one line:
 *
 *  - **What the ORDER is worth.** Two emblem traits are positional, so the same
 *    five emblems have a best and a worst arrangement. The gap is the one part
 *    of the answer a reader can act on without owning anything else.
 *  - **What was actually searched.** An exhaustive comparison and a screened one
 *    are different claims about the same list, so the counts stay.
 *
 * A wide, headed version of this panel (a title, a "what the order is worth"
 * card with the losing banner drawn out, a paragraph on the search) was cut:
 * nothing rendered it, and every fact it carried is in the two lines below.
 */
/** How many banners the list shows. */
const SHOWN = 2

export function BannerResultPanel({
  answer,
  catalog,
  onTierChange,
  single = false,
  stage,
}: {
  answer: BannerAnswer
  catalog: EmblemCatalog
  /** Which stage the run is, so the team outlook can name its probabilities. */
  stage: Stage | undefined
  /** Given only on the custom goal: the reader is naming the emblems they hold,
   * so every tier on screen is an input. The banner it happened on travels with
   * the change because the hand is that banner's five qualities -- which of
   * them carries which stat is the search's answer, not the reader's. */
  onTierChange?: (banner: RankedBanner, index: number, tier: string) => void
  /**
   * One banner, unnumbered.
   *
   * For the custom goal, where the list is being edited rather than read. Two
   * banners a few points apart swap places the moment a tier changes, and the
   * chip the reader just set would move under the cursor. A single answer
   * cannot do that.
   */
  single?: boolean
}) {
  const best = answer.best

  if (!best) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        {answer.reason ?? "No banner could be built from these emblems."}
      </div>
    )
  }

  // Two rows, not ten. The top of this list is usually a tie, and a long column
  // of banners a reader cannot choose between reads as a ranking it is not.
  const banners = [best, ...answer.alternatives].slice(0, single ? 1 : SHOWN)
  const orderGap = answer.worstOrder ? best.score - answer.worstOrder.score : null
  const search = answer.search

  return (
    <div className="space-y-3">
      <ul className={single ? "space-y-2" : "grid grid-cols-1 gap-2 sm:grid-cols-2"}>
        {banners.map((banner, i) => (
          <BannerRow
            key={banner.bannerId}
            banner={banner}
            catalog={catalog}
            rank={i + 1}
            // Off for the single custom banner: with nothing beside it, "tied"
            // names a row the reader cannot see.
            tied={!single && verdictFor(banner.bannerId, best.bannerId, answer.tied) === "tied"}
            numbered={!single}
            onTierChange={
              onTierChange && ((index, tier) => onTierChange(banner, index, tier))
            }
          />
        ))}
      </ul>

      {orderGap !== null && (
        <p className="text-muted-foreground text-xs">
          This order adds{" "}
          <span className="text-foreground font-medium tabular-nums">{points(orderGap)}</span>{" "}
          over the worst one.
        </p>
      )}

      <TournamentContext {...answer.tournamentContext} stage={stage} />

      {/* The search in counts. "Top N of M stats" stays because it is the
          difference between an exhaustive answer and a screened one. */}
      <p className="text-muted-foreground text-xs tabular-nums">
        {search.nGames} matches ·{" "}
        {search.kind === "catalog"
          ? `${search.candidates.toLocaleString()} banners compared · top ${search.statsConsidered} of ${search.statsTotal} stats`
          : `${search.arrangements.toLocaleString()} orders compared`}
      </p>

      <Caveats items={answer.caveats} />
    </div>
  )
}

/**
 * The number is a position in the list, not a verdict. Rows arrive descending by
 * point estimate and are numbered that way, because a reader needs to say "the
 * second one" out loud.
 *
 * The number stays on a tied row, unlike the unit list, because the two rows are
 * drawn side by side and "the second one" is how a reader points at one. The
 * `tied` badge is what says the order between them is not evidence.
 */
function BannerRow({
  banner,
  catalog,
  rank,
  tied,
  numbered = true,
  onTierChange,
}: {
  banner: RankedBanner
  catalog: EmblemCatalog
  rank: number
  /** The server's overlap verdict against the first banner, via `verdictFor`. */
  tied: boolean
  /** Off where there is only one banner: a lone "1" ranks nothing. */
  numbered?: boolean
  onTierChange?: (index: number, tier: string) => void
}) {
  return (
    <li className="rounded-lg border p-3">
      {/* Score first, its interval directly under it -- the same shape as every
          other figure in the tool. On one line beside the rank, the interval
          and the tie badge were squeezed until the range itself was clipped. */}
      <div className="mb-2 flex items-start gap-3">
        {numbered && (
          <span className="font-heading w-6 shrink-0 text-center text-lg leading-tight font-semibold tabular-nums">
            {rank}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold tabular-nums">
            {points(banner.score)}
            {tied && <Badge variant="secondary">tied</Badge>}
          </p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {rank === 1 ? interval(banner.ci) : range(banner.ci)}
          </p>
        </div>
      </div>
      <Banner banner={banner} catalog={catalog} onTierChange={onTierChange} />
    </li>
  )
}

/** The banner itself, top to bottom as the client draws it -- numbered, because
 * position is an input to the score rather than a label. */
function Banner({
  banner,
  catalog,
  onTierChange,
}: {
  banner: RankedBanner
  catalog: EmblemCatalog
  onTierChange?: (index: number, tier: string) => void
}) {
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
            onTierChange={onTierChange && ((tier) => onTierChange(i, tier))}
            className="min-w-0 flex-1"
          />
        </li>
      ))}
    </ol>
  )
}
