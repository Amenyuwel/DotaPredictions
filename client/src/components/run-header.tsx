import type { ReactNode } from "react"
import { AlertTriangle } from "lucide-react"

import { ThemeMenu } from "@/components/theme-menu"
import { Badge } from "@/components/ui/badge"
import { tournamentLabel } from "@/lib/labels"
import type { RunMeta } from "@/types/run"

/**
 * Which event, which stage, and the controls.
 *
 * The data window and publish time used to sit here and now sit in the footer.
 * The reason they were here has not gone away -- a projection with no visible
 * date is indistinguishable from a stale one, and that is this project's most
 * expensive failure mode, a confident wrong number with no error -- so what
 * moved is provenance and only provenance. The forced-gate badge stays: it is
 * not a date a reader might want, it is the run telling them a freshness check
 * was overridden to let it ship, and an alarm belongs beside the answer rather
 * than at the foot of the page.
 *
 * The stage is named once, by `stages`. A badge here saying "Main Event" beside
 * a control also saying "Main Event" reads as two facts, and the day they
 * disagree the badge is the one a reader believes.
 */
export function RunHeader({
  run,
  account,
  stages,
  help,
}: {
  run: RunMeta
  account?: ReactNode
  stages?: ReactNode
  /** The way into the FAQ. In the header rather than at the foot of the page
   * because the questions it answers are asked while a score is on screen, and
   * a reader with a number in front of them does not scroll past it to go and
   * read. */
  help?: ReactNode
}) {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4">
        <h1 className="font-heading text-base font-semibold tracking-tight">DotaPredictions</h1>
        <Badge variant="secondary">{tournamentLabel(run.tournamentId)}</Badge>

        {stages}

        {/* One item, not three. `ml-auto` on a bare control pushes only that
            control right and leaves the ones after it free to break off one at
            a time -- which is how the sign-in button ended up alone on a second
            line, under the title rather than under anything it belongs to.
            Grouped, the auto margin applies to the whole cluster, and the
            cluster stays right-aligned on whichever line it lands on, because
            an auto margin resolves per flex line. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-1 gap-y-2">
          {help}

          <ThemeMenu />

          {account}
        </div>

        {run.gatesForced.length > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3.5" aria-hidden />
            {run.gatesForced.length} freshness gate
            {run.gatesForced.length === 1 ? "" : "s"} overridden
          </Badge>
        )}
      </div>
    </header>
  )
}
