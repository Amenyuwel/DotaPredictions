import { useState } from "react"
import { AlertTriangle, CheckCircle2, Download, Save, Send, Trash2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loading } from "@/components/ui/spinner"
import type { AdminConfig, OverlayPreview } from "@/types/admin"

/**
 * What is live, what is drafted, and the one control that moves one into the
 * other.
 *
 * The whole safety model of this page is visible in this strip, so it says all
 * four things plainly rather than reducing them to a button that lights up:
 *
 *   live      the version the public site is being served right now
 *   draft     what has been saved and checked, and is not live
 *   unsaved   what is on screen, which has NOT been checked by anything
 *   blocked   why the draft cannot be published, in full
 *
 * Publish is disabled while there are unsaved edits, and that is not a nicety.
 * Validation happens on the server, against the run currently being served, and
 * a save is what runs it -- so publishing an unsaved document would mean
 * publishing one nothing has looked at.
 */
export function PublishBar({
  config,
  preview,
  dirty,
  saving,
  publishing,
  onSave,
  onPublish,
  onDiscard,
  onExport,
}: {
  config: AdminConfig
  preview: OverlayPreview | null
  dirty: boolean
  saving: boolean
  publishing: boolean
  onSave: () => void
  onPublish: (note: string) => void
  onDiscard: () => void
  onExport: () => void
}) {
  const [note, setNote] = useState("")
  const [confirming, setConfirming] = useState(false)

  const blocked = preview && !preview.ok
  const canPublish = Boolean(config.draft) && !dirty && !blocked && note.trim().length >= 3

  return (
    <div className="grid gap-3">
      <div className="bg-card flex flex-wrap items-center gap-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Live:</span>
          {config.live ? (
            <>
              <Badge>v{config.live.version}</Badge>
              <span className="text-muted-foreground text-xs">
                {config.live.changeCount} override{config.live.changeCount === 1 ? "" : "s"}, by{" "}
                {config.live.authorEmail || "unknown"} on{" "}
                {new Date(config.live.publishedAt).toLocaleString()}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground text-xs">
              none - the published run is being served exactly as the engine made it
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {dirty ? (
            <Badge variant="destructive" title="Not saved, and therefore not checked">
              unsaved
            </Badge>
          ) : config.draft ? (
            <Badge variant="outline">draft saved</Badge>
          ) : null}

          <Button size="sm" variant="outline" onClick={onExport} disabled={!preview?.ok}>
            <Download aria-hidden />
            Export YAML
          </Button>
          <Button size="sm" variant="outline" onClick={onSave} disabled={saving || !dirty}>
            {saving ? <Loading>Saving…</Loading> : <Save aria-hidden />}
            Save draft
          </Button>
          {config.draft ? (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onDiscard}>
              <Trash2 aria-hidden />
              Discard
            </Button>
          ) : null}
        </div>
      </div>

      {dirty ? (
        <Alert>
          <AlertTriangle aria-hidden />
          <AlertDescription>
            These edits have not been saved, so nothing has checked them yet. Validation runs
            on the server against the run being served now - save to see what this document
            would actually do.
          </AlertDescription>
        </Alert>
      ) : null}

      {blocked ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>This draft cannot be published</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 grid list-disc gap-1 pl-4">
              {preview.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {preview?.ok && preview.notes.length > 0 ? (
        <Alert>
          <AlertTriangle aria-hidden />
          <AlertTitle>Worth knowing before publishing</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 grid list-disc gap-1 pl-4">
              {preview.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {preview?.ok && preview.redundant.length > 0 ? (
        <Alert>
          <CheckCircle2 aria-hidden />
          <AlertTitle>These overrides now match the published run</AlertTitle>
          <AlertDescription>
            <p>
              A crawl has carried these corrections into the run itself, so they change
              nothing today. Drop them: an override that agrees with the run is a standing
              instruction to hold that value if the run ever changes, which is how a
              deliberate future edit gets silently reverted by something nobody remembers.
            </p>
            <p className="mt-1 font-mono text-xs">{preview.redundant.join(", ")}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="bg-card grid gap-2 rounded-lg border p-3">
        <label htmlFor="publish-note" className="text-sm font-medium">
          What does this change, and why?
        </label>
        <p className="text-muted-foreground text-xs">
          Required. Every version here is one somebody may later need to revert to, and one
          with no note is one nobody can judge.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="publish-note"
            value={note}
            onChange={(event) => {
              setNote(event.currentTarget.value)
              setConfirming(false)
            }}
            placeholder="Client patch 7.42: Roshan now pays 1,340."
            className="min-w-64 flex-1"
          />
          {confirming ? (
            <>
              <Button size="sm" disabled={publishing} onClick={() => onPublish(note.trim())}>
                {publishing ? <Loading>Publishing…</Loading> : <Send aria-hidden />}
                Yes, make it live
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={!canPublish} onClick={() => setConfirming(true)}>
              <Send aria-hidden />
              Publish
            </Button>
          )}
        </div>
        {confirming ? (
          // Said out loud rather than implied by the button's colour. This is the
          // step where a number typed in a form starts appearing in projections
          // other people act on.
          <p className="text-destructive text-xs" role="alert">
            This changes what every visitor sees. {preview?.ok ? preview.changeCount : 0} override
            {preview?.ok && preview.changeCount === 1 ? "" : "s"} will apply to{" "}
            {config.scope.tournamentId} / {config.scope.stage}.
          </p>
        ) : null}
      </div>
    </div>
  )
}
