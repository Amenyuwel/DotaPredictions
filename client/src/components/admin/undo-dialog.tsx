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
 * What a row's override actually says, and the choice to keep or drop it.
 *
 * The rows used to carry this inline -- "1340 was 1172" beside every changed
 * value. That is the right information in the wrong place: it is only wanted
 * when somebody is deciding whether to keep the change, and the rest of the
 * time it doubles the width of a column that is otherwise one number.
 *
 * So the row shows what it currently says, and the undo control opens this. The
 * two values sit side by side here, where they can be compared without reading
 * around them, and every changed field of the row appears rather than only the
 * one whose cell was clicked.
 */

export interface ChangeRow {
  label: string
  /** What the published run says. `undefined` for a row the run does not carry
   * at all -- an added stat, a stand-in nobody has crawled yet. */
  was: ReactNode | undefined
  now: ReactNode
}

export function UndoDialog({
  open,
  onOpenChange,
  title,
  rows,
  onUndo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  rows: ChangeRow[]
  onUndo: () => void
}) {
  const isAddition = rows.length > 0 && rows.every((row) => row.was === undefined)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isAddition
              ? "This is not in the published run. Undoing removes it from the draft entirely."
              : "Undoing puts the published values back for this row."}
          </DialogDescription>
        </DialogHeader>

        {/* A real table: three columns of the same two facts per row is exactly
            what one is for, and the header is what says which column is which
            without repeating "was" on every line. */}
        <table className="w-full text-sm" aria-label="Published run against this draft">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th scope="col" className="pb-1 font-medium">Field</th>
              <th scope="col" className="pb-1 font-medium">Published run</th>
              <th scope="col" className="pb-1 font-medium">This draft</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                  {row.label}
                </th>
                <td className="text-muted-foreground py-1.5 pr-2 tabular-nums">
                  {row.was ?? "—"}
                </td>
                <td className="py-1.5 font-medium tabular-nums">{row.now}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <DialogFooter>
          {/* "Keep it" rather than "Cancel": both buttons are answers to the
              question in the title, and one of them being a dismissal makes the
              other look like the only action. */}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          {/* The default weight, not destructive red. Undoing returns the row to
              what is already public -- the safe direction -- and painting it as
              the dangerous choice spent the alarm colour on the one answer that
              cannot make a projection wrong. */}
          <Button
            onClick={() => {
              onUndo()
              onOpenChange(false)
            }}
          >
            Undo the change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
