import type { ReactNode } from "react"
import { ChevronDown, CircleHelp } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * The questions the answer column provokes and cannot answer in place.
 *
 * Not a help page and not a place to move caveats to. Anything qualifying a
 * specific number -- a tie, a missing measurement, what a search skipped --
 * travels with that number in the panel; this holds only what is true of every
 * answer the tool gives, which is exactly the class of thing that would be said
 * three times if it were written beside each one.
 *
 * A dialog rather than a block under the grid. Stacked at the bottom of the
 * page it was a screenful of prose every reader scrolls past and nobody arrives
 * at: these questions are asked *while* looking at a score, so the way in has to
 * be beside the score rather than below it. Same rule the emblem sets follow --
 * content that has settled folds away, and what is still in flux stays out.
 *
 * Controlled from `App`, one dialog with two ways in: the header, where a reader
 * looking at a number is already looking, and the footer, where someone who has
 * decided to go and read about the thing goes first. Two triggers for one
 * dialog, never two copies of the text.
 *
 * `<details>` inside: seven answers open at once is the wall of prose this moved
 * out of, and the native element already has the keyboard behaviour, the open
 * state and find-in-page working before any script loads.
 */
export function FaqDialog({
  open,
  onOpenChange,
  slots,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  slots: number
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Taller and wider than the default, and scrolled rather than clipped:
          this is the one dialog in the app whose content is paragraphs. The cap
          is on the viewport rather than a fixed height, so a phone in landscape
          does not get a box taller than the screen. */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>What this tool is doing</DialogTitle>
          <DialogDescription>
            How the numbers are made, and what they cannot see. Limits that apply to one
            specific answer are printed with that answer instead.
          </DialogDescription>
        </DialogHeader>

        {/* One rhythm for the group, and the dividers come from the rows rather
            than from a wrapper, so a question added or removed does not leave a
            rule with nothing under it. */}
        <div className="border-t">
          {items(slots).map(({ q, a }) => (
            <Question key={q} question={q}>
              {a}
            </Question>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The way in from the header.
 *
 * Icon-only and ghost, because it sits in a cluster with the theme menu and the
 * account menu and a third control carrying a text label would be the only one
 * -- peers are one size, decided by the group. The accessible name carries what
 * the icon cannot.
 */
export function FaqButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      onClick={onClick}
      aria-label="What this tool is doing"
    >
      <CircleHelp aria-hidden />
    </Button>
  )
}

function Question({ question, children }: { question: string; children: ReactNode }) {
  return (
    <details className="group border-b">
      <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-3 text-sm font-medium outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
        {question}
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>
      <div className="text-muted-foreground space-y-2 pb-4 text-sm">{children}</div>
    </details>
  )
}

/**
 * The answers, with the run's own banner size in the one place it matters.
 *
 * Read off `bannerSlots` like everything else rather than written as "three or
 * five": a period with a different banner size would otherwise have a FAQ that
 * contradicts the builder behind it, and of the two the prose is the one a
 * reader would believe.
 */
const items = (slots: number) => [
  {
    q: "Where do these numbers come from?",
    a: (
      <>
        <p>
          Public match history - OpenDota, plus STRATZ where a token is configured. Each
          player's stat rates are averaged with recent games weighted more heavily, team
          strengths are fitted from results, and the bracket is simulated to find how many
          series each team is likely to play.
        </p>
        <p>
          A score is then an <strong>expected best series</strong>, not a per-game average:
          the fantasy client keeps your best series, so a team going out early has fewer
          attempts at a good one and is worth less through the same banner.
        </p>
      </>
    ),
  },
  {
    q: "Why does it say two units are tied instead of ranking them?",
    a: (
      <p>
        Because they are. Each projection carries a 90% interval from a bootstrap over a
        pool of roughly 40 to 112 games, and when two intervals overlap the sample cannot
        tell them apart. Printing a #1 and a #2 there would be inventing a finding out of
        rounding - so neither gets a rank number and both are marked tied. Picking either
        is defensible; picking one because this tool put it first is not.
      </p>
    ),
  },
  {
    q: "Why does the order of the emblems change the score?",
    a: (
      <p>
        Two traits act on their <em>neighbours</em> rather than on themselves - Vampiric
        charges the emblems beside it, Benevolent pays them. So a banner's multiplier is a
        property of an arrangement, not of a set, and the same {slots} emblems in a
        different order are a different banner. That is why the builder keeps empty slots
        open instead of closing them up, and why the optimizer reports what the ordering
        alone is worth.
      </p>
    ),
  },
  {
    q: "Can it just tell me the best banner out of everything?",
    a: (
      <>
        <p>
          Yes - that is what the roster tab answers. Half of it is exact: a multiplier
          depends only on tiers, traits and neighbours, so every one of the 9,765,625
          configurations is compared and all but a handful are beaten at every rank of
          every colour. The stats are exhaustive too, because each slot's colour is fixed
          and only six stats can sit in it.
        </p>
        <p>
          The screen at the end is not. Candidates are shortlisted on their average before
          being simulated, and an average cannot see a right tail - a banner that wins on
          rare huge games rather than on typical ones could be dropped before it is scored
          properly. The panel reports how many were considered and how many survived, so
          the size of that gap is on screen rather than assumed away.
        </p>
      </>
    ),
  },
  {
    q: "What can't it see?",
    a: (
      <>
        <p>
          Lotuses, because nobody publishes them. The field exists in Valve's own data and
          neither OpenDota nor STRATZ populates it, so an emblem scoring lotuses is marked
          unmeasurable and excluded from any recommendation rather than quietly scored as
          zero - a missing measurement is not a zero.
        </p>
        <p>
          Also drafts and bans: teams are one strength number, so a duo whose signature
          hero is banned every game is projected as though it were not. A balance patch
          landing mid-event is unmodelled for the same reason. Whatever a specific answer
          cannot see is listed with that answer, under "what this answer cannot see".
        </p>
      </>
    ),
  },
  {
    q: "Does signing in change the answer?",
    a: (
      <p>
        No. The model does not know who is asking, and a guest gets identical rankings. An
        account does exactly one thing: it saves your banners so they survive a reload.
        Nothing you enter is used to score anything.
      </p>
    ),
  },
  {
    q: "How fresh is this, and what if it isn't?",
    a: (
      <p>
        The data window and publish time are in the header, always, because a stale
        projection is this tool's most expensive failure - it produces a confident wrong
        number and no error. A run is an immutable snapshot and a correction is a new run
        rather than an edit, so the numbers under a given timestamp never change underneath
        you. If the date looks old, the fix is republishing from the engine, not reloading.
      </p>
    ),
  },
]
