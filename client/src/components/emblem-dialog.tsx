import { useState } from "react"

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
import {
  colorStyle,
  signed,
  tierLabel,
  tierNumeral,
  traitDetail,
  traitLabel,
  type Axes,
  type EmblemCatalog,
} from "@/lib/emblem-catalog"
import { cn } from "@/lib/utils"
import type { Emblem, Scoring } from "@/types/run"

/**
 * Choose one emblem: its colour, stat, quality and trait.
 *
 * A modal rather than four controls in the banner list, because the four
 * choices belong to ONE emblem and the banner is five of them. Inline, the
 * controls needed a third of the screen each and the neighbouring emblems --
 * which is what Vampiric and Benevolent are actually about -- scrolled out of
 * view. Here the list stays five short rows and the choosing gets a room of its
 * own, with every option visible at once instead of behind a dropdown.
 *
 * Nothing leaves this dialog until Save. A half-made emblem is not a smaller
 * version of an emblem -- it scores nothing -- so it never reaches the banner
 * and never reaches the scorer.
 */
export function EmblemDialog({
  slot,
  initial,
  catalog,
  scoring,
  usedStats,
  onSave,
  onRemove,
  onClose,
}: {
  /** Zero-based, shown one-based. Position is an input to the score, not a
   * label: Vampiric charges each neighbour -10% and Benevolent pays each +20%. */
  slot: number
  initial: Axes
  catalog: EmblemCatalog
  scoring: Scoring | undefined
  /** Stats standing in the OTHER slots. A banner may repeat a colour but never a
   * stat, so these are unselectable rather than merely discouraged. */
  usedStats: Set<string>
  onSave: (emblem: Emblem) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [axes, setAxes] = useState<Axes>(initial)
  const resolved = catalog.resolve(axes)
  const stats = catalog.statsByColor.get(axes.color) ?? []

  const change = (patch: Partial<Axes>) => {
    const next = { ...axes, ...patch }
    // A stat belongs to exactly one colour, so switching colour drops the stat
    // but keeps quality and trait -- those are colour-independent, and making
    // the user re-pick them would punish browsing.
    if (patch.color && next.stat && catalog.colorOf(next.stat) !== patch.color) {
      next.stat = null
    }
    setAxes(next)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Emblem {slot + 1}</DialogTitle>
          <DialogDescription>
            Colour picks which stats are on offer. All three of stat, quality and trait
            are needed before this emblem scores anything.
          </DialogDescription>
        </DialogHeader>

        <Field label="Colour">
          <div className="grid grid-cols-3 gap-2">
            {catalog.colors.map((color) => {
              const style = colorStyle(color)
              const on = axes.color === color
              return (
                <Choice
                  key={color}
                  name={`emblem-${slot}-color`}
                  checked={on}
                  onSelect={() => change({ color })}
                  className={cn(
                    "justify-center text-xs font-semibold tracking-[0.12em] uppercase",
                    on ? style.selected : style.idle,
                  )}
                >
                  {color}
                </Choice>
              )
            })}
          </div>
        </Field>

        <Field label="Stat">
          {/* auto-rows-fr: one option carrying a second line must not make its row
                taller than the rest. Equal rows by rule, not by every option
                happening to hold the same amount of text. */}
          <div className="grid auto-rows-fr gap-2 sm:grid-cols-2">
            {stats.map((option) => (
              <Choice
                key={option.stat}
                name={`emblem-${slot}-stat`}
                checked={axes.stat === option.stat}
                /* Two different reasons to be unpickable, and the label below says
                   which. A stat already on the banner is unavailable *here*; a
                   "no data" stat is unavailable everywhere, because the client
                   marks it the same way in its own picker and an emblem carrying
                   one scores nothing for anyone. */
                disabled={usedStats.has(option.stat) || !option.measurable}
                onSelect={() => change({ stat: option.stat })}
              >
                <span className="flex flex-col items-start text-left">
                  <span>{option.label}</span>
                  {!option.measurable && (
                    <span className="text-muted-foreground text-xs">
                      no data — scores nothing
                    </span>
                  )}
                </span>
              </Choice>
            ))}
          </div>
        </Field>

        <Field label="Quality">
          <div className="grid grid-cols-5 gap-2">
            {catalog.tiers.map((tier) => (
              <Choice
                key={tier}
                name={`emblem-${slot}-tier`}
                checked={axes.tier === tier}
                onSelect={() => change({ tier })}
                className="flex-col justify-center gap-0.5 px-1 py-2.5"
              >
                {/* The numeral is the emblem's own stamp, so it is the loud part
                    and what it pays is the caption. */}
                <span className="text-base leading-none font-semibold tabular-nums">
                  {tierNumeral(tier)}
                </span>
                <span className="text-muted-foreground text-2xs tabular-nums">
                  {signed(scoring?.quality[tier] ?? 0)}
                </span>
                <span className="sr-only">{tierLabel(tier)}</span>
              </Choice>
            ))}
          </div>
        </Field>

        <Field label="Trait">
          <div className="grid auto-rows-fr gap-2">
            {catalog.traits.map((trait) => (
              <Choice
                key={trait}
                name={`emblem-${slot}-trait`}
                checked={axes.trait === trait}
                onSelect={() => change({ trait })}
              >
                <span className="flex min-w-0 flex-col items-start text-left">
                  <span className="text-xs font-semibold tracking-[0.12em] uppercase">
                    {traitLabel(trait)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {traitDetail(scoring, trait)}
                  </span>
                </span>
              </Choice>
            ))}
          </div>
        </Field>

        <DialogFooter className="sm:justify-between">
          {initial.stat ? (
            <Button variant="ghost" onClick={onRemove}>
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button disabled={!resolved} onClick={() => resolved && onSave(resolved)}>
              {resolved ? `Save ${resolved.displayName}` : "Save emblem"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A labelled group of choices. A `fieldset`/`legend` rather than a heading and
 * a div, so a screen reader announces "Trait" with each option in it. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-muted-foreground mb-2 text-2xs font-semibold tracking-[0.14em] uppercase">
        {label}
      </legend>
      {children}
    </fieldset>
  )
}

/**
 * One option in a group.
 *
 * A real radio behind a styled label, not a button with `aria-pressed`: radios
 * give arrow-key movement within the group and one Tab stop for the whole group
 * for free, and a group of five buttons does neither.
 */
function Choice({
  name,
  checked,
  disabled,
  onSelect,
  className,
  children,
}: {
  name: string
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <label
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
        className="sr-only"
      />
      {children}
    </label>
  )
}
