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
  lockedColor = null,
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
  /** Stats standing in the OTHER slots. No stat may appear twice on a banner,
   * so these are unselectable rather than merely discouraged. */
  usedStats: Set<string>
  /**
   * The colour this slot must carry, when the slot has one.
   *
   * A banner slot always does: the colour of each slot is fixed by role -- Core
   * is red-green-red-green-red, Support has no red slot at all -- so offering
   * three colour buttons here would offer two choices that cannot be saved. The
   * colour is shown instead of asked for, and only its six stats are listed.
   *
   * Null for an inventory, where an emblem is not yet committed to a position.
   */
  lockedColor?: string | null
  onSave: (emblem: Emblem) => void
  onRemove: () => void
  onClose: () => void
}) {
  // A locked slot opens on its own colour rather than on nothing: there is no
  // choice to present, so presenting an empty one would be a dead end.
  const [axes, setAxes] = useState<Axes>(
    lockedColor ? { ...initial, color: lockedColor } : initial,
  )
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
            {lockedColor ? (
              <>
                This slot is <strong>{lockedColor}</strong>, fixed by the role - that is
                what decides which stats can sit here. Stat, quality and trait are all
                needed before the emblem scores anything.
              </>
            ) : (
              <>
                Colour picks which stats are on offer. All three of stat, quality and
                trait are needed before this emblem scores anything.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <Field label="Colour">
          <div className="grid grid-cols-3 gap-2">
            {(lockedColor ? [lockedColor] : catalog.colors).map((color) => {
              const style = colorStyle(color)
              const on = axes.color === color
              return (
                <Choice
                  key={color}
                  name={`emblem-${slot}-color`}
                  checked={on}
                  // A locked colour is the slot's, not a selection: it cannot be
                  // chosen because it is already true, and it cannot be cleared
                  // because there is nothing to clear it to.
                  disabled={lockedColor !== null}
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
                /* Two different reasons to be unpickable, and the label below
                   says which. A stat already on the banner is unavailable
                   *here*. A "no data" stat is unavailable because THIS TOOL
                   cannot value it -- not because it is worthless: the client's
                   own scoring list pays Lotuses Grabbed 176 per lotus. Blocking
                   it keeps the model from recommending something it is scoring
                   as 0, which is the honest reason and a narrower one. */
                disabled={usedStats.has(option.stat) || !option.measurable}
                onSelect={() => change({ stat: option.stat })}
                onClear={() => change({ stat: null })}
              >
                <span className="flex flex-col items-start text-left">
                  <span>{option.label}</span>
                  {!option.measurable && (
                    <span className="text-muted-foreground text-xs">
                      no data - this tool can't value it
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
