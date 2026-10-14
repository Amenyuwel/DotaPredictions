import { useId, useState } from "react"
import { Plus, Undo2, UserRound, X } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Choice } from "@/components/ui/choice"
import { LANE_LABEL, LANE_ORDER, ROLE_LABEL, unitName } from "@/lib/labels"
import { unitOf } from "@/lib/units"
import { cn } from "@/lib/utils"
import type { FantasyRole, Player, Team } from "@/types/run"

/**
 * Choose the player whose banner is being built.
 *
 * A player, not a slot, because that is how anyone holds the question -- you
 * follow a team and you want to know what to put behind them. What gets SCORED
 * is still the slot: core and support are duos sharing one banner, and picking
 * either half picks the pair. The answer says so rather than this control
 * pretending otherwise, because the players who come back are the ones the run
 * actually has samples for and they are not always the two you expected.
 *
 * Only teams this stage projects are offered. A Main Event payload carries all
 * sixteen rosters and eight projections, so listing every team would put eight
 * knocked-out sides in the menu, each of them a pick that fails.
 *
 * A modal, not an inline control, because a player card wants room for a face
 * and a team mark, and the banner form above it is not the place to spend that
 * room. The team mark is `TeamWatermark`: the logo filling the card's right
 * side edge to edge, not a small inline icon -- a badge shrunk to text height
 * was both hard to read and, for a logo drawn in white, sometimes invisible
 * outright against the card. Hidden until the card is hovered, focused or
 * already chosen, so it reads as texture rather than competing with the
 * player names for attention at rest. Both images are hand-placed files at a
 * fixed path (`/players/{playerId}.jpg`, `/teams/{teamId}.jpg` -- see
 * `UnitAvatars` and `TeamWatermark`), not fetched or looked up anywhere --
 * dropping a file in is the entire integration step. Either can be missing
 * or fail to load, and both fall back to a plain glyph (`Face`) or nothing
 * (`TeamWatermark`) rather than a broken image icon.
 *
 * `roleFilter` narrows the roster to one fantasy role -- a full-roster builder
 * mounts three of these side by side (core, mid, support) and each must only
 * ever offer the players that answer its own question, or the same carry could
 * be picked for the support slot. With it set (the only way this is used
 * today) a team offers exactly one unit, so team and unit collapse into ONE
 * card -- a separate per-team header over a single-item list is a wrapper
 * around nothing. Core and support are still duos sharing one banner, so that
 * one card carries two names, not one: a carry and an offlane on separate
 * cards read as two choices when there is only one to make. `onSelect` hands
 * back a single `Player` (the pair's first member by lane order) because that
 * is all a caller needs to identify the unit; `value` is checked against
 * BOTH members so the card lights up no matter which half it was stored as.
 *
 * A pick can be taken back, from either side of the modal: an X beside the
 * closed trigger, and choosing the chosen card again inside it. Both hand
 * `null` to `onSelect`. Without them the first press on a slot was permanent --
 * every other team could be reached from there, and an EMPTY slot could not --
 * which on the roster tab meant a reader who mis-tapped a core had no way back
 * to the three-empty-slots state the tab opens in.
 */
