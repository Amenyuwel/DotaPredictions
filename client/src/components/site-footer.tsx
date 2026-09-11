import { Database } from "lucide-react"

import { day, matchCount, timestamp } from "@/lib/format"
import type { RunMeta } from "@/types/run"

/**
 * When the answer above was made, and out of what.
 *
 * One line, and the only reason this footer exists. A projection with no
 * visible date is indistinguishable from a stale one, and a stale projection is
 * this project's most expensive failure -- a confident wrong number with no
 * error -- so the run is dated wherever it is shown. It reads as one sentence
 * about one snapshot: the games that went in, then when they were turned into
 * these numbers.
 *
 * The trade in having it here rather than in the header is real: it is off
 * screen while a long answer is being read. What did NOT move down is the
 * forced-gate badge, which is an alarm rather than a date and stays beside the
 * answer it is about.
 *
 * Nothing else belongs here. Limits that qualify a specific number are printed
 * with that number and what the model cannot see is behind the FAQ; restated
 * here they would be a second copy of a fact, which is the version a reader
 * compares against the first.
 *
 * Nothing at all without a run: an empty rule across the foot of the error and
 * loading screens is chrome drawn around a fact that is not there yet.
 */
export function SiteFooter({ run }: { run?: RunMeta }) {
  if (!run) return null

  return (
    <footer className="border-t">
      {/* Centred, unlike everything above it. The page's columns are ragged-left
          because each one is a thing to read down; this is one line about the
          page as a whole, and hanging it off the left edge made it read as the
          first item of a fourth column that is not there. */}
      <p className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 px-6 py-4 text-xs">
        <Database className="size-3.5 shrink-0" aria-hidden />
        <span>
          {day(run.dataWindow.from)} – {day(run.dataWindow.to)},{" "}
          {matchCount(run.dataWindow.matchCount)}
        </span>
        {/* A dot, not a `Separator`: that renders a div, and a div inside a
            `<p>` closes the paragraph in the parser -- valid-looking JSX that
            produces a different DOM than the one written here. */}
        <span aria-hidden>·</span>
        <span>Published {timestamp(run.createdAt)}</span>
      </p>
    </footer>
  )
}
