import { useId, useState } from "react"

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
 * One form for every "add a thing" on this page.
 *
 * All five of these were `window.prompt()`. That is a modal with no label, no
 * hint, no validation until after you commit, no way back from a typo except
 * starting again, and -- the part that actually matters -- no way to say WHY a
 * value was rejected. "New stat key (lower case, underscores):" followed by an
 * `alert()` explaining the rule after the fact is the rule arriving one step too
 * late.
 *
 * Here the rule sits under the field before anything is typed, the error
 * replaces it on blur, and both are wired to the input with `aria-describedby`
 * so a screen reader hears them in the same order a sighted reader does.
 *
 * Generic over its fields rather than five near-identical dialogs, for the
 * reason §5 gives: five copies of one form drift the moment one is edited, and
 * the drift shows up as two dialogs that validate the same key differently.
 */

export interface AddField {
  name: string
  label: string
  /** Sits under the input until something is wrong with it. */
  hint?: string
  placeholder?: string
  /** `inputmode` and `type`, for the numeric ones -- an OpenDota account id is
   * digits, and a phone keyboard should say so. */
  numeric?: boolean
  /** Returns an error message, or null when the value is acceptable. Validation
   * lives with the field rather than in the caller's submit handler, so the
   * message can appear next to the input that caused it. */
  validate?: (value: string) => string | null
}

export function AddDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  submitLabel = "Add",
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  fields: AddField[]
  submitLabel?: string
  onSubmit: (values: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const baseId = useId()

  // Reset on open, not on close. Clearing as it closes is visible for the
  // length of the exit animation, which reads as the form wiping itself before
  // it has finished leaving.
  //
  // Adjusted during render by comparing the previous prop, not in an effect: an
  // effect renders the stale values once and then clears them, which is a
  // flash of the last entry every time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setValues({})
      setErrors({})
    }
  }

  const check = (field: AddField, value: string): string | null => {
    if (!value.trim()) return `${field.label} is required.`
    return field.validate?.(value.trim()) ?? null
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    // Validated on submit, not per keystroke: a key is wrong for most of the
    // time it is being typed, and saying so the whole way is noise.
    const found: Record<string, string> = {}
    for (const field of fields) {
      const message = check(field, values[field.name] ?? "")
      if (message) found[field.name] = message
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return

    onSubmit(
      Object.fromEntries(fields.map((f) => [f.name, (values[f.name] ?? "").trim()])),
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-3">
          {fields.map((field, index) => {
            const id = `${baseId}-${field.name}`
            const describedBy = `${id}-note`
            const error = errors[field.name]
            return (
              <div key={field.name} className="grid gap-1.5">
                <label htmlFor={id} className="text-sm font-medium">
                  {field.label}
                </label>
                <Input
                  id={id}
                  autoFocus={index === 0}
                  inputMode={field.numeric ? "numeric" : undefined}
                  placeholder={field.placeholder}
                  value={values[field.name] ?? ""}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error || field.hint ? describedBy : undefined}
                  onChange={(event) => {
                    const next = event.currentTarget.value
                    setValues((prev) => ({ ...prev, [field.name]: next }))
                    // Clear the error as soon as it is being addressed. Leaving
                    // it until the next submit means the message describes a
                    // value that is no longer in the box.
                    if (error) setErrors((prev) => ({ ...prev, [field.name]: "" }))
                  }}
                />
                {/* One element for hint and error, so the row keeps its height
                    whichever is showing and the fields below do not jump. */}
                <p
                  id={describedBy}
                  className={error ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
                >
                  {error || field.hint}
                </p>
              </div>
            )
          })}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
