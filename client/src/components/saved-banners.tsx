import { useState } from "react"
import { Bookmark, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton, SkeletonPanel } from "@/components/ui/skeleton"
// The spinner survives in one place here: the save button, which is acting
// rather than filling. Everything that fills uses a skeleton.
import { Spinner } from "@/components/ui/spinner"
import {
  useDeleteBanner,
  useSaveBanner,
  useSavedBanners,
} from "@/hooks/use-saved-banners"
import type { AuthState } from "@/hooks/use-session"
import { ROLE_LABEL, STAGE_LABEL } from "@/lib/labels"
import type { Emblem, FantasyRole, RunMeta } from "@/types/run"

const ROLES = ["core", "mid", "support"] as const

/**
 * Save a banner on screen, and load one back.
 *
 * Only complete banners can be saved. A partial banner is not a cheaper version
 * of the same question -- it is a different banner -- and a half-filled row
 * loaded back a week later would look like a finished answer.
 *
 * The tab holds three banners now, so saving needs to say which. It offers only
 * the slots whose banner is finished, and when exactly one is it does not ask
 * at all -- a control with a single option is a question with no answer to
 * give. Which slot a banner belongs to is not cosmetic: the role is what
 * `onLoad` puts it back into, and a support banner restored into the core card
 * would be scored against the wrong unit and look like a finding.
 */
export function SavedBanners({
  run,
  auth,
  banners,
  slots,
  onLoad,
}: {
  run: RunMeta
  auth: AuthState
  /** One banner per fantasy slot, each ordered and null-padded. */
  banners: Record<FantasyRole, (Emblem | null)[]>
  slots: number
  onLoad: (role: FantasyRole, emblemIds: string[]) => void
}) {
  const [label, setLabel] = useState("")
  const [picked, setPicked] = useState<FantasyRole | null>(null)
  const signedIn = auth.status === "user"

  const saved = useSavedBanners(run.tournamentId, run.stage, signedIn)
  const save = useSaveBanner(run.tournamentId, run.stage)
  const remove = useDeleteBanner()

  const emblemsOf = (r: FantasyRole) =>
    banners[r].filter((e): e is Emblem => e !== null)
  const ready = ROLES.filter((r) => emblemsOf(r).length === slots)
  // The picked slot only counts while its banner is still complete: editing one
  // back down to four emblems must not leave the form pointed at it.
  const role = ready.find((r) => r === picked) ?? ready[0] ?? null
  const chosen = role ? emblemsOf(role) : []
  const complete = role !== null

  if (!signedIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Saved banners</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-xs">
          {auth.status === "unavailable"
            ? "This deployment has no sign-in configured, so nothing can be saved."
            : "You are using the tool as a guest. Rankings work exactly the same; nothing is kept when you close the tab."}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Saved banners</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!complete || !role) return
            save.mutate(
              {
                tournamentId: run.tournamentId,
                stage: run.stage,
                role,
                emblemIds: chosen.map((e) => e.emblemId),
                label: label.trim(),
              },
              { onSuccess: () => setLabel("") },
            )
          }}
        >
          {/* Only shown when there is a choice to make. */}
          {ready.length > 1 && (
            <fieldset className="flex flex-wrap gap-1">
              <legend className="mb-1 text-xs font-medium">Which banner</legend>
              {ready.map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant={r === role ? "secondary" : "ghost"}
                  aria-pressed={r === role}
                  onClick={() => setPicked(r)}
                >
                  {ROLE_LABEL[r]}
                </Button>
              ))}
            </fieldset>
          )}

          <label htmlFor="banner-label" className="text-xs font-medium">
            Name this banner
          </label>
          <Input
            id="banner-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={role ? `${ROLE_LABEL[role]} banner` : "Core banner"}
            maxLength={80}
            autoComplete="off"
          />
          <Button type="submit" size="sm" disabled={!complete || save.isPending}>
            {save.isPending ? <Spinner className="size-4" /> : <Bookmark aria-hidden />}
            {save.isPending
              ? "Saving…"
              : role
                ? `Save the ${ROLE_LABEL[role]} banner`
                : "Save a banner"}
          </Button>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {!complete
              ? `Finish a banner - ${slots} emblems on any one slot - before saving.`
              : save.error
                ? `Could not save: ${save.error.message}`
                : ""}
          </p>
        </form>

        {saved.isPending ? (
          <SkeletonPanel label="Loading your saved banners…">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </SkeletonPanel>
        ) : saved.error ? (
          <p className="text-destructive text-xs">
            Could not load your saved banners: {saved.error.message}
          </p>
        ) : saved.data && saved.data.length > 0 ? (
          <ul className="space-y-1">
            {saved.data.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 flex-1 justify-start"
                  onClick={() => onLoad(item.role, item.emblemIds)}
                >
                  <span className="truncate">
                    {item.label || `${ROLE_LABEL[item.role]} banner`}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {ROLE_LABEL[item.role]}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${item.label || "saved banner"}`}
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
