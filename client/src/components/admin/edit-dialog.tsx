import { useState, type ReactNode } from "react"

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
 * Edit one row, in a box, and commit it in one go.
 *
 * The tables used to be live: every control wrote into the draft on blur, so
 * tabbing across a row left four separate edits behind and there was no moment
 * at which a row was "being changed" rather than changed. That is fine for a
 * form somebody is filling in and wrong for a table somebody is reading -- the
 * reading state is the common one here, and it should not be one stray click
 * away from an edit.
 *
 * So the row displays, and this holds the editing. What it owns is only the
 * plumbing every one of these needs: a copy of the value to work on, Cancel
 * throwing that copy away, Save handing it back once. The FIELDS are rendered
 * by the caller, because what a stat needs is not what a player needs and a
 * descriptor language that covered both would be a worse form library than the
 * one already in `cells.tsx`.
 *
 * Generic over the value so a caller keeps its own shape end to end -- no
 * `Record<string, unknown>` in the middle for every field to be cast out of.
 */
export function EditDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  value,
  onSave,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  /** The row as it stands. Copied on open; the original is never touched. */
  value: T
  onSave: (next: T) => void
  /** The fields, given the working copy and a way to change one of them. */
  children: (draft: T, set: <K extends keyof T>(key: K, next: T[K]) => void) => ReactNode
}) {
  const [draft, setDraft] = useState<T>(value)

  // Re-seeded whenever a different row is opened, adjusted during render rather
  // than in an effect: an effect would paint the previous row's numbers once
  // before replacing them, which on a table of near-identical rows is a flash
  // of the wrong data in a box titled with the right name.
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setDraft(value)
  }

  const set = <K extends keyof T>(key: K, next: T[K]) =>
    setDraft((current) => ({ ...current, [key]: next }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSave(draft)
            onOpenChange(false)
          }}
          className="grid gap-5"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <div className="grid gap-4">{children(draft, set)}</div>

          {/* Two meanings of "save" meet here, and conflating them is how an
              edit gets believed to be public when it is in a draft nobody has
              published. So it is said on the button's own bar rather than as a
              paragraph in the body: it is a caption on this action, identical in
              every one of these dialogs, and stacked above the footer it read as
              one more thing to weigh up in a box that had four already. The
              footer had the room standing empty. */}
          <DialogFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs">
              Saves into the draft. Nothing public changes until you publish.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One labelled field inside an edit dialog, with room reserved for what the
 * published run says so the box does not resize as values are changed. */
export function EditField({
  label,
  hint,
  was,
  children,
}: {
  label: string
  hint?: ReactNode
  /** The published value, when this field differs from it. */
  was?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid gap-1">
      {/* The control sits inside the label, which associates them without an id
          having to be threaded through every field component. */}
      <label className="grid gap-1">
        <span className="text-sm font-medium">{label}</span>
        {children}
      </label>
      <p className="text-muted-foreground min-h-4 text-xs">
        {was !== undefined ? <>Published run says {was}. </> : null}
        {hint}
      </p>
    </div>
  )
}
