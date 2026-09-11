import { Caveats } from "@/components/caveats"
import { EmblemCard } from "@/components/emblem-card"
import { TournamentContext } from "@/components/tournament-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { EmblemCatalog } from "@/lib/emblem-catalog"
import { points } from "@/lib/format"
import { cn } from "@/lib/utils"
import { unitName } from "@/lib/labels"
import type { BannerAnswer, RankedBanner } from "@/types/run"

/**
 * The other direction's answer: banners for a player, not players for a banner.
 *
 * What the model cannot see travels with the number rather than under it, the
 * same rule the unit list follows. The other rule it used to share is gone: the
 * unit list still marks an overlapping interval as tied, and this one no longer
 * does. Rows here are numbered by position either way, and the intervals are
 * printed, so the overlap is there to be read rather than said. What it adds is
 * the two facts that are specific to choosing a banner:
 *
 *  - **What the ORDER is worth.** Two emblem traits are positional, so the same
 *    five emblems have a best and a worst arrangement. The gap between them is
 *    the only part of this answer a user can act on without owning anything
 *    else, so it is stated as a measured number and not as advice.
 *  - **What was actually searched.** An exhaustive comparison and a screened one
 *    are different claims about the same list, and the reader is the only one
 *    who can decide whether the difference matters to them.
 */
/** How many banners the list shows. */
const SHOWN = 2

