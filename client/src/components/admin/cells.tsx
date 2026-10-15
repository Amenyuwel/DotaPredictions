import type { ReactNode } from "react"
import { Pencil, Search, Trash2, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/**
 * The controls a dense editing table is built from.
 *
 * The editors used to render one card per stat and per trait, four stacked
 * labelled fields each. Eighteen stats that way is about five thousand pixels
 * of scrolling to check a table against the client -- and checking it against
 * the client is the whole job, which means comparing values that were never on
 * screen together.
 *
 * A table puts them on one screen. This is tabular data by any reading: the
 * same five attributes for every row, and the question asked of it is almost
 * always "which of these is wrong", not "what does this one say".
 *
 * Every control here is sized once, here, so a row cannot end up taller than
 * its neighbours because of what is in it (§5). Nothing grows when it changes:
 * the "was" marker sits inline on the same line and the undo keeps its box
 * whether or not it is shown.
 */

/** A number, held as text until it parses.
 *
 * Binding straight to a number makes "-" and "1." unrepresentable, so the field
 * fights back halfway through every negative and every decimal, and an emptied
 * box becomes NaN -- which reaching an overlay is a stat that pays nothing while
 * looking deliberate. Committed on blur: a partially typed number is not one.
 *
 * An emptied box is checked for by name. `Number("")` is 0 and finite, and a
 * `type="number"` input reports "" for anything it cannot parse, a lone "-"
 * included -- so testing the parse alone let clearing a field publish a stat
 * that pays nothing, the exact case this comment exists to prevent. */
export function NumberCell({
  value,
  onCommit,
  changed,
  width = "w-24",
  step,
}: {
  value: number
  onCommit: (next: number) => void
  changed?: boolean
  width?: string
  step?: string
}) {
  return (
    <Input
      // Remounts when the value changes from elsewhere, such as an undo.
      key={String(value)}
      type="number"
      inputMode="decimal"
      step={step ?? "any"}
      defaultValue={String(value)}
      onBlur={(event) => {
        const raw = event.currentTarget.value.trim()
        const parsed = Number(raw)
        if (raw !== "" && !event.currentTarget.validity.badInput && Number.isFinite(parsed)) {
          if (parsed !== value) onCommit(parsed)
        } else {
          event.currentTarget.value = String(value)
        }
      }}
      // A focused number input steps on the scroll wheel, so scrolling a form
      // past it edits it. Blurring first makes the wheel scroll the page.
      onWheel={(event) => event.currentTarget.blur()}
      className={cn(
        "h-7 tabular-nums pointer-coarse:h-11",
        width,
        changed && "border-primary/60 bg-primary/5",
      )}
    />
  )
}

/** A percentage, edited in the units the client shows and stored as the
 * fraction the scorer uses. Tier V is "+150%" on the emblem and 1.5 in the
 * table; asking an admin to convert is asking for the decimal-point mistake. */
export function PercentCell({
  value,
  onCommit,
  changed,
}: {
  value: number
  onCommit: (next: number) => void
  changed?: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      <NumberCell
        value={Math.round(value * 1000) / 10}
        onCommit={(percent) => onCommit(Math.round(percent * 10) / 1000)}
        changed={changed}
        width="w-20"
        step="0.1"
      />
      <span className="text-muted-foreground text-xs">%</span>
    </div>
  )
}

export function TextCell({
  value,
  onCommit,
  placeholder,
  changed,
  className,
}: {
  value: string
  onCommit: (next: string) => void
  placeholder?: string
  changed?: boolean
  className?: string
}) {
  return (
    <Input
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(event) => {
        const next = event.currentTarget.value
        if (next !== value) onCommit(next)
      }}
      className={cn("h-7 pointer-coarse:h-11", className, changed && "border-primary/60 bg-primary/5")}
    />
  )
}

