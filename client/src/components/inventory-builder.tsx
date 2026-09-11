import { useMemo, useState } from "react"
import { Plus } from "lucide-react"

import { EmblemCard } from "@/components/emblem-card"
import { EmblemDialog } from "@/components/emblem-dialog"
import { Button } from "@/components/ui/button"
import { axesOf, buildCatalog, type Axes } from "@/lib/emblem-catalog"
import type { Emblem, Scoring } from "@/types/run"

/**
 * The emblems you own, which is the search space.
 *
 * Unordered and unsized, unlike the banner builder: the order is the answer
 * rather than the question, and the point of the list is that it is LONGER than
 * a banner -- the extras are what there is to choose between. Two emblems
 * carrying the same stat are both allowed here and never both placed, because
 * a banner may repeat a colour but never a stat; owning both is exactly the
 * choice this screen exists to resolve.
 *
 * The cap is the server's, shipped with the run rather than typed in here. It
 * is a latency bound and not a rule of the game -- owned emblems in five slots
 * is a permutation count, and one more emblem is several times the search --
 * so a second copy of the number in the browser would start refusing at the
 * wrong place the day it is tuned.
 */
export function InventoryBuilder({
  emblems,
  scoring,
  slots,
  max,
  value,
  onChange,
}: {
  emblems: Emblem[]
  /** Undefined only when the browser is replaying a cached `/api/run/current`
   * from a server that predates the field. See `buildCatalog`. */
  scoring: Scoring | undefined
  slots: number
  max: number
  value: Emblem[]
  onChange: (next: Emblem[]) => void
}) {
  const catalog = useMemo(() => buildCatalog(emblems, scoring), [emblems, scoring])
  /** The index being edited, or `value.length` for one being added. */
  const [editing, setEditing] = useState<number | null>(null)
  const [rejected, setRejected] = useState("")

  const save = (index: number, emblem: Emblem) => {
    // The same emblem twice is a redundant input: it can never be placed beside
    // itself, so the second copy costs search time and changes no answer. Said
    // out loud rather than folded silently, because a click that appears to do
    // nothing reads as a broken control.
    if (value.some((e, i) => i !== index && e.emblemId === emblem.emblemId)) {
      setRejected(`You already own ${emblem.displayName}.`)
      setEditing(null)
      return
    }
    const next = [...value]
    next[index] = emblem
    setRejected("")
    onChange(next)
    setEditing(null)
  }

  const remove = (index: number) => {
    setRejected("")
    onChange(value.filter((_, i) => i !== index))
    setEditing(null)
  }

  const opening = (index: number): Axes =>
    value[index]
      ? axesOf(value[index], catalog.colorOf)
      : { color: null, stat: null, tier: null, trait: null }

  const short = slots - value.length

  return (
    <div className="space-y-3">
      {/* A grid of controls rather than a list of them. The emblems have no
          order here -- that is the answer, not the input -- so numbering them
          or marking them up as a sequence would assert something false. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {value.map((emblem, i) => (
          <button
            key={emblem.emblemId}
            type="button"
            onClick={() => setEditing(i)}
            className="focus-visible:border-ring focus-visible:ring-ring/50 hover:bg-accent/40 rounded-lg text-left transition-colors focus-visible:ring-3"
          >
            <EmblemCard emblem={emblem} catalog={catalog} className="bg-transparent" />
            <span className="sr-only">Edit or remove {emblem.displayName}</span>
          </button>
        ))}

        {value.length < max && (
          <Button
            variant="outline"
            onClick={() => setEditing(value.length)}
            className="border-input/70 text-muted-foreground hover:border-input min-h-11 justify-start border-dashed"
          >
            <Plus aria-hidden />
            Add an emblem
          </Button>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {rejected ||
            (short > 0
              ? `A banner in this stage is ${slots} emblems. ${short} more before there is anything to arrange.`
              : `${value.length} of ${max}. Everything past ${slots} is what you have to choose between.`)}
        </p>
        {value.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRejected("")
              onChange([])
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {editing !== null && (
        <EmblemDialog
          // Remounted per slot, so the dialog's draft starts from the emblem
          // being edited rather than from whichever one was opened last.
          key={editing}
          slot={editing}
          initial={opening(editing)}
          catalog={catalog}
          scoring={scoring}
          // Empty on purpose. The banner builder forbids a stat already placed;
          // an inventory is not a banner, and owning a second emblem of a stat
          // you already own is the ordinary case -- you keep both and let the
          // search say which one earns the slot.
          usedStats={new Set()}
          onSave={(emblem) => save(editing, emblem)}
          onRemove={() => remove(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
