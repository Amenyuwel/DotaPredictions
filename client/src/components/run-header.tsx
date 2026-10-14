import type { ReactNode } from "react"
import { AlertTriangle, SlidersHorizontal } from "lucide-react"

import { ThemeMenu } from "@/components/theme-menu"
import { Badge } from "@/components/ui/badge"
import { tournamentLabel } from "@/lib/labels"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { OverlayStatus } from "@/types/admin"
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
  overlay,
  account,
  stages,
  help,
  menu,
}: {
  run: RunMeta
  /**
   * What was changed by hand after this run was published, or null/undefined
   * when nothing was.
   *
   * Beside the forced-gate badge because it is the same kind of statement: not
   * a date a reader might want, but the answer telling them something about how
   * it came to be. An override is not a fault -- it is usually a correction
   * that is MORE current than the crawl -- so it is stated, not warned about.
   * What would be a fault is it being invisible.
   */
  overlay?: OverlayStatus | null
  account?: ReactNode
  stages?: ReactNode
  /** The way into the FAQ. In the header rather than at the foot of the page
   * because the questions it answers are asked while a score is on screen, and
   * a reader with a number in front of them does not scroll past it to go and
   * read. */
  help?: ReactNode
  /** The same three controls as one button, for a header with no room to lay
   * them out. Drawn instead of them rather than beside them, so there is one
   * route to the theme at any given width and no chance of two open at once. */
  menu?: ReactNode
}) {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
        {/* The narrow header's first line, and the reason it is a line rather
            than three items left to wrap: the title, the badge and the stage
            control together are wider than 375px, so the menu button was the
            item that broke off -- ending up alone on a second row, hard right,
            under nothing it belongs to. At 320px the stage control went with
            it. Full width below `md` puts identity and the one menu on a line
            of their own and pushes the stage onto the next, which is a shape
            rather than an overflow. From `md` up the wrapper is `w-auto` and
            these sit inline again, exactly as before. */}
        <div className="flex w-full items-center gap-2 md:w-auto md:gap-3">
          {/* One step above a dialog title (16px), so the page's name is not
              the same size as the box that opens over it. */}
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            DotaPredictions
          </h1>
          {/* Plain text, not a pill: a chip beside the stage menu read as a
              second control, and it does nothing. */}
          <span className="text-muted-foreground text-sm font-medium">
            {tournamentLabel(run.tournamentId)}
          </span>

          {/* Help rides beside the menu on a phone rather than inside it: the
              FAQ is where a stranger finds out what the page is, and one more
              tap behind a hamburger is where nobody looks. */}
          <div className="ml-auto flex items-center gap-1 md:hidden">
            {help}
            {menu}
          </div>
        </div>

        {stages}

        {/* One item, not three. `ml-auto` on a bare control pushes only that
            control right and leaves the ones after it free to break off one at
            a time -- which is how the sign-in button ended up alone on a second
            line, under the title rather than under anything it belongs to.
            Grouped, the auto margin applies to the whole cluster, and the
            cluster stays right-aligned on whichever line it lands on, because
            an auto margin resolves per flex line. */}
        <div className="ml-auto hidden flex-wrap items-center justify-end gap-x-1 gap-y-2 md:flex">
          {help}

          <ThemeMenu />

          {account}
        </div>

        {overlay && overlay.changeCount > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Badge variant="outline" className="gap-1">
                  <SlidersHorizontal className="size-3.5" aria-hidden />
                  {overlay.changeCount} configuration override
                  {overlay.changeCount === 1 ? "" : "s"} (v{overlay.version})
                </Badge>
              }
            />
            <TooltipContent className="max-w-80">
              {overlay.note || "No reason was recorded."} Published{" "}
              {new Date(overlay.publishedAt).toLocaleString()}. These values were set by hand
              after the run was crawled, so they are newer than it rather than part of it.
            </TooltipContent>
          </Tooltip>
        )}

        {overlay?.failed && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="size-3.5" aria-hidden />
            configuration override not applied
          </Badge>
        )}

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
