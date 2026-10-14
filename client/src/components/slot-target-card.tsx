import { useState } from "react"
import { ChevronRight } from "lucide-react"

import { useTarget } from "@/hooks/use-target"

import { BannerResultPanel } from "@/components/banner-result-panel"
import { AwaitingInput, RunError } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton, SkeletonPanel } from "@/components/ui/skeleton"
// Spinner only, and only for the overlay across an answer being recomputed --
// there the layout is already drawn and skeletons would throw it away.
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { EmblemCatalog } from "@/lib/emblem-catalog"
import { cn } from "@/lib/utils"
import { interval, points } from "@/lib/format"
import { ROLE_LABEL, unitName } from "@/lib/labels"
import type { BannerAnswer, FantasyRole, Player, Stage } from "@/types/run"

/**
 * One slot's target, as a card the size of its headline, with the banner itself
 * behind it.
 *
 * The answer is long -- two banners to compare, what the order is worth, the
 * tournament context, the caveats -- and three of them stacked is a column no
 * reader can compare across without scrolling past two answers and holding the
 * first in their head. What is being compared is one number per slot, so that
 * is what stays on the page; the emblems are what a reader acts on one slot at
 * a time, so they open.
 *
 * This is the opposite of the rule that a caveat never folds away, and it stays
 * on the right side of it: the number outside is stated with its interval, and
 * everything that qualifies it opens WITH the emblems it qualifies rather than
 * being left behind on the card. Nothing here is a summary of the answer inside
 * -- it is the same score, read from the same field.
 */
