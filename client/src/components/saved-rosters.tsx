import { useState } from "react"
import { ArrowUpRight, Bookmark, Trash2 } from "lucide-react"

import { DeleteDialog, type DeleteRequest } from "@/components/delete-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton, SkeletonPanel } from "@/components/ui/skeleton"
// The spinner survives in one place here: the save button, which is acting
// rather than filling. Everything that fills uses a skeleton.
import { Spinner } from "@/components/ui/spinner"
import {
  useDeleteRoster,
  useSaveRoster,
  useSavedRosters,
} from "@/hooks/use-saved-rosters"
import type { AuthState } from "@/hooks/use-session"
import { RosterAnswer } from "@/components/roster-answer"
import { useTarget } from "@/hooks/use-target"
import type { EmblemCatalog } from "@/lib/emblem-catalog"
import { timestamp } from "@/lib/format"
import { ROLE_LABEL, ROLE_ORDER, STAGE_LABEL, unitName } from "@/lib/labels"
import type { Roster } from "@/lib/roster"
import type { SavedRoster } from "@/lib/supabase"
import { unitOf } from "@/lib/units"
import type { FantasyRole, Player, RunMeta } from "@/types/run"

/**
 * Save the three units on screen, and load them back.
 *
 * The banner tab's sibling, and the differences are the ones the two questions
 * have. A banner is saved one slot at a time because each is its own answer;
 * a roster is saved whole, because the three are picked together and the tab
 * adds their targets into one total. So there is no "which slot" control here,
 * and the save waits for all three rather than for any one.
 *
 * Only a complete roster can be saved, for the same reason only a complete
 * banner can: a partial one is not a cheaper version of the same thing, and two
 * slots restored a week later would look like a finished roster with a player
 * gone missing.
 *
 * Every saved row names the three units it holds. The row opens, and the one
 * next to it deletes for good, so a list of rows all reading "Saved roster"
 * would make both of those a guess. The ids are resolved against the run on
 * screen -- `players` -- rather than stored as names, for the reason
 * `SavedRoster` gives: a roster follows people.
 *
 * A row opens onto its own ANSWER and nothing else. It does not write back into
 * the three pickers, and the old "Load this roster" is gone: a reader checking
 * what they saved last week has not asked for the roster they are building now
 * to be overwritten, and a control whose side effect is to delete unsaved work
 * is the wrong way to answer a question. So the dialog asks the projection for
 * itself -- see `RosterDialog` -- and everything it puts on screen disappears
 * with it.
 *
 * Saving clears the three pickers, through `onSaved`. The roster is kept now,
 * so leaving it on screen invites a second save of the same three -- and the
 * list below is where it lives from here.
 */