export function SelectCell({
  value,
  options,
  onChange,
  label,
  format,
  changed,
  width = "w-32",
}: {
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (next: string) => void
  /** Never rendered, so the control still has an accessible name in a table
   * where the column header is the only visible label. */
  label: string
  format?: (value: string) => string
  changed?: boolean
  width?: string
}) {
  const show = format ?? ((v: string) => options.find((o) => o.value === v)?.label ?? v)
  return (
    <Select value={value} onValueChange={(next) => onChange(next as string)}>
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn(width, changed && "border-primary/60 bg-primary/5")}
      >
        <SelectValue>{(v: string) => show(v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Undo, keeping its box when there is nothing to undo, so a row does not
 * reflow the moment it is edited and shift the one the cursor is over. */
export function UndoCell({ changed, onRevert, what }: { changed: boolean; onRevert: () => void; what: string }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className={cn("size-7", !changed && "invisible")}
      aria-hidden={!changed}
      tabIndex={changed ? undefined : -1}
      onClick={onRevert}
      aria-label={`Undo the changes to ${what}`}
    >
      <Undo2 aria-hidden />
    </Button>
  )
}

/**
 * A filter over a list, with a live count.
 *
 * Both editors need one and they were the same control written twice -- a
 * search box, a count, and a live region announcing what the count became.
 * Two copies of that drift the moment one is edited, and the drift shows up as
 * one list announcing its filtering to a screen reader and the other not.
 */
export function FilterField({
  value,
  onChange,
  label,
  /** Rendered as-is, e.g. "12 of 18" or "16 teams". The caller knows what it is
   * counting; this only decides where it goes and that it is announced. */
  summary,
}: {
  value: string
  onChange: (next: string) => void
  label: string
  summary: string
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative min-w-0 flex-1 sm:max-w-xs">
        <span className="sr-only">{label}</span>
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={label}
          className="h-7 pl-7 pointer-coarse:h-11"
        />
      </label>
      {/* Wraps only the count, not the list: a live region around the table
          would re-read every row on each keystroke. */}
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums" aria-live="polite">
        {summary}
      </span>
    </div>
  )
}

/** What was removed, and the way back. One chip per entry, because restoring is
 * the only thing anyone does here and a chip is the smallest control that says
 * both what it was and that it can come back. */
export function RemovedChips({
  label,
  hint,
  entries,
  onRestore,
}: {
  label: string
  hint?: string
  entries: { key: string; label: string }[]
  onRestore: (key: string) => void
}) {
  if (entries.length === 0) return null
  return (
    <div className="grid gap-1.5 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">{label}</p>
      {hint ? <p className="text-muted-foreground max-w-prose text-xs">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        {entries.map((entry) => (
          <Button
            key={entry.key}
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onRestore(entry.key)}
          >
            <Undo2 aria-hidden />
            {entry.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * A labelled control that says what it was, and keeps its height.
 *
 * Used wherever a single value is edited outside a table -- a team's name, a
 * banner's slot colours. The reserved line under it is the point: two
 * conditional lines (the hint, and what the published run said) made every
 * field a different height depending on whether it had been touched, so a
 * column of them jumped as you worked down it.
 */
export function LabelledField({
  label,
  hint,
  changed,
  was,
  onUndo,
  children,
}: {
  label: string
  hint?: string
  changed: boolean
  /** What the published run says. Shown in place of the hint once changed,
   * because at that moment it is the more useful of the two. */
  was?: string
  onUndo: () => void
  children: ReactNode
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-end justify-between gap-2">
        {/* The control sits inside the label, which associates them without an
            id. Undo stays outside: a button inside a label activates that
            label's control, so undo would also focus what it just reset. */}
        <label className="grid min-w-0 flex-1 gap-1">
          <span className="text-xs font-medium">{label}</span>
          {children}
        </label>
        <UndoCell changed={changed} what={label} onRevert={onUndo} />
      </div>
      <p className="text-muted-foreground min-h-4 text-xs">
        {changed && was ? `was ${was}` : hint}
      </p>
    </div>
  )
}

/** Edit, undo and remove, in this order, because every editable thing on this
 * page offers exactly these three and they must not move between rows. */
export function RowActions({
  what,
  changed,
  onEdit,
  onUndo,
  onRemove,
}: {
  what: string
  changed: boolean
  onEdit: () => void
  onUndo: () => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <Button
        size="icon-sm"
        variant="ghost"
        className="size-7"
        aria-label={`Edit ${what}`}
        onClick={onEdit}
      >
        <Pencil aria-hidden />
      </Button>
      <UndoCell changed={changed} what={what} onRevert={onUndo} />
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-destructive size-7"
        aria-label={`Remove ${what}`}
        onClick={onRemove}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  )
}

/** A value a row only displays.
 *
 * What the published run said used to sit beside it -- "1340 was 1172" on every
 * changed cell. That is the right information in the wrong place: it is wanted
 * only when deciding whether to keep the change, and the rest of the time it
 * doubles the width of a column that is otherwise one number. The undo control
 * opens it now, for the whole row at once.
 *
 * Weight is what marks a changed value here, so the row still reads as edited
 * at a glance and keeps exactly one height either way. */
export function ValueCell({ value, changed }: { value: ReactNode; changed: boolean }) {
  return <span className={cn("tabular-nums", changed && "font-medium")}>{value}</span>
}

/**
 * "This holds unsaved or unpublished edits", as one mark everywhere.
 *
 * The rail, the scoring tabs and the team list each needed to say it, and the
 * team list said it with a bare dot whose only words were a `title` -- which a
 * screen reader does not read and a phone cannot hover. One component, so the
 * dot and the words travel together and look the same in all three places.
 */
export function EditedMark() {
  return (
    <>
      <span aria-hidden className="bg-foreground size-1.5 shrink-0 rounded-full" />
      <span className="sr-only">, has edits</span>
    </>
  )
}