export function UnitPicker({
  players,
  teams,
  stageTeamIds,
  roleFilter,
  placeholder = "Choose a player",
  value,
  onSelect,
}: {
  players: Player[]
  teams: Team[]
  stageTeamIds: number[]
  /** Restrict the roster to this fantasy role. Omitted shows the whole team. */
  roleFilter?: FantasyRole
  placeholder?: string
  /** The chosen player's id, or null before anything is chosen. */
  value: number | null
  /** The pick, or null to empty the slot. Null is not a failure to choose --
   * it is the reader taking a pick back, and the only way to do that. */
  onSelect: (player: Player | null) => void
}) {
  const [open, setOpen] = useState(false)
  // The player the X just took out, so one press can put them back. Undo
  // rather than a confirmation, the same trade as the banner builder: clearing
  // is safe to reverse, and asking every time taxes the reader who meant it.
  const [removed, setRemoved] = useState<Player | null>(null)
  // Three of these can be mounted at once (one full roster, three role
  // slots), and a bare string name would put all three radio groups' checks
  // into one group -- picking a mid would visually uncheck the chosen core.
  const groupName = `unit-picker-player-${useId()}`

  const inStage = new Set(stageTeamIds)
  const byId = new Map(players.map((p) => [p.playerId, p]))
  const teamById = new Map(teams.map((t) => [t.teamId, t]))

  // One card per unit, team carried alongside it rather than as a separate
  // header -- with `roleFilter` set that is one card per team, and without it
  // (unused today, kept correct anyway) a team with more than one role
  // present just yields more than one card naming the same team.
  const cards = teams
    .filter((team) => inStage.has(team.teamId))
    .flatMap((team) => {
      const roster = players
        .filter((p) => p.teamId === team.teamId)
        .filter((p) => roleFilter === undefined || p.fantasyRole === roleFilter)
        .sort((a, b) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane))
      return groupByUnit(roster).map((unit) => ({ team, unit }))
    })

  const hidden = teams.length - new Set(cards.map((c) => c.team.teamId)).size

  const selected = value === null ? null : byId.get(value)
  const selectedTeam = selected ? teamById.get(selected.teamId) : undefined
  // Through `unitOf` rather than a partner lookup written here, so the trigger
  // and the saved list name a unit the same way and in the same lane order.
  const selectedUnit = selected ? unitOf(players, selected.playerId) : []

  return (
    <div className="space-y-2">
      {/* The clear sits INSIDE the row's outline but is not inside its button:
          a sibling laid over the right edge, with the button padded clear of it
          so their hit areas never overlap. Beside the row it made every filled
          slot narrower than an empty one, so the column's right edge moved each
          time a player was picked -- the same fix as the banner builder's X. */}
      <div className="relative flex">
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-auto min-h-11 min-w-0 flex-1 justify-start py-2",
            // Room for the overlaid control, whichever one is showing: the X
            // (32px, 44px under a finger) or the wider Undo.
            selected && "pr-12 pointer-coarse:pr-14",
            !selected && removed && "pr-24",
            // Empty reads as a space waiting to be filled rather than as a
            // filled one reporting nothing -- the same rule, and the same
            // dashed edge, as the banner trigger on the other tab.
            !selected &&
              "border-input/70 text-muted-foreground hover:border-input border-dashed",
          )}
          onClick={() => setOpen(true)}
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2.5">
              <UnitAvatars unit={selectedUnit} />
              {/* `text-left`: a <button> centres its text, and these two lines
                  are full-width so they can truncate -- so without it a short
                  name floated in the middle of its row, off the avatars. */}
              <span className="flex min-w-0 flex-col items-start text-left">
                <span className="w-full truncate">{unitName(selectedUnit)}</span>
                <span className="text-muted-foreground w-full truncate text-xs">
                  {selectedTeam?.name ?? `team ${selected.teamId}`}
                </span>
              </span>
            </span>
          ) : (
            <>
              <Plus aria-hidden />
              {placeholder}
            </>
          )}
        </Button>

        {/* Only once there is something to take back. Quiet, not red: the
            removal is undoable, so it is not an alarm. */}
        {selected && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
            aria-label={`Remove ${unitName(selectedUnit)}`}
            onClick={() => {
              setRemoved(selected)
              onSelect(null)
            }}
          >
            <X aria-hidden />
          </Button>
        )}

        {/* The undo takes the X's place in the now-empty row, so the card does
            not grow a line to offer it. Gone the moment anything is picked. */}
        {!selected && removed && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute top-1/2 right-2 -translate-y-1/2"
            aria-label={`Undo removing ${unitName(unitOf(players, removed.playerId))}`}
            onClick={() => {
              onSelect(removed)
              setRemoved(null)
            }}
          >
            <Undo2 aria-hidden />
            Undo
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{placeholder}</DialogTitle>
            {/* The shortened field is said here, beside the list it describes,
                rather than under the closed trigger. Three of these mount at
                once in the roster tab, so outside it was the same sentence
                three times over -- and it is not about the player you picked,
                it is about the ones this list cannot offer. */}
            {/* The take-back is said here rather than left to be discovered.
                It is the only behaviour on this screen a reader has no way to
                guess from looking, and it is only true once a card is chosen --
                said unconditionally it would be an instruction about a state
                the reader is not in. */}
            <DialogDescription>
              {selected && "Tap the chosen card again to clear it. "}
              {hidden > 0 &&
                `${hidden} ${hidden === 1 ? "team isn't" : "teams aren't"} in this stage.`}
            </DialogDescription>
          </DialogHeader>

          {/* One radio group, one fieldset -- the per-team headers that used
              to split this into eight groups said nothing a card's own team
              row does not already say. auto-rows-fr keeps every card the same
              height regardless of name length, per the peer-sizing rule. */}
          <fieldset className="grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2">
            <legend className="sr-only">{placeholder}</legend>
            {cards.map(({ team, unit }) => {
              // Both halves of a duo carry the SAME unit, so either one
              // stored in `value` must light up this one card.
              const checked = unit.some((p) => p.playerId === value)
              const [first] = unit
              return (
                <Choice
                  key={`${team.teamId}:${first.playerId}`}
                  name={groupName}
                  checked={checked}
                  onSelect={() => {
                    setRemoved(null)
                    onSelect(first)
                    setOpen(false)
                  }}
                  // Choosing the chosen card again empties the slot -- the same
                  // take-back every emblem axis has, one gesture across both
                  // tabs. Both paths close the box: one press, one outcome. A
                  // reader wanting a different team clicks that team, and a
                  // reader clicking this one again has said they want the slot
                  // empty.
                  onClear={() => {
                    setRemoved(null)
                    onSelect(null)
                    setOpen(false)
                  }}
                  // Taller than a `Choice`'s default, because these hold two
                  // faces over two lines, and `relative`/`overflow-hidden` for
                  // the watermark that fills the right edge.
                  className="group relative min-h-16 gap-3 overflow-hidden p-3"
                >
                  <TeamWatermark teamId={team.teamId} />
                  <span className="relative z-10 shrink-0">
                    <UnitAvatars unit={unit} />
                  </span>
                  <span className="relative z-10 flex min-w-0 flex-col items-start gap-0.5">
                    <span className="text-muted-foreground truncate text-2xs font-semibold tracking-[0.12em] uppercase">
                      {team.name}
                    </span>
                    <span className="w-full truncate">{unitName(unit)}</span>
                    <span className="text-muted-foreground w-full truncate text-xs">
                      {unit.map((p) => LANE_LABEL[p.lane]).join(" · ")}
                      {roleFilter === undefined && ` · ${ROLE_LABEL[first.fantasyRole]}`}
                    </span>
                  </span>
                </Choice>
              )
            })}
          </fieldset>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Players on one team, grouped into the units that actually get scored: core
 * and support pair up (two lanes, one banner), mid stands alone. Grouped by
 * fantasy role rather than by lane pair, because that is the axis the server
 * scores on -- and it is what makes this safe to call on an already
 * `roleFilter`-narrowed roster, where only one role's players remain.
 */
function groupByUnit(roster: Player[]): Player[][] {
  const byRole = new Map<string, Player[]>()
  for (const player of roster) {
    const group = byRole.get(player.fantasyRole)
    if (group) group.push(player)
    else byRole.set(player.fantasyRole, [player])
  }
  return [...byRole.values()]
}

/** One member's face per unit, side by side -- never stacked, so a duo's two
 * photos stay as legible as a mid's one.
 *
 * Photos are looked up by a fixed convention (`/players/{playerId}.jpg`),
 * not a manifest -- they are added by hand, and `Face`'s own fallback on a
 * 404 is what makes "drop a file in, nothing else to touch" true. */
function UnitAvatars({ unit }: { unit: Player[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {unit.map((player) => (
        <Face
          key={player.playerId}
          src={`/players/${player.playerId}.jpg`}
          size={36}
          fallback={<UserRound className="size-4.5" />}
        />
      ))}
    </span>
  )
}

/**
 * The team's logo, filling the right side of the card edge-to-edge (full
 * height, no padding, no backing colour), revealed on hover, keyboard focus,
 * or once the card is the chosen one -- via `group-has-[]` on the label, the
 * same mechanism the label's own focus ring already uses. Silent (no
 * fallback glyph) when there is none, because a bare panel is a worse answer
 * than nothing.
 *
 * Looked up by a fixed convention (`/teams/{teamId}.jpg`), same as
 * `UnitAvatars` -- no fetch script, no manifest, dropping a file in front of
 * this path is the whole integration step.
 *
 * The left edge fades out on a mask rather than cutting off square -- a hard
 * rectangle dropped over rounded card content reads as a bug, not a border.
 * The card's own `overflow-hidden` clips the other three edges to its
 * border radius for free.
 */
function TeamWatermark({ teamId }: { teamId: number }) {
  const src = `/teams/${teamId}.jpg`
  const [failed, setFailed] = useState(() => MISSING_IMAGES.has(src))
  if (failed) return null

  return (
    <img
      aria-hidden
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        MISSING_IMAGES.add(src)
        setFailed(true)
      }}
      className={cn(
        "pointer-events-none absolute inset-y-0 right-0 z-0 w-3/5 object-cover opacity-0",
        "transition-opacity duration-200 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-has-[:checked]:opacity-100",
        "[mask-image:linear-gradient(to_right,transparent,black_40%)]"
      )}
    />
  )
}

