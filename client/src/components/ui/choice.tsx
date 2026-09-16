import { cn } from "@/lib/utils"

/**
 * One option in a group, and every group here can be left with none chosen.
 *
 * A real radio behind a styled label, not a button with `aria-pressed`: radios
 * give arrow-key movement within the group and one Tab stop for the whole group
 * for free, and a group of buttons does neither. Three `aria-pressed` buttons
 * also announce as three independent toggles a reader could turn on at once,
 * which is not what "pick at most one" means. The group's NAME comes from the
 * `fieldset`/`legend` around it, so callers wrap these rather than labelling
 * each one.
 *
 * `name` is what makes a group a group, so every option in one passes the same
 * string and two groups on a page must never share one -- a component mounted
 * twice has to mix `useId` in, or picking in the second visibly unpicks the
 * first.
 *
 * What a radio will not do on its own is come back off, and the groups here
 * must: nothing is chosen for the user, so every click has to be undoable by
 * the same click. Hence the pair of handlers, and hence `onClick` alongside
 * `onChange` rather than instead of it:
 *
 *   - selecting an unchecked option fires `change`, and `click` too. The DOM
 *     sets checkedness during click dispatch but fires `input`/`change` after
 *     it, so `checked` here is still the pre-click value and the clause below
 *     correctly does nothing.
 *   - clicking the option that is already checked fires `click` and NOTHING
 *     else. That silence is the whole reason a radio cannot deselect itself,
 *     and it is the one signal `onClear` has to work with.
 *
 * Keyboard follows: arrows move between options and fire `change` only, so
 * browsing a group never clears it, while Space on the option already held
 * fires a click and takes it back off. A group that genuinely cannot be cleared
 * passes an `onClear` that does nothing, and says why.
 *
 * The box never changes with the state. Selected, hovered and disabled move
 * colour, weight and border only -- and the border is on every option from the
 * start, so the chosen one does not grow by a pixel and shift its neighbours.
 * `min-h-11` is 44px, because these are thumb targets.
 */
export function Choice({
  name,
  checked,
  disabled,
  onSelect,
  onClear,
  className,
  children,
  ...rest
}: {
  name: string
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  /** Called when the option that is already checked is clicked again. */
  onClear: () => void
  className?: string
  children: React.ReactNode
} & React.HTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      {...rest}
      className={cn(
        "flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-[color,background-color,border-color,box-shadow]",
        "hover:bg-accent has-[:focus-visible]:border-ring has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-3",
        checked
          ? "border-ring bg-secondary font-medium shadow-xs"
          : "border-input bg-linear-to-b from-transparent to-foreground/[0.02]",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        onClick={() => checked && onClear()}
        className="sr-only"
      />
      {children}
    </label>
  )
}