export function BannerResultPanel({
  answer,
  catalog,
  compact = false,
  onTierChange,
  single = false,
}: {
  answer: BannerAnswer
  catalog: EmblemCatalog
  /**
   * Drawn inside a dialog that already names the slot and the unit.
   *
   * Only the things that were being SAID TWICE go away: the heading repeats the
   * dialog's title, and the worst order is a measured gap that does not need
   * the losing banner drawn under it to be believed. The two banners sit side
   * by side instead of stacked. Nothing that qualifies the number moves --
   * the tie, the sample, the caveats are all still here, because a limit that
   * only appears when a reader scrolls is a limit that does not appear.
   */
  compact?: boolean
  /** Given only on the custom goal: the reader is naming the emblems they hold,
   * so every tier on screen is an input. The banner it happened on travels with
   * the change because the hand is that banner's five qualities -- which of
   * them carries which stat is the search's answer, not the reader's. */
  onTierChange?: (banner: RankedBanner, index: number, tier: string) => void
  /**
   * One banner, unnumbered.
   *
   * For the custom goal, where the list is being edited rather than read. Two
   * banners a few points apart swap places the moment a tier changes -- the
   * numbers are honest, but the card under the reader's cursor becomes a
   * different banner between one click and the next, and the chip they just set
   * has moved. A single answer cannot do that. Nothing is lost that the tie
   * note does not already say: on this evidence the top of the list is a tie,
   * so the second banner was never a runner-up to begin with.
   */
  single?: boolean
}) {
  const best = answer.best
  const unit = answer.unit
  const nicks = unitName(unit.players)

  if (!best) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        {answer.reason ?? "No banner could be built from these emblems."}
      </div>
    )
  }

  // Two rows, not ten. The top of this list is usually a tie, and a long column
  // of banners a reader cannot choose between reads as a ranking it is not.
  //
  // Nothing now says a tie happened at all on this panel: the sentence that
  // carried the count is gone and so is the per-row badge. The intervals are
  // still printed, so the overlap is readable, but it is not stated. Worth
  // knowing if these rows ever start reading as "the two that won".
  const banners = [best, ...answer.alternatives].slice(0, single ? 1 : SHOWN)
  const orderGap = answer.worstOrder ? best.score - answer.worstOrder.score : null

  return (
    <div className="space-y-4">
      <div>
        {!compact && (
          <h2 className="font-heading text-base font-medium">
            {answer.search.kind === "catalog"
              ? `Aim for this banner for ${nicks}`
              : `Best banners for ${nicks}`}
          </h2>
        )}
        <p className={cn("text-muted-foreground text-sm", compact && "sr-only")}>
          Scored on {answer.search.nGames} matches
          {unit.players.length > 1
            ? " where both of them played, using their combined score in each"
            : " they played"}
          .
          {answer.search.kind === "catalog" &&
            ` Every emblem in the game was considered - this does not assume you own anything.`}
        </p>
      </div>


      <ul className={compact && !single ? "grid gap-2 sm:grid-cols-2" : "space-y-2"}>
        {banners.map((banner, i) => (
          <BannerRow
            key={banner.bannerId}
            banner={banner}
            catalog={catalog}
            rank={i + 1}
            numbered={!single}
            onTierChange={
              onTierChange && ((index, tier) => onTierChange(banner, index, tier))
            }
          />
        ))}
      </ul>

      {answer.worstOrder && orderGap !== null && compact && (
        <p className="text-muted-foreground text-xs">
          Order matters: the same {answer.search.slots} emblems in the worst arrangement
          score{" "}
          <span className="text-foreground font-medium tabular-nums">
            {points(answer.worstOrder.score)}
          </span>
          , so putting them in this order is worth{" "}
          <span className="text-foreground font-medium tabular-nums">{points(orderGap)}</span>{" "}
          and costs nothing.
        </p>
      )}

      {answer.worstOrder && orderGap !== null && !compact && (
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

      {/* How much was actually compared, in counts rather than in the
          vocabulary of the search. The two directions compare different things,
          so neither sentence stands in for the other -- but a reader only needs
          to know how wide the net was and how carefully the finalists were
          checked. */}
      {/* In a dialog this is one line of counts. The prose version above it is
          still rendered for a screen reader, because "what was compared" is not
          decoration -- it is the difference between an exhaustive answer and a
          screened one, and a sighted reader gets it here in numbers. */}
      {compact ? (
        <p className="text-muted-foreground text-xs">
          {answer.search.nGames} matches ·{" "}
          {answer.search.kind === "catalog"
            ? `${answer.search.candidates.toLocaleString()} banners compared · top ${answer.search.statsConsidered} of ${answer.search.statsTotal} stats`
            : `${answer.search.arrangements.toLocaleString()} arrangements compared`}{" "}
          · mirrored pairs shown once
        </p>
      ) : (
      <p className="text-muted-foreground text-xs">
        {answer.search.kind === "inventory" ? (
          <>
            Checked every one of the {answer.search.arrangements.toLocaleString()} ways to
            arrange your {answer.search.inventory} emblems.
            {answer.search.rescored < answer.search.arrangements
              ? ` The best ${answer.search.rescored} were then re-checked much more carefully.`
              : ""}
          </>
        ) : (
          <>
            Compared {answer.search.candidates.toLocaleString()} possible banners built from
            the {answer.search.catalog} emblems this stage can make, then re-checked the top{" "}
            {answer.search.rescored} in much more detail. To stay fast, only the{" "}
            {answer.search.statsConsidered} most valuable stats of {answer.search.statsTotal}{" "}
            went into that comparison.
          </>
        )}{" "}
        Flipping a banner upside down scores the same, so only one of each mirrored pair is
        shown.
      </p>
      )}

      <Caveats items={answer.caveats} />
    </div>
  )
}

/**
 * The number is a position in the list, not a verdict. Rows arrive descending by
 * point estimate and are numbered that way, because a reader needs to say "the
 * second one" out loud.
 *
 * Nothing on the row says whether the interval separates it from the one above.
 * A `tied` badge sat between the interval and the score and said exactly that;
 * it is gone, and with it the last tie marker on this panel. What is left is the
 * interval itself -- two rows whose ranges overlap are not ordered by this
 * evidence, and a reader now has to read the numbers to see it.
 */
function BannerRow({
  banner,
  catalog,
  rank,
  numbered = true,
  onTierChange,
}: {
  banner: RankedBanner
  catalog: EmblemCatalog
  rank: number
  /** Off where there is only one banner: a lone "1" ranks nothing. */
  numbered?: boolean
  onTierChange?: (index: number, tier: string) => void
}) {
  return (
    <li className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-3">
        {numbered && (
          <span className="font-heading w-6 shrink-0 text-center text-lg leading-none font-semibold tabular-nums">
            {rank}
          </span>
        )}
        {/* One line, never two. The interval is the row's only qualifier now,
            and broken over two lines in a two-column grid it stops reading as
            one range and starts reading as a stray "90%" under a number. */}
        <p className="text-muted-foreground min-w-0 flex-1 text-xs whitespace-nowrap">
          {points(banner.ci.lo)} - {points(banner.ci.hi)} at 90%
        </p>
        <span className="text-sm font-semibold tabular-nums">{points(banner.score)}</span>
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
