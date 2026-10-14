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
 * One confirmation, for every delete of something a reader saved.
 *
 * Deliberately a yes/no box, where `admin/confirm-dialog.tsx` makes you type
 * the name back. The difference is what sits behind the button. An admin
 * removal cascades -- a stat takes every emblem carrying it -- and lands on
 * everyone reading the published run; a saved roster is one row its owner made
 * and can make again in three clicks. A type-the-name gate here would be
 * ceremony with nothing behind it, and ceremony is what teaches people to click
 * through the gate that does matter.
 *
 * What it keeps is the part a yes/no box usually gets wrong: it names the row
 * and shows what is in it. These lists hold rows a reader never labelled, and
 * several of them look alike, so "Delete this roster?" would be answerable
 * without knowing which trash icon was clicked. The `detail` is the check --
 * the wrong row is visible before it goes, not after.
 *
 * Deleting closes the dialog immediately rather than waiting on the request.
 * The row is removed by a refetch and a failure is reported by the list itself,
 * so a dialog holding a spinner would be a second place telling the same story
 * and a third state to get wrong.
 */
export interface DeleteRequest {
  /** The question, with the row's own name in it. */
  title: string
  /** What the row holds. Omitted only when the title already says everything. */
  detail?: ReactNode
  confirmLabel: string
  onConfirm: () => void
}

export function DeleteDialog({
  request,
  onClose,
}: {
  request: DeleteRequest | null
  onClose: () => void
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      {/* No X. The box carries Cancel, and two ways out -- the wordless one
          more prominent than the labelled one -- is the choice asked twice. */}
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        {request ? (
          <>
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              <DialogDescription>
                This cannot be undone, and nothing else on screen changes.
              </DialogDescription>
            </DialogHeader>

            {request.detail ? (
              <div className="text-muted-foreground rounded-lg border p-3 text-xs">
                {request.detail}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              {/* Focused on open, because the reader who got here meant to
                  delete; Escape and Cancel are both still one key away. */}
              <Button
                type="button"
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
