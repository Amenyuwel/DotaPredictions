import { useId, useState } from "react"
import { AlertTriangle, CheckCircle2, Send } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Loading } from "@/components/ui/spinner"
import type { AdminConfig, OverlayPreview } from "@/types/admin"

/**
 * Everything that has to be true before an edit becomes public, in one place.
 *
 * These used to be four stacked banners down the page -- what is live, what is
 * unsaved, what would block a publish, what is worth knowing first -- above the
 * editor they were about. Four full-width alerts is not four times the warning;
 * it is a wall the reader scrolls past to reach the form, and the one that
 * mattered is indistinguishable from the three that did not.
 *
 * So the pre-publish considerations live here, at the moment they are
 * actionable. The page keeps only what is still in flux: a status chip, and a
 * blocked banner, because a blocked draft is a fact about the work in progress
 * rather than about publishing it.
 *
 * The note is required and the confirmation is a second, separate press. This
 * is the step where a number typed in a form starts appearing in projections
 * other people act on, and it should cost one deliberate motion more than
 * saving a draft does.
 */
export function PublishDialog({
  open,
  onOpenChange,
  config,
  preview,
  publishing,
  onPublish,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: AdminConfig
  preview: OverlayPreview | null
  publishing: boolean
  onPublish: (note: string) => void
}) {
  const [note, setNote] = useState("")
  const noteId = useId()
  const hintId = useId()

  // Cleared on each open rather than persisted. A note is about one publish,
  // and yesterday's sentence pre-filled under today's change is worse than an
  // empty box: it reads as deliberate.
  //
  // Adjusted during render by comparing the previous prop, not in an effect.
  // An effect would render the stale note once, then re-render with it cleared
  // -- visible as a flash of the last publish's sentence every time the dialog
  // opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setNote("")
  }

  const blocked = preview !== null && !preview.ok
  const tooShort = note.trim().length < 3
  const canPublish = !blocked && !tooShort && !publishing

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish to {config.scope.stage}</DialogTitle>
          <DialogDescription>
            {preview?.ok
              ? `${preview.changeCount} override${preview.changeCount === 1 ? "" : "s"} will apply to every visitor's projections.`
              : "This draft cannot be published yet."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {blocked ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>Fix these first</AlertTitle>
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
              <AlertTitle>Worth knowing</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 grid list-disc gap-1 pl-4">
                  {preview.notes.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {preview?.ok && preview.redundant.length > 0 ? (
            <Alert>
              <CheckCircle2 aria-hidden />
              <AlertTitle>These now match the published run</AlertTitle>
              <AlertDescription>
                <p>
                  A crawl has carried these into the run itself, so they change nothing
                  today. Drop them: an override that agrees with the run is a standing
                  instruction to hold that value if the run ever changes.
                </p>
                <p className="mt-1 font-mono text-xs break-all">
                  {preview.redundant.join(", ")}
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-1.5">
            <label htmlFor={noteId} className="text-sm font-medium">
              What does this change, and why?
            </label>
            <Input
              id={noteId}
              value={note}
              onChange={(event) => setNote(event.currentTarget.value)}
              placeholder="Client patch 7.42: Roshan now pays 1,340."
              aria-describedby={hintId}
              aria-invalid={note.length > 0 && tooShort}
              autoFocus
            />
            <p id={hintId} className="text-muted-foreground text-xs">
              Required. Every version here is one somebody may later need to revert to,
              and one with no note is one nobody can judge.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canPublish} onClick={() => onPublish(note.trim())}>
            {publishing ? <Loading>Publishing…</Loading> : <Send aria-hidden />}
            Make it live
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
