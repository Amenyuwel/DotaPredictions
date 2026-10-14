import { useId, useState, type ReactNode } from "react"

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

/**
 * One confirmation, for every destructive action on this page, and it asks you
 * to type the name back.
 *
 * A yes/no dialog is answered by muscle memory -- the second one you see today
 * is dismissed without being read, which makes it a speed bump rather than a
 * check. Typing the name cannot be done without reading what is being removed,
 * and it fails loudly when the wrong row's button was clicked: the name in the
 * box will not be the name in the title.
 *
 * The sentence still matters as much as the gate. Most removals here cascade,
 * and the cascade is the part nobody expects -- a stat takes every emblem
 * carrying it, a team takes its players -- so each request says what else goes.
 *
 * `reversible` draws the other line. Almost everything here is an entry in the
 * overlay that the Removed list puts back, while discarding a draft deletes the
 * row and cannot be undone. Two different sentences, so the difference is
 * stated rather than discovered.
 */

export interface ConfirmRequest {
  title: string
  /** What else this takes with it. Omitted when there genuinely is nothing. */
  detail?: ReactNode
  /** Typed back, exactly, before the button does anything. The name of the
   * thing being removed -- not a fixed word like "delete", which could be typed
   * without looking at which row was clicked. */
  confirmText: string
  confirmLabel: string
  /** True when the action only edits the draft, and the Removed list can undo
   * it. False for anything that writes through to the server. */
  reversible: boolean
  onConfirm: () => void
}

export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null
  onClose: () => void
}) {
  const [typed, setTyped] = useState("")
  const inputId = useId()
  const hintId = useId()

  // Cleared whenever a different action is asked about, adjusted during render
  // rather than in an effect. An effect would render the previous name once
  // before clearing it -- and a box that briefly already contains the answer is
  // the one thing this control must never do.
  const key = request?.confirmText ?? null
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setTyped("")
  }

  // Trimmed and case-insensitive. The point is that the name was read and
  // written out, not that the shift key was used; a reader who types
  // "camps stacked" has demonstrated everything this gate exists to check.
  const matches =
    request !== null && typed.trim().toLowerCase() === request.confirmText.trim().toLowerCase()

  // The words in the box and the words a screen reader hears, from one place.
  const hint = request ? `Type ${request.confirmText} to delete` : ""

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        {request ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!matches) return
              request.onConfirm()
              onClose()
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              {request.detail ? <DialogDescription>{request.detail}</DialogDescription> : null}
            </DialogHeader>

            <p className="text-muted-foreground text-xs">
              {request.reversible
                ? "Nothing public changes until you publish, and the Removed list puts this back before then."
                : "This cannot be undone."}
            </p>

            <div>
              {/* The instruction is the placeholder. It vanishes at the first
                  keystroke, which is normally the reason not to put one there,
                  and is survivable here only because the title carries the same
                  name and does not vanish. The label says the same words for
                  anyone who cannot see either. */}
              <label htmlFor={inputId} className="sr-only">
                {hint}
              </label>
              <Input
                id={inputId}
                value={typed}
                onChange={(event) => setTyped(event.currentTarget.value)}
                placeholder={hint}
                aria-describedby={hintId}
                autoComplete="off"
                autoFocus
              />
              {/* Nothing is drawn here. The button going from disabled to
                  enabled is the whole feedback, and that is silent -- so the
                  state is announced without being shown. */}
              <span id={hintId} className="sr-only" aria-live="polite">
                {typed.length > 0 && (matches ? "Name matches." : "Name does not match yet.")}
              </span>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!matches}>
                {request.confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
