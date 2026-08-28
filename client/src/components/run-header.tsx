import { AlertTriangle, Database } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { day, matchCount, timestamp } from "@/lib/format"
import type { RunMeta } from "@/types/run"

const STAGE_LABEL: Record<RunMeta["stage"], string> = {
  group: "Group Stage",
  main: "Main Event",
}

/**
 * Always on screen: which event, which stage, and how fresh the answer is.
 *
 * A projection with no visible date is indistinguishable from a stale one, and
 * a stale roster is this project's most expensive failure mode — it produces a
 * confident wrong number and no error. So the run timestamp and data window are
 * chrome, not a detail page.
 */
export function RunHeader({ run }: { run: RunMeta }) {
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">DotaPredictions</h1>
        <Badge variant="secondary">{run.tournamentId}</Badge>
        <Badge variant="outline">{STAGE_LABEL[run.stage]}</Badge>

        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />

        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Database className="size-3.5" aria-hidden />
          <span>
            {day(run.dataWindow.from)} – {day(run.dataWindow.to)},{" "}
            {matchCount(run.dataWindow.matchCount)}
          </span>
        </p>

        <p className="text-muted-foreground ml-auto text-xs">
          Published {timestamp(run.createdAt)}
        </p>

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