/**
 * Image URLs that have already failed this session.
 *
 * Shared across every picker card and every open of the dialog: each face and
 * team watermark remounts when the list reopens, and with only per-component
 * state a missing photo was requested again every time -- dozens of requests
 * per open for files that are not there. One failure is enough to know.
 */
const MISSING_IMAGES = new Set<string>()

/**
 * One face: a real photo at `src` when it loads, a glyph in a circle
 * otherwise. The two states share a box -- `object-cover` on the image and
 * `bg-muted` circle on the fallback are the same size, so a photo resolving
 * after the fallback already painted does not reflow the card.
 *
 * Player photos tend to be tall torso shots, not square headshots, so a
 * small round crop centred on the image cuts off the face -- `object-top`
 * anchors the crop where the face actually is.
 */
function Face({
  src,
  size,
  fallback,
}: {
  src: string | undefined
  size: number
  fallback: React.ReactNode
}) {
  const [failed, setFailed] = useState(() => src !== undefined && MISSING_IMAGES.has(src))
  const box = { width: size, height: size }

  if (!src || failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-foreground/10"
        style={box}
      >
        {fallback}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded-full object-cover object-top ring-1 ring-foreground/10"
      style={box}
      onError={() => {
        MISSING_IMAGES.add(src)
        setFailed(true)
      }}
    />
  )
}
