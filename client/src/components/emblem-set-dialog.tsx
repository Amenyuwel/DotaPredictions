import { useState, type ReactNode } from "react"
import { Pencil, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * A room for one slot's emblems, and a one-line summary of them outside.
 *
 * Both tabs ask for three sets of emblems at once and each is a banner's worth,
 * so the sidebar was carrying up to fifteen emblem cards stacked above each
 * other -- the three questions a tab is actually asking pushed off the screen by
 * answers already settled. An emblem stops changing once it is entered, which
 * makes it the part that should fold away.
 *
 * What stays outside is the count, because that is the part still in flux: a
 * slot short of a full banner has nothing to arrange and cannot be scored at
 * all, and the trigger has to say so without being opened.
 *
 * Editing is live: an emblem saved inside is in the set immediately and the
 * query for this slot refires behind the dialog. So the footer says Done rather
 * than Save -- nothing is held back to commit, and a Cancel would be a promise
 * to undo that this does not keep.
 *
 * The shell is shared by the ordered banner and the unordered inventory because
 * every part of it here is the same decision for both, including the two that
 * look like styling and are not: the dashed empty state, and the scrim a nested
 * dialog cannot draw for itself. What differs between them is the wording and
 * the builder, so those are the props.
 */
export function EmblemSetDialog({
  summary,
  empty,
  title,
  description,
  children,
}: {
  /** The trigger's whole label. Written by the caller, because "3 of 5 emblems"
   * and "2 of 5 placed" are counting different things. */
  summary: string
  /** Nothing entered yet, which the trigger shows rather than reporting zero. */
  empty: boolean
  title: string
  /** Optional: a set whose title says enough takes none. */
  description?: ReactNode
  /** The builder. Mounted only while open, so a dialog that is shut costs
   * nothing and reopens on the current value rather than on a stale draft. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className={cn(
          "min-h-11 w-full justify-start",
          // Dashed while there is nothing in it, matching the add control it
          // stands in for: an empty slot should read as a space waiting to be
          // filled rather than as a filled one reporting zero.
          empty && "border-input/70 text-muted-foreground hover:border-input border-dashed",
        )}
      >
        {empty ? <Plus aria-hidden /> : <Pencil aria-hidden />}
        {summary}
      </Button>

      <DialogContent
        // Done sits in the footer and says what leaving means, so the corner X
        // would be the same exit offered twice.
        showCloseButton={false}
        // A nested dialog renders no backdrop of its own -- Base UI suppresses
        // it so the parent shows cleanly behind the one on top. Nothing would
        // then separate the two boxes, both being cards of about this width, so
        // this one dims itself while a child is open: the scrim that is missing
        // between them, put back on the layer that can still draw it.
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:bg-black/25 after:opacity-0 after:transition-opacity after:duration-100 data-nested-dialog-open:after:opacity-100"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        <DialogFooter>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