export function SlotTargetCard({
  role,
  player,
  run,
  target,
  catalog,
}: {
  role: FantasyRole
  player: Player | null
  /** Which run the other rungs are asked against, so opening the dialog can ask
   * for one without the card holding four answers it may never show. */
  run: { tournamentId: string; stage: Stage } | undefined
  /** Structural rather than the query type, so this card is about an answer
   * arriving and not about the client that fetches it. */
  target: { data: BannerAnswer | undefined; isPending: boolean; error: unknown }
  catalog: EmblemCatalog
}) {
  const label = ROLE_LABEL[role]

  if (!player) {
    return <AwaitingInput compact>No {label.toLowerCase()} chosen.</AwaitingInput>
  }
  if (target.isPending) {
    return (
      <Card size="sm">
        <CardContent className="space-y-2">
          {/* The slot's name is not being waited for -- it is known before the
              query starts -- so it is printed rather than greyed out, exactly
              where the answered card puts it. Only the number below it is a
              placeholder. */}
          <p className="font-heading text-sm font-medium">{label}</p>
          <SkeletonPanel label={`Working out the ${label.toLowerCase()} banner…`}>
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-full" />
          </SkeletonPanel>
        </CardContent>
      </Card>
    )
  }
  if (target.error) return <RunError error={target.error} />
  if (!target.data) return null

  const answer = target.data
  const best = answer.best

  // No banner to open. The sentence saying why is the whole answer, so it is on
  // the card rather than behind a control that promises emblems there are none
  // of.
  if (!best) {
    return (
      <Card size="sm">
        <CardContent className="space-y-1">
          <p className="font-heading text-sm font-medium">{label}</p>
          <p className="text-muted-foreground text-xs">{answer.reason}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Answered
      role={role}
      player={player}
      run={run}
      answer={answer}
      catalog={catalog}
    />
  )
}

/**
 * The card, and the ladder behind it.
 *
 * Split out so the per-rung query has somewhere unconditional to live: the card
 * refuses to draw at all for a slot with no player or no legal banner, and a
 * hook cannot sit behind either of those returns.
 *
 * The rung on the card is the realistic one, deliberately. The ceiling -- five
 * Tier V emblems -- is the answer this tool used to lead with, and it is the one
 * banner nobody can roll their way into: quality is fixed at craft time and no
 * token changes it. It is still here, one tab along, because the ceiling is the
 * number a real goal is measured against. It is just not the goal.
 *
 * Which rung the number is is said once, on the total above these three, rather
 * than three times under three scores that are all the same rung. Open one and
 * the dialog names it on the tab, with the hand it assumes in the caveats.
 */
function Answered({
  role,
  player,
  run,
  answer,
  catalog,
}: {
  role: FantasyRole
  player: Player
  run: { tournamentId: string; stage: Stage } | undefined
  answer: BannerAnswer
  catalog: EmblemCatalog
}) {
  const [open, setOpen] = useState(false)
  const [goalId, setGoalId] = useState<string>(answer.goal?.id ?? "realistic")
  const label = ROLE_LABEL[role]
  const best = answer.best!
  const ladder = answer.ladder ?? []

  // The reader's own hand, seeded from the rung the card was drawn with so the
  // custom tab opens on something real and one chip at a time can be changed
  // from there. Empty if this run has no rung to seed from, which is also the
  // state in which the custom tab has nothing to ask about.
  const [hand, setHand] = useState<string[]>(answer.goal?.qualities ?? [])
  const custom = goalId === "custom"
  const ready = !custom || hand.length === answer.search.slots

  // Only while the dialog is open, and the realistic rung is already in the
  // cache under the same key the card was drawn from -- so switching to it
  // costs nothing and switching away costs one search. Editing a chip changes
  // the hand, which changes the key, which is a new question.
  const shown = useTarget(
    { teamId: player.teamId, role },
    run,
    goalId,
    open && ready,
    custom ? hand : undefined,
    // The unit never changes inside this dialog -- only the rung and the hand
    // do -- so the last answer can stay on screen while the next is fetched.
    true,
  )
  // True while a NEW question is in flight with an old answer still drawn. The
  // panel is dimmed and marked busy rather than replaced: a tier click should
  // not empty the dialog and collapse it to the height of two boxes.
  const stale = shown.isFetching && !shown.isPending

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* The button is the card: `after:inset-0` stretches its hit area over
          the whole thing, so the target is the card a reader is pointing at
          while the focus ring and the accessible name stay on a real button. */}
      <Card
        size="sm"
        className="focus-within:ring-ring hover:ring-ring/40 relative h-full transition-shadow focus-within:ring-2"
      >
        <CardContent className="flex h-full flex-col gap-1">
          <p className="font-heading text-sm font-medium">{label}</p>
          <p className="text-muted-foreground truncate text-xs">
            {unitName(answer.unit.players)}
          </p>
          <p className="text-2xl leading-tight font-semibold tabular-nums">
            {points(best.score)}
          </p>
          <p className="text-muted-foreground text-2xs tabular-nums">
            {interval(best.ci)}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
            className="mt-auto -mb-1 h-8 justify-start px-0 hover:bg-transparent after:absolute after:inset-0 after:rounded-xl"
          >
            See the {answer.search.slots} emblems
            <ChevronRight aria-hidden />
          </Button>
        </CardContent>
      </Card>

      <DialogContent
        showCloseButton={false}
        // Title, rungs and Done stay put; only the answer scrolls. Scrolling
        // the whole popup sent Done a screen below the fold on a phone, and
        // the rung tabs -- the control a reader switches between while
        // comparing -- scrolled away with it. Same shape as the emblem dialog.
        className="flex max-h-[85dvh] flex-col sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>
            {label} banner · {unitName(answer.unit.players)}
          </DialogTitle>
        </DialogHeader>

        {/* The rungs, and nothing under them. What a rung asks for -- the
            tiers, and the sentence naming them -- is already the first caveat
            on the answer below, because quality is the half of a banner no
            token can buy and that belongs with the number it qualifies. Said
            here as well it was the same sentence twice in one dialog, and the
            copy up here was the one with nothing to qualify. */}
        {ladder.length > 0 && (
          <Tabs value={goalId} onValueChange={(next) => setGoalId(next as string)}>
            <TabsList className="w-full justify-start overflow-x-auto [scrollbar-width:none]">
              {ladder.map((rung) => (
                <TabsTrigger
                  key={rung.id}
                  value={rung.id}
                  className="min-w-fit flex-1 px-1.5 text-xs sm:text-sm"
                >
                  {rung.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {/* Focusable, named, and ringed on focus: on every rung but Custom the
            answer has no control inside it, so without a tab stop of its own a
            keyboard user could not scroll to the second banner or the limits
            (WCAG 2.1.1). The ring is inset so the popup edge does not clip it. */}
        <div
          role="region"
          aria-label={`${label} banner details`}
          tabIndex={0}
          className="focus-visible:ring-ring/50 -mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto rounded-md px-4 py-1 outline-none focus-visible:ring-3 focus-visible:ring-inset"
        >
        {/* Said once, above the banners whose stamps are now the control. */}
        {custom && (
          <p className="text-muted-foreground text-xs">
            Tap a tier to change it.
          </p>
        )}

        {shown.isPending ? (
          <SkeletonPanel label="Working out the banner to aim for…" className="space-y-3">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </SkeletonPanel>
        ) : shown.error ? (
          <RunError error={shown.error} />
        ) : shown.data?.best ? (
          <div aria-busy={stale || undefined} className="relative">
            {/* In front of the answer rather than above it. The panel keeps its
                height and its place -- the shift this dialog has been fighting
                -- and the spinner sits over the middle of whatever part of it
                is on screen, which is what `sticky` inside the overlay does
                while the dialog scrolls.

                `pointer-events-none` so the tier chips underneath stay live:
                changing two tiers in a row should not be a queue. */}
            {stale && (
              <div
                role="status"
                aria-live="polite"
                className="pointer-events-none absolute inset-0 z-10 flex justify-center"
              >
                <span className="bg-popover/95 sticky top-1/2 flex h-8 -translate-y-1/2 items-center gap-2 rounded-full border px-3 text-xs shadow-lg">
                  <Spinner />
                  Working out the new banner…
                </span>
              </div>
            )}

            <div
              className={cn(
                "transition-opacity",
                // Dimmed, not hidden: the number is a moment out of date and
                // the overlay says so, while removing it would move everything
                // below.
                stale && "opacity-40",
              )}
            >
          <BannerResultPanel
            answer={shown.data}
            stage={run?.stage}
            catalog={catalog}
            // One banner while the hand is being edited, so a tier change
            // cannot swap the card out from under the chip that was clicked.
            single={custom}
            // Only where the tier is the reader's to set. On every other rung
            // the qualities are the rung's, and a control that silently moved
            // you off it would be a fifth goal wearing another one's name.
            // Read off the hand, not off the banner on screen: while a change
            // is in flight the drawn banner is the previous one, and deriving
            // the next hand from it would undo the click that started it.
            onTierChange={
              custom
                ? (_banner, index, tier) =>
                    setHand((prev) => prev.map((held, j) => (j === index ? tier : held)))
                : undefined
            }
          />
            </div>
          </div>
        ) : (
          <AwaitingInput compact>
            {shown.data?.reason ?? "No banner could be built for this goal."}
          </AwaitingInput>
        )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
