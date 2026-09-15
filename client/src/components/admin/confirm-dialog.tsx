import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * One confirmation, for every destructive action on this page.
 *
 * The value is not the extra click -- it is the sentence. Most removals here
 * cascade, and the cascade is the part nobody expects: removing a stat takes
 * every emblem carrying it out of the catalog, and removing a team takes its
 * five players with it. A dialog that only asked "are you sure?" would add
 * friction and no information; each of these says what else goes.
 *
 * It also draws the line that matters. Almost everything here is reversible
 * until the draft is published -- the removal is an entry in the overlay, and
 * the Removed list puts it back -- while discarding a draft is not, because
 * that deletes the row. `reversible` is what decides which of those two
 * sentences the reader gets, so the difference is stated rather than left to be
 * discovered.
 */

export interface ConfirmRequest {
  title: string
  /** What else this takes with it. Omitted when there genuinely is nothing. */
  detail?: ReactNode
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
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {request ? (
          <>
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              {request.detail ? <DialogDescription>{request.detail}</DialogDescription> : null}
            </DialogHeader>

            <p className="text-muted-foreground text-xs">
              {request.reversible
                ? "Nothing public changes until you publish, and the Removed list below puts this back before then."
                : "This cannot be undone."}
            </p>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              {/* Destructive, and it says what it does rather than "OK" -- a
                  reader who opened this by accident should be able to tell the
                  two buttons apart without reading the title again. */}
              <Button
                variant="destructive"
                autoFocus
                onClick={() => {
                  request.onConfirm()
                  onClose()
                }}
              >
                {request.confirmLabel}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
