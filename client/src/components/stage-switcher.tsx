import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { STAGE_LABEL, tournamentLabel } from "@/lib/labels"
import type { AvailableRun, Stage } from "@/types/run"

/**
 * Which published run the page is asking about.
 *
 * Built from what the server actually holds, never from a fixed list of stages.
 * A stage nobody has published does not appear, because a control that offers a
 * choice and then fails is worse than one that offers fewer choices honestly.
 *
 * The two stages are not versions of one answer. Different field, different
 * format, different banner size, different simulator -- so switching is a change
 * of question, and the result panel clears rather than appearing to update.
 *
 * A menu rather than a row of buttons, because the row stated the current stage
 * a second time: the header already named it, and beside it sat a highlighted
 * button with the same words. A closed menu shows exactly one stage -- the one
 * in force -- so there is one place on the page that answers "which stage is
 * this". With a single published run there is nothing to choose, so the control
 * renders as plain text instead of a menu that opens onto its own label.
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
  // More than one tournament in the list makes the stage name ambiguous on its
  // own -- two "Main Event" rows would be indistinguishable -- so the id joins
  // it. With one tournament the id is already in the header beside this.
  const manyTournaments = available.some(
    (run) => run.tournamentId !== available[0]?.tournamentId,
  )
  const label = (run: { tournamentId: string; stage: Stage }) =>
    manyTournaments
      ? `${tournamentLabel(run.tournamentId)} ${STAGE_LABEL[run.stage]}`
      : STAGE_LABEL[run.stage]

  if (available.length < 2) {
    return <p className="text-sm font-medium">{label(current)}</p>
  }

  const idOf = (run: { tournamentId: string; stage: Stage }) =>
    `${run.tournamentId}:${run.stage}`
  const byId = new Map(available.map((run) => [idOf(run), run]))

  return (
    <Select
      value={idOf(current)}
      onValueChange={(next) => {
        // The value is a composite key rather than a stage, because the list can
        // hold two tournaments and a stage alone would not say which run. An id
        // the list no longer holds is ignored instead of being coerced into the
        // first run: silently answering about a different tournament is the
        // failure this whole control exists to avoid.
        const run = byId.get(next as string)
        if (run) onSelect({ tournamentId: run.tournamentId, stage: run.stage })
      }}
    >
      <SelectTrigger size="sm" aria-label="Tournament stage">
        {/* Rendered from the value rather than from the chosen item's own
            markup, so the closed trigger shows the same words the menu did. */}
        <SelectValue>{(v: string) => label(byId.get(v) ?? current)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {available.map((run) => (
          <SelectItem key={run.runId} value={idOf(run)}>
            {label(run)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
