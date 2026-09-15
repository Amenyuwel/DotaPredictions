import type { ReactNode } from "react"
import { Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * One editable value, shown against what was published.
 *
 * The rule every control here follows: a changed field says what it was. A form
 * that shows only the current value cannot answer the question an admin
 * actually has -- "is this number mine or the engine's" -- and that question is
 * the difference between a correction and an accident nobody has noticed yet.
 *
 * So a field that differs from the published run is marked, states the previous
 * value, and carries its own undo. Undo clears the OVERLAY entry rather than
 * typing the old number back in: an overlay that says "2.0" where the run
 * already says "2.0" is not nothing, it is a standing instruction to keep that
 * value if the run ever changes -- which is precisely the silent revert this
 * whole design is built to avoid.
 */

export function FieldRow({
  label,
  hint,
  changed,
  wasLabel,
  onRevert,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  changed: boolean
  /** What the published run says, rendered only when this field is changed. */
  wasLabel?: ReactNode
  onRevert?: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        // The border is there whichever state the row is in, transparent when
        // unchanged: one that APPEARS on change moves everything beside it by a
        // pixel, and a column of fields ripples as you edit one of them.
        "grid content-start gap-1 rounded-md border px-2.5 py-2 transition-colors",
        changed ? "border-primary/40 bg-primary/5" : "border-transparent",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {/* The control sits INSIDE the label, which associates the two without
            an id -- one generated here would have to be threaded through every
            field component to be of any use. The undo button stays outside it:
            a button inside a label activates that label's control when clicked,
            so "undo" would also focus the input it had just reset. */}
        <label className="grid min-w-0 flex-1 gap-1">
          <span className="text-sm font-medium">{label}</span>
          {children}
        </label>
        {onRevert ? (
          <Button
            size="sm"
            variant="ghost"
            // Hidden rather than absent while unchanged, so the row does not
            // reflow the moment a value is edited. `invisible` keeps the box;
            // aria-hidden and tabIndex keep it off the accessibility tree and
            // out of the keyboard order while it means nothing.
            className={cn("h-6 shrink-0 px-1.5 text-xs", !changed && "invisible")}
            aria-hidden={!changed}
            tabIndex={changed ? undefined : -1}
            onClick={onRevert}
            aria-label={`Undo the change to ${typeof label === "string" ? label : "this field"}`}
          >
            <Undo2 aria-hidden />
            Undo
          </Button>
        ) : null}
      </div>

      {/* One line for both, with a reserved height. Two conditional paragraphs
          gave every row a different height depending on whether it had been
          edited, so a column of fields jumped as you worked down it -- exactly
          the failure §5 describes, content resizing its own box.

          Announced, because an admin who changed a value by keyboard is the one
          most likely to have changed the wrong one. */}
      <p className="text-muted-foreground min-h-4 text-xs" aria-live="polite">
        {changed && wasLabel ? <>Published run says {wasLabel}. </> : null}
        {hint}
      </p>
    </div>
  )
}

/**
 * A number, held as TEXT until it parses.
 *
 * Binding a number input straight to state makes "1." and "-" unrepresentable,
 * so a value cannot be edited through those states -- the field fights back
 * halfway through every negative number and every decimal. Worse, an empty
 * field becomes NaN, and NaN reaching an overlay is a stat that pays nothing
 * while looking deliberate. So the text is the state, and only a value that
 * parses is committed upward.
 */
export function NumberField({
  value,
  onCommit,
  step,
  suffix,
}: {
  value: number
  onCommit: (next: number) => void
  step?: string
  suffix?: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="decimal"
        step={step ?? "any"}
        defaultValue={String(value)}
        // On blur rather than on change: a partially typed number is not a
        // number, and committing "2" on the way to "2.5" would ship an edit
        // nobody made. `key` resets the field when the value changes from
        // elsewhere, such as an undo.
        key={String(value)}
        onBlur={(event) => {
          const parsed = Number(event.currentTarget.value)
          if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed)
          else event.currentTarget.value = String(value)
        }}
        className="h-8 max-w-36 tabular-nums"
      />
      {suffix ? <span className="text-muted-foreground text-xs">{suffix}</span> : null}
    </div>
  )
}

/** A percentage, edited in the units the client shows and stored as the
 * fraction the scorer uses. Tier V is "+150%" on the emblem and 1.5 in the
 * table, and asking an admin to translate between the two is asking for the
 * decimal-point mistake this file exists to make visible. */
export function PercentField({
  value,
  onCommit,
}: {
  value: number
  onCommit: (next: number) => void
}) {
  return (
    <NumberField
      value={Math.round(value * 1000) / 10}
      onCommit={(percent) => onCommit(Math.round(percent * 10) / 1000)}
      step="0.1"
      suffix="%"
    />
  )
}

export function TextField({
  value,
  onCommit,
  placeholder,
}: {
  value: string
  onCommit: (next: string) => void
  placeholder?: string
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
      className="h-8"
    />
  )
}
