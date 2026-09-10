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
  const stats = (axes.color && catalog.statsByColor.get(axes.color)) || []

  const change = (patch: Partial<Axes>) => {
    const next = { ...axes, ...patch }
    // A stat belongs to exactly one colour, so changing colour drops the stat
    // but keeps quality and trait -- those are colour-independent, and making
    // the user re-pick them would punish browsing.
    //
    // `"color" in patch` rather than a truthiness test, because clearing the
    // colour is a change of colour too. Miss that and the stat survives with
    // no list showing it: still counted by `resolve`, still saveable, and
    // invisible in the one field that could have told you it was there.
    if ("color" in patch && next.stat && catalog.colorOf(next.stat) !== next.color) {
      next.stat = null
    }
    setAxes(next)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        // Cancel sits in the footer and says what leaving means, so the
        // corner X would be the same exit offered twice.
        showCloseButton={false}
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
      >
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
                  onClear={() => change({ color: null })}
                  // The hue lives on the element, the recipe in the class names.
                  // Both come from colorStyle so they cannot be separated.
                  {...style.attrs}
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
          {/* An empty grid is a dead end, and with no colour chosen by default
              it is the first thing a new banner shows. Say which field is
              waiting rather than leaving a blank the user has to guess at. */}
          {!axes.color && (
            <p className="text-muted-foreground text-xs">Pick a colour first.</p>
          )}
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
                onClear={() => change({ stat: null })}
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
                onClear={() => change({ tier: null })}
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
                onClear={() => change({ trait: null })}
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
 * One option in a group, and every group here can be left with none chosen.
 *
 * A real radio behind a styled label, not a button with `aria-pressed`: radios
 * give arrow-key movement within the group and one Tab stop for the whole group
 * for free, and a group of five buttons does neither.
 *
 * What a radio will not do on its own is come back off, and every axis of an
 * emblem must -- nothing is chosen for the user, so every click has to be
 * undoable by the same click. Hence the pair of handlers, and hence `onClick`
 * alongside `onChange` rather than instead of it:
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
 * fires a click and takes it back off.
 */
function Choice({
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