export function SavedRosters({
  run,
  auth,
  players,
  roster,
  slots,
  catalog,
  onSaved,
}: {
  run: RunMeta
  auth: AuthState
  /** Every player this run can score, for turning saved ids back into units. */
  players: Player[]
  /** The three slots as they stand. Null is a slot nobody is picked for. */
  roster: Record<FantasyRole, Player | null>
  /** Emblems per banner in this stage, for the answer a row opens onto. */
  slots: number
  /** Passed through to the same answer the page draws, which needs it to show
   * emblems the reader never picked off a list. */
  catalog: EmblemCatalog
  /** Empty the three pickers. Called once a save has actually landed, never
   * optimistically: clearing on submit would throw the roster away on a save
   * that then failed, and the error message would be about a roster nobody can
   * see any more. */
  onSaved: () => void
}) {
  const [label, setLabel] = useState("")
  const [pending, setPending] = useState<DeleteRequest | null>(null)
  // Which row is open, held whole rather than by id: the list can refetch
  // under the dialog, and a row that went away would leave an id pointing at
  // nothing while its own box is still on screen.
  const [opened, setOpened] = useState<SavedRoster | null>(null)
  // Whether the open row has been asked for its answer yet. Held beside
  // `opened` rather than inside the dialog so that opening a row always starts
  // on the slot list: kept in there it would have to be reset on a prop change,
  // and a row opening straight onto the previous row's answer is the one
  // mistake a dialog about two similar rosters must not make.
  const [showing, setShowing] = useState(false)
  const signedIn = auth.status === "user"

  const saved = useSavedRosters(run.tournamentId, run.stage, signedIn)
  const save = useSaveRoster(run.tournamentId, run.stage)
  const remove = useDeleteRoster()

  const short = ROLE_ORDER.filter((r) => roster[r] === null)
  const complete = short.length === 0

  if (!signedIn) {
    return (
      // One caption line rather than a card: a full card saying "nothing is
      // kept" sat at the weight of the three questions above it, and was the
      // largest thing on a guest's screen that asked nothing of them.
      <p className="text-muted-foreground px-1 text-xs text-pretty">
        {auth.status === "unavailable"
          ? "Saving isn't available here."
          : "Guest mode: everything works, nothing is saved."}
      </p>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Saved rosters</CardTitle>
      </CardHeader>

      {/* One rhythm per group, set with `gap` on each container rather than
          with margins on the children: the form, the list and the divider
          between them are three groups, and a stack of `space-y` siblings gave
          all four rows of the form the same weight as the gap between the form
          and the list. */}
      <CardContent className="grid gap-4">
        {/* `justify-items-end`, so the submit sits at the trailing edge: it is
            the last thing done here, and a form's commit belongs at the end of
            the reading order rather than under the first field. The groups above
            it take `w-full` back, because a label and its input are read from
            the leading edge whichever way the button faces. */}
        <form
          className="grid justify-items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!complete) return
            save.mutate(
              {
                tournamentId: run.tournamentId,
                stage: run.stage,
                players: {
                  core: roster.core!.playerId,
                  mid: roster.mid!.playerId,
                  support: roster.support!.playerId,
                },
                label: label.trim(),
              },
              {
                onSuccess: () => {
                  setLabel("")
                  onSaved()
                },
              },
            )
          }}
        >
          {/* The field and what it has to say about itself are one group and
              sit tight together; the button is the next one. */}
          <div className="grid w-full gap-1.5">
            <label htmlFor="roster-label" className="text-xs font-medium">
              Name this roster
              <span className="text-muted-foreground ml-1 font-normal">· optional</span>
            </label>
            {/* Dead until there are three units to name, for the reason the
                button below it is: this field names the thing the button saves,
                and there is nothing yet for a name to belong to. Typing one
                into a form that cannot be submitted is work the reader is
                invited to do and then has to hold on to while they go and fill
                the slots -- and the placeholder, which is the three units run
                together, has nothing to offer until they are picked. */}
            <Input
              id="roster-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={complete ? nameOf(roster, players) : "My roster"}
              maxLength={80}
              autoComplete="off"
              disabled={!complete}
              aria-describedby={complete ? undefined : "roster-save-hint"}
            />
            {/* Height reserved, so the row appearing does not push the button
                down the moment a slot is emptied. The reason the field and the
                button are dead is tied TO them with `aria-describedby`: a
                disabled control is silent to a screen reader, and "greyed out"
                is not a reason. */}
            <p
              id="roster-save-hint"
              className="text-muted-foreground min-h-4 text-xs"
              aria-live="polite"
            >
              {!complete
                ? `Pick ${short.map((r) => ROLE_LABEL[r].toLowerCase()).join(", ")} before saving.`
                : save.error
                  ? `Could not save: ${save.error.message}`
                  : ""}
            </p>
          </div>

          <Button
            type="submit"
            disabled={!complete || save.isPending}
            aria-describedby={complete ? undefined : "roster-save-hint"}
          >
            {save.isPending ? <Spinner className="size-4" /> : <Bookmark aria-hidden />}
            {save.isPending ? "Saving…" : "Save this roster"}
          </Button>
        </form>

        <Separator />

        {saved.isPending ? (
          <SkeletonPanel label="Loading your saved rosters…">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </SkeletonPanel>
        ) : saved.error ? (
          <p className="text-destructive text-xs">
            Could not load your saved rosters: {saved.error.message}
          </p>
        ) : saved.data && saved.data.length > 0 ? (
          <ul className="grid grid-cols-1 gap-2">
            {/* `grid-cols-1`, not a bare `grid`. An `auto` track is floored at
                the min-content of its widest item, and every row here holds a
                `truncate` span -- which is `whitespace-nowrap`, so its
                min-content is the WHOLE name. The track then grows past the
                card, `min-w-0` on the row does nothing about it (it lifts the
                automatic minimum, it does not cap an intrinsic contribution),
                and the card's `overflow-hidden` clips what is left over: a
                saved roster with its right-hand half simply gone. `grid-cols-1`
                is `minmax(0,1fr)`, which floors the track at zero and lets the
                truncation do the job it was asked to do. */}
            {saved.data.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                {/* Outlined rather than ghost. A ghost row reads as a
                    heading with a delete button beside it, and this one is the
                    way to the roster's projection. */}
                <Button
                  variant="outline"
                  className="h-auto min-w-0 flex-1 flex-col items-start gap-1 px-3 py-2.5 text-left whitespace-normal"
                  onClick={() => {
                    setOpened(item)
                    setShowing(false)
                  }}
                  aria-label={`Open ${item.label || namesOf(item, players)}`}
                >
                  <span className="w-full truncate text-sm font-medium">
                    {item.label || namesOf(item, players)}
                  </span>
                  <span className="text-muted-foreground w-full truncate text-xs font-normal">
                    {item.label ? `${namesOf(item, players)} · ` : ""}
                    {timestamp(item.createdAt)}
                  </span>
                </Button>
                {/* `icon`, not `icon-sm`: 32px is the smallest this should be
                    next to a 48px row, and it is a thumb target for a delete. */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${item.label || namesOf(item, players)}`}
                  disabled={remove.isPending}
                  onClick={() =>
                    setPending({
                      title: `Delete ${item.label || "this roster"}?`,
                      detail: (
                        <dl className="grid grid-cols-1 gap-0.5">
                          {ROLE_ORDER.map((r) => (
                            <div key={r}>
                              <dt className="inline">{ROLE_LABEL[r]}: </dt>
                              <dd className="text-foreground inline">
                                {unitNameOf(players, item.players[r], r)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ),
                      confirmLabel: "Delete roster",
                      onConfirm: () => remove.mutate(item.id),
                    })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          /* Why it is empty, and the way in. The banner card next door says the
             same thing the same way. */
          <p className="text-muted-foreground text-xs">
            Nothing saved yet for the {STAGE_LABEL[run.stage]}. Pick all three slots and
            save them here to keep the roster.
          </p>
        )}

        {remove.error ? (
          <p role="alert" className="text-destructive text-xs">
            Could not delete: {remove.error.message}
          </p>
        ) : null}
      </CardContent>

      <RosterDialog
        item={opened}
        run={run}
        players={players}
        slots={slots}
        catalog={catalog}
        showing={showing}
        onShow={() => setShowing(true)}
        onClose={() => setOpened(null)}
      />

      <DeleteDialog request={pending} onClose={() => setPending(null)} />
    </Card>
  )
}

/**
 * One saved roster: the three units it names, and then what they are worth.
 *
 * Two views in one box, because they are two halves of one question. The slot
 * list comes first so a row named "Main Roster" is checked before a number is
 * read against it, and the resolution can only be stated here: a slot this run
 * cannot fill comes back EMPTY, which the row's summary line has no way to
 * show.
 *
 * The slots are resolved by id AND by fantasy slot, rather than by id alone,
 * which is what the list's summary line does. The two differ in the case that
 * matters: a player this run carries in another slot resolves to a name for the
 * summary and to NOTHING here. `unitOf` takes the role for exactly that reason.
 *
 * Both names of a duo, never one. A core slot holding "Satanic" is a slot
 * holding Satanic and Noticed, and a saved roster printed one nick at a time is
 * one the reader cannot check against the roster in their client -- which is
 * the entire job of this view.
 *
 * It asks for the projection ITSELF rather than handing the roster to the
 * page's three pickers. Those hold a roster the reader is building, and
 * answering a question about a saved one by overwriting an unsaved one is not
 * an answer, it is a cost. The queries are keyed by run, role and team exactly
 * as the page's are, so a slot the page has already scored is a cache hit and
 * not a second request -- and `RosterAnswer` is the page's own, so the number
 * in here and the number out there cannot come to disagree.
 *
 * The answer is not asked for until the reader asks: `enabledWhen` is
 * `showing`, so a list of eight rosters opened and closed once each costs
 * nothing. There is nothing to ask when no slot resolves, and the button says
 * so instead of opening onto three empty cards.
 */
function RosterDialog({
  item,
  run,
  players,
  slots,
  catalog,
  showing,
  onShow,
  onClose,
}: {
  item: SavedRoster | null
  run: RunMeta
  players: Player[]
  slots: number
  catalog: EmblemCatalog
  showing: boolean
  onShow: () => void
  onClose: () => void
}) {
  const unitFor = (role: FantasyRole) =>
    item ? unitOf(players, item.players[role], role) : []

  const units: Record<FantasyRole, Player[]> = {
    core: unitFor("core"),
    mid: unitFor("mid"),
    support: unitFor("support"),
  }

  // The same shape the page's answer takes: one member per slot is all a
  // `SlotTargetCard` needs to know a slot is filled, and the two names it
  // prints come off the server's own answer rather than off this.
  const roster: Roster = {
    core: units.core[0] ?? null,
    mid: units.mid[0] ?? null,
    support: units.support[0] ?? null,
  }

  const missing = ROLE_ORDER.filter((r) => units[r].length === 0).length
  const nothing = missing === ROLE_ORDER.length

  // Three calls, written out rather than mapped, because they are hooks. Each
  // is gated on its own slot resolving AND on the reader having asked, so a
  // roster with a knocked-out support asks two questions and not three.
  const target = { tournamentId: run.tournamentId, stage: run.stage }
  const unitKey = (role: FantasyRole) =>
    units[role].length > 0 ? { teamId: units[role][0].teamId, role } : null

  const targets = {
    core: useTarget(unitKey("core"), target, "realistic", showing),
    mid: useTarget(unitKey("mid"), target, "realistic", showing),
    support: useTarget(unitKey("support"), target, "realistic", showing),
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Wide and scrolling once the answer is in it -- three slot cards and a
          total do not fit the box that held three lines. No X either way: the
          slot list carries Cancel, and the answer view has the one way out it
          needs. */}
      <DialogContent
        className={
          showing
            ? "max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
            : "sm:max-w-sm"
        }
        showCloseButton={false}
      >
        {item ? (
          <>
            <DialogHeader>
              <DialogTitle>{item.label || namesOf(item, players)}</DialogTitle>
              <DialogDescription>
                Saved {timestamp(item.createdAt)}
              </DialogDescription>
            </DialogHeader>

            {showing ? (
              <RosterAnswer
                roster={roster}
                targets={targets}
                run={target}
                slots={slots}
                catalog={catalog}
              />
            ) : (
              <>
                <dl className="grid gap-2 rounded-lg border p-3 text-sm">
                  {ROLE_ORDER.map((role) => (
                    <div key={role} className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground text-xs">{ROLE_LABEL[role]}</dt>
                      <dd className="min-w-0 truncate text-right">
                        {units[role].length > 0 ? (
                          unitName(units[role])
                        ) : (
                          /* The id, not a name looked up by id alone. Whoever
                             holds that number in this run is not necessarily
                             who was saved, and a wrong name is worse than a
                             bare id. */
                          <span className="text-muted-foreground">
                            <code className="text-2xs">#{item.players[role]}</code> — not in
                            this run
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>

                <p className="text-muted-foreground text-xs">
                  {nothing
                    ? "None of these players are in this run."
                    : missing > 0
                      ? `${missing} ${missing === 1 ? "slot isn't" : "slots aren't"} in this run, so there's no total.`
                      : null}
                </p>
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {showing ? "Done" : "Cancel"}
              </Button>
              {!showing && (
                <Button type="button" autoFocus disabled={nothing} onClick={onShow}>
                  See the answer
                  <ArrowUpRight aria-hidden />
                </Button>
              )}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
/**
 * A saved slot as a name.
 *
 * Both halves of a duo, through `unitOf`, because one nick is not the slot: a
 * core reading "Satanic" and a core reading "Satanic & Noticed" are the same
 * saved row, and only the second can be checked against a client.
 *
 * A slot the run cannot fill comes back as its bare id rather than as whoever
 * holds that number now -- the same rule the account page follows, and the same
 * reason: a wrong name is worse than a bare id.
 *
 * `role` is passed wherever the caller is about to act on the slot, and left
 * off where the line only says what was SAVED. The two differ for a player this
 * run carries in another fantasy slot: named loosely they have a name, and
 * strictly they are not in that slot at all.
 */
const unitNameOf = (players: Player[], id: number, role?: FantasyRole) => {
  const unit = unitOf(players, id, role)
  return unit.length > 0 ? unitName(unit) : `#${id}`
}

/** The three slots run together, truncated to the width of a row -- enough to
 * tell two rosters apart, not enough to check one. The dialog is where a row is
 * checked. */
const namesOf = (item: SavedRoster, players: Player[]) =>
  ROLE_ORDER.map((r) => unitNameOf(players, item.players[r])).join(", ")

/** The three units, as a name to offer. Only ever a placeholder: a roster the
 * reader named keeps its own label, and this is what they get if they do not
 * bother to type one. */
const nameOf = (roster: Record<FantasyRole, Player | null>, players: Player[]) =>
  ROLE_ORDER.map((r) => {
    const picked = roster[r]
    return picked ? unitName(unitOf(players, picked.playerId)) : null
  })
    .filter(Boolean)
    .join(", ")
