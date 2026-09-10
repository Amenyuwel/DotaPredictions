import { useState } from "react"
import { Bookmark, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useDeleteBanner,
  useSaveBanner,
  useSavedBanners,
} from "@/hooks/use-saved-banners"
import type { AuthState } from "@/hooks/use-session"
import { ROLE_LABEL } from "@/lib/labels"
import type { Emblem, FantasyRole, RunMeta } from "@/types/run"

/**
 * Save the banner on screen, and load one back.
 *
 * Only complete banners can be saved. A partial banner is not a cheaper version
 * of the same question -- it is a different banner -- and a half-filled row
 * loaded back a week later would look like a finished answer.
 */
export function SavedBanners({
  run,
  auth,
  role,
  banner,
  slots,
  onLoad,
}: {
  run: RunMeta
  auth: AuthState
  role: FantasyRole
  banner: (Emblem | null)[]
  slots: number
  onLoad: (role: FantasyRole, emblemIds: string[]) => void
}) {
  const [label, setLabel] = useState("")
  const signedIn = auth.status === "user"

  const saved = useSavedBanners(run.tournamentId, run.stage, signedIn)
  const save = useSaveBanner(run.tournamentId, run.stage)
  const remove = useDeleteBanner(run.tournamentId, run.stage)

  const chosen = banner.filter((e): e is Emblem => e !== null)
  const complete = chosen.length === slots

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
            if (!complete) return
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
          <label htmlFor="banner-label" className="text-xs font-medium">
            Name this banner
          </label>
          <Input
            id="banner-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={`${ROLE_LABEL[role]} banner`}
            maxLength={80}
            autoComplete="off"
          />
          <Button type="submit" size="sm" disabled={!complete || save.isPending}>
            <Bookmark aria-hidden />
            {save.isPending ? "Saving…" : "Save current banner"}
          </Button>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {!complete
              ? `Choose ${slots - chosen.length} more emblem${slots - chosen.length === 1 ? "" : "s"} before saving.`
              : save.error
                ? `Could not save: ${save.error.message}`
                : ""}
          </p>
        </form>

        {saved.isPending ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
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
            Nothing saved yet for the {run.stage === "main" ? "Main Event" : "Group Stage"}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
