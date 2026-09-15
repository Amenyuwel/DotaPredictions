import type { ReactNode } from "react"
import { Undo2 } from "lucide-react"

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

/** One edited cell: the control, plus what the published run said when they
 * differ. Inline rather than on a second line, so a changed row is the same
 * height as an unchanged one. */
export function Cell({
  changed,
  was,
  children,
}: {
  changed: boolean
  was?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      {/* `aria-hidden` is wrong here -- this is the one piece of context that
          says the value is not the engine's -- so it is read, and kept short
          enough to be worth hearing on every cell of a changed row. */}
      {changed && was !== undefined ? (
        <span className="text-muted-foreground shrink-0 text-2xs tabular-nums">was {was}</span>
      ) : null}
    </div>
  )
}

/** A number, held as text until it parses.
 *
 * Binding straight to a number makes "-" and "1." unrepresentable, so the field
 * fights back halfway through every negative and every decimal, and an emptied
 * box becomes NaN -- which reaching an overlay is a stat that pays nothing while
 * looking deliberate. Committed on blur: a partially typed number is not one. */
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
        const parsed = Number(event.currentTarget.value)
        if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
        else event.currentTarget.value = String(value)
      }}
      className={cn("h-7 tabular-nums", width, changed && "border-primary/60 bg-primary/5")}
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
      className={cn("h-7", className, changed && "border-primary/60 bg-primary/5")}
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
