import { useState } from "react"
import { Bookmark, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Loading, Spinner } from "@/components/ui/spinner"
import {
  useDeleteRoster,
  useSaveRoster,
  useSavedRosters,
} from "@/hooks/use-saved-rosters"
import type { AuthState } from "@/hooks/use-session"
import { ROLE_ORDER, STAGE_LABEL } from "@/lib/labels"
import type { FantasyRole, Player, RunMeta } from "@/types/run"

/**
 * Save the three units on screen, and load them back.
 *
 * The banner tab's sibling, and the differences are the ones the two questions
 * have. A banner is saved one slot at a time because each is its own answer;
 * a roster is saved whole, because the three are picked together and the tab
 * adds their targets into one total. So there is no "which slot" control here,
 * and the save waits for all three rather than for any one.
 *
 * Only a complete roster can be saved, for the same reason only a complete
 * banner can: a partial one is not a cheaper version of the same thing, and two
 * slots restored a week later would look like a finished roster with a player
 * gone missing.
 */
export function SavedRosters({
  run,
  auth,
  roster,
  onLoad,
}: {
  run: RunMeta
  auth: AuthState
  /** The three slots as they stand. Null is a slot nobody is picked for. */
  roster: Record<FantasyRole, Player | null>
  onLoad: (players: { core: number; mid: number; support: number }) => void
}) {
  const [label, setLabel] = useState("")
  const signedIn = auth.status === "user"

  const saved = useSavedRosters(run.tournamentId, run.stage, signedIn)
  const save = useSaveRoster(run.tournamentId, run.stage)
  const remove = useDeleteRoster(run.tournamentId, run.stage)

  const short = ROLE_ORDER.filter((r) => roster[r] === null)
  const complete = short.length === 0

  if (!signedIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Saved rosters</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-xs">
          {auth.status === "unavailable"
            ? "This deployment has no sign-in configured, so nothing can be saved."
            : "You are using the tool as a guest. Targets work exactly the same; nothing is kept when you close the tab."}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Saved rosters</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!complete) return
            save.mutate(
              {
                tournamentId: run.tournamentId,
                stage: run.stage,
                players: {
                  core: roster.core!.playerId,
                  mid: roster.mid!.playerId,
                  support: roster.support!.playerId,
                },
                label: label.trim(),
              },
              { onSuccess: () => setLabel("") },
            )
          }}
        >
          <label htmlFor="roster-label" className="text-xs font-medium">
            Name this roster
          </label>
          <Input
            id="roster-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={complete ? nameOf(roster) : "My roster"}
            maxLength={80}
            autoComplete="off"
          />
          <Button type="submit" size="sm" disabled={!complete || save.isPending}>
            {save.isPending ? <Spinner className="size-4" /> : <Bookmark aria-hidden />}
            {save.isPending ? "Saving…" : "Save this roster"}
          </Button>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {!complete
              ? `Pick all three slots before saving - ${short.join(", ")} still to go.`
              : save.error
                ? `Could not save: ${save.error.message}`
                : ""}
          </p>
        </form>

        {saved.isPending ? (
          <div className="space-y-2" aria-busy>
            <Loading>Loading your saved rosters…</Loading>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : saved.error ? (
          <p className="text-destructive text-xs">
            Could not load your saved rosters: {saved.error.message}
          </p>
        ) : saved.data && saved.data.length > 0 ? (
          <ul className="space-y-1">
            {saved.data.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => onLoad(item.players)}
                >
                  <span className="truncate">{item.label || "Saved roster"}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${item.label || "saved roster"}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(item.id)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">
            Nothing saved yet for the {STAGE_LABEL[run.stage]}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** The three nicks, as a name to offer. Only ever a placeholder: a roster the
 * reader named keeps its own label, and this is what they get if they do not
 * bother to type one. */
const nameOf = (roster: Record<FantasyRole, Player | null>) =>
  ROLE_ORDER.map((r) => roster[r]?.nick)
    .filter(Boolean)
    .join(", ")
