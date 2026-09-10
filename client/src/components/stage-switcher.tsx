import { Button } from "@/components/ui/button"
import type { AvailableRun, Stage } from "@/types/run"

const STAGE_LABEL: Record<Stage, string> = {
  group: "Group Stage",
  main: "Main Event",
}

/**
 * Which published run the page is asking about.
 *
 * Built from what the server actually holds, never from a fixed list of stages.
 * A stage nobody has published does not appear, because a control that offers a
 * choice and then fails is worse than one that offers fewer choices honestly.
 *
 * The two stages are not versions of one answer. Different field, different
 * format, different banner size, different simulator — so switching is a change
 * of question, and the result panel clears rather than appearing to update.
 */
export function StageSwitcher({
  available,
  current,
  onSelect,
}: {
  available: AvailableRun[]
  current: { tournamentId: string; stage: Stage }
  onSelect: (run: { tournamentId: string; stage: Stage }) => void
}) {
  if (available.length < 2) return null

  return (
    <nav aria-label="Tournament stage" className="flex flex-wrap items-center gap-1">
      {available.map((run) => {
        const active =
          run.tournamentId === current.tournamentId && run.stage === current.stage
        return (
          <Button
            key={run.runId}
            size="sm"
            variant={active ? "secondary" : "ghost"}
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect({ tournamentId: run.tournamentId, stage: run.stage })}
          >
            {available.some((other) => other.tournamentId !== run.tournamentId)
              ? `${run.tournamentId} ${STAGE_LABEL[run.stage]}`
              : STAGE_LABEL[run.stage]}
          </Button>
        )
      })}
    </nav>
  )
}
