import { useId, useState } from "react"
import { ArrowUpRight, Bookmark, Trash2 } from "lucide-react"

import { DeleteDialog, type DeleteRequest } from "@/components/delete-dialog"
import { ResultPanel } from "@/components/result-panel"
import { AwaitingInput, RunError } from "@/components/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Choice } from "@/components/ui/choice"
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
  useDeleteBanner,
  useSaveBanner,
  useSavedBanners,
} from "@/hooks/use-saved-banners"
import { useRank } from "@/hooks/use-rank"
import type { AuthState } from "@/hooks/use-session"
import { timestamp } from "@/lib/format"
import { ROLE_LABEL, STAGE_LABEL } from "@/lib/labels"
import type { SavedBanner } from "@/lib/supabase"
import type { Emblem, FantasyRole, RunMeta } from "@/types/run"

const ROLES = ["core", "mid", "support"] as const

/**
 * Save a banner on screen, and see what a saved one ranks.
 *
 * Only complete banners can be saved. A partial banner is not a cheaper version
 * of the same question -- it is a different banner -- and a half-filled row
 * loaded back a week later would look like a finished answer.
 *
 * The tab holds three banners now, so saving needs to say which. It offers only
 * the slots whose banner is finished, and when exactly one is it does not ask
 * at all -- a control with a single option is a question with no answer to
 * give. Which slot a banner belongs to is not cosmetic: the role is what it is
 * SCORED against, and a support banner ranked through the core slot would be
 * measured against the wrong units and look like a finding.
 *
 * A row opens onto its own answer and nothing else. It does not write back into
 * the three builders, and the load that used to fire on the first click is
 * gone -- the roster card's rule, for the roster card's reason: a reader
 * checking what they saved last week has not asked for the five emblems they
 * are part-way through choosing to be thrown out, and a five-emblem banner is
 * expensive enough to rebuild that losing one silently is the worst thing this
 * list could do.
 *
 * Saving empties the builder it came from, the way the roster card empties its
 * three pickers. The banner is kept now, so leaving it on screen invites a
 * second save of the same emblems -- and the form would still be pointed at
 * that slot, so the second save is one press away. Only THAT slot is cleared:
 * the other two are different banners the reader is still building, and a save
 * is not a reason to throw them away.
 */
export function SavedBanners({
  run,
  auth,
  emblems,
  banners,
  slots,
  onSaved,
}: {
  run: RunMeta
  auth: AuthState
  /** Every emblem this run carries, for turning saved ids back into names. */
  emblems: Emblem[]
  /** One banner per fantasy slot, each ordered and null-padded. */
  banners: Record<FantasyRole, (Emblem | null)[]>
  slots: number
  /** Empty the builder for the slot that was just saved. Called once the save
   * has actually landed, never optimistically: clearing on submit would throw
   * the banner away on a save that then failed, and the error message would be
   * about a banner nobody can see any more. */
  onSaved: (role: FantasyRole) => void
}) {
  const [label, setLabel] = useState("")
  const [picked, setPicked] = useState<FantasyRole | null>(null)
  // One radio group per mount. A bare string would put this card's chips and
  // any other group on the page into one group -- see `Choice`.
  const group = `saved-banner-role-${useId()}`
  const [pending, setPending] = useState<DeleteRequest | null>(null)
  // Which row is open, held whole rather than by id: the list can refetch under
  // the dialog, and a row that went away would leave an id pointing at nothing
  // while its own box is still on screen.
  const [opened, setOpened] = useState<SavedBanner | null>(null)
  // Whether the open row has been asked for its ranking yet. Held beside
  // `opened` so that opening a row always starts on the emblems: kept inside
  // the dialog it would have to be reset on a prop change, and a row opening
  // straight onto the previous row's ranking is the one mistake a list of
  // near-identical banners must not make.
  const [showing, setShowing] = useState(false)
  const signedIn = auth.status === "user"

  const saved = useSavedBanners(run.tournamentId, run.stage, signedIn)
  const save = useSaveBanner(run.tournamentId, run.stage)
  const remove = useDeleteBanner()

  const emblemsOf = (r: FantasyRole) =>
    banners[r].filter((e): e is Emblem => e !== null)

  // An emblem this run no longer carries prints as its id rather than as a
  // name -- the account page's rule, and the same reason: a saved row still has
  // to be readable enough to delete on purpose.
  const nameOf = (() => {
    const byId = new Map(emblems.map((e) => [e.emblemId, e.displayName]))
    return (emblemId: string) => byId.get(emblemId) ?? emblemId
  })()
  const ready = ROLES.filter((r) => emblemsOf(r).length === slots)
  // The picked slot only counts while its banner is still complete: editing one
  // back down to four emblems must not leave the form pointed at it.
  const role = ready.find((r) => r === picked) ?? ready[0] ?? null
  const chosen = role ? emblemsOf(role) : []
  const complete = role !== null

  if (!signedIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Saved banners</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-xs">
          {auth.status === "unavailable"
            ? "This deployment has no sign-in configured, so nothing can be saved."
            : "You are using the tool as a guest. Rankings work exactly the same; nothing is kept when you close the tab."}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Saved banners</CardTitle>
      </CardHeader>

      {/* Same rhythm as the roster card next door, and set the same way: one
          `gap` per group rather than margins on the children. The two cards are
          peers, and a reader moving between the tabs should not be able to tell
          them apart by their spacing. */}
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
            if (!complete || !role) return
            save.mutate(
              {
                tournamentId: run.tournamentId,
                stage: run.stage,
                role,
                emblemIds: chosen.map((e) => e.emblemId),
                label: label.trim(),
              },
              {
                onSuccess: () => {
                  setLabel("")
                  onSaved(role)
                },
              },
            )
          }}
        >
          {/* Only shown when there is a choice to make. A control with a single
              option is a question with no answer to give, and the button below
              names the slot in that case instead. */}
          {ready.length > 1 && (
            <fieldset className="grid w-full gap-1.5">
              {/* The one place a margin does the spacing instead of the
                  container's `gap`: a `legend` is taken out of the fieldset's
                  grid flow, so the gap that separates every other label from its
                  control never applies to it. */}
              <legend className="mb-2 text-xs font-medium">Which banner</legend>
              {/* Peers sized by the group, not by their labels: "Support" is
                  half again as wide as "Mid", and three chips shrink-wrapped to
                  their words are three different targets for one kind of
                  choice. `grid-cols-3` makes them one size. */}
              <div className="grid grid-cols-3 gap-2">
                {ready.map((r) => (
                  <Choice
                    key={r}
                    name={group}
                    checked={r === role}
                    onSelect={() => setPicked(r)}
                    // Nothing to clear TO. `role` falls back to the first ready
                    // slot, so an empty group would immediately re-pick that one
                    // and the click would look like it did nothing.
                    onClear={() => {}}
                    className="justify-center"
                  >
                    {ROLE_LABEL[r]}
                  </Choice>
                ))}
              </div>
            </fieldset>
          )}

          {/* The field and what it has to say about itself are one group and sit
              tight together; the button is the next one. */}
          <div className="grid w-full gap-1.5">
            <label htmlFor="banner-label" className="text-xs font-medium">
              Name this banner
              <span className="text-muted-foreground ml-1 font-normal">· optional</span>
            </label>
            {/* Dead until a banner is finished, the same rule the roster card
                next door follows and for the same reason: this names what the
                button saves, and until one slot is complete there is nothing
                for a name to belong to. */}
            <Input
              id="banner-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={role ? `${ROLE_LABEL[role]} banner` : "Core banner"}
              maxLength={80}
              autoComplete="off"
              disabled={!complete}
              aria-describedby={complete ? undefined : "banner-save-hint"}
            />
            {/* Height reserved, so finishing a banner does not move the button
                out from under the thumb going for it. */}
            <p
              id="banner-save-hint"
              className="text-muted-foreground min-h-4 text-xs"
              aria-live="polite"
            >
              {!complete
                ? `Finish a banner - ${slots} emblems on any one slot - before saving.`
                : save.error
                  ? `Could not save: ${save.error.message}`
                  : ""}
            </p>
          </div>

          <Button
            type="submit"
            disabled={!complete || save.isPending}
            aria-describedby={complete ? undefined : "banner-save-hint"}
          >
            {save.isPending ? <Spinner className="size-4" /> : <Bookmark aria-hidden />}
            {/* The slot is named here only when nothing else on the card names
                it. With the chooser above, saying "Core" a third time -- after
                the chosen chip and the placeholder -- gives the reader two more
                copies of one fact to reconcile, and the chip is the one that is
                also the control. With one banner ready the chooser is gone, and
                then this is the only place that says which slot is about to be
                saved. */}
            {save.isPending
              ? "Saving…"
              : ready.length > 1
                ? "Save this banner"
                : role
                  ? `Save the ${ROLE_LABEL[role]} banner`
                  : "Save a banner"}
          </Button>
        </form>

        <Separator />

        {saved.isPending ? (
          <SkeletonPanel label="Loading your saved banners…">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </SkeletonPanel>
        ) : saved.error ? (
          <p className="text-destructive text-xs">
            Could not load your saved banners: {saved.error.message}
          </p>
        ) : saved.data && saved.data.length > 0 ? (
          <ul className="grid gap-2">
            {saved.data.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                {/* Outlined, for the reason the roster rows are: a ghost row
                    reads as a heading with a delete button beside it, and this
                    one is the way to the banner's ranking. */}
                <Button
                  variant="outline"
                  className="h-auto min-w-0 flex-1 justify-start gap-2 px-3 py-2.5"
                  aria-label={`Open ${item.label || `${ROLE_LABEL[item.role]} banner`}`}
                  onClick={() => {
                    setOpened(item)
                    setShowing(false)
                  }}
                >
                  <span className="truncate">
                    {item.label || `${ROLE_LABEL[item.role]} banner`}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                    {ROLE_LABEL[item.role]}
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${item.label || `${ROLE_LABEL[item.role]} banner`}`}
                  disabled={remove.isPending}
                  onClick={() =>
                    setPending({
                      title: `Delete ${item.label || `this ${ROLE_LABEL[item.role].toLowerCase()} banner`}?`,
                      // Numbered, because the order IS the banner: the same
                      // emblems in another order are a different one, and the
                      // order is how two similar rows are told apart.
                      detail: (
                        <ol className="grid gap-0.5">
                          {item.emblemIds.map((emblemId, slot) => (
                            <li key={`${emblemId}-${slot}`} className="truncate">
                              {slot + 1}. {nameOf(emblemId)}
                            </li>
                          ))}
                        </ol>
                      ),
                      confirmLabel: "Delete banner",
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
          /* An empty state says why it is empty AND what to do next. "Nothing
             saved yet" on its own leaves a reader who has never used the card to
             work out that the form above it is the way in. */
          <p className="text-muted-foreground text-xs">
            Nothing saved yet for the {STAGE_LABEL[run.stage]}. Finish a banner on any
            slot and save it here to keep it.
          </p>
        )}

        {remove.error ? (
          <p role="alert" className="text-destructive text-xs">
            Could not delete: {remove.error.message}
          </p>
        ) : null}
      </CardContent>

      <BannerRowDialog
        item={opened}
        run={run}
        emblems={emblems}
        slots={slots}
        showing={showing}
        onShow={() => setShowing(true)}
        onClose={() => setOpened(null)}
      />

      <DeleteDialog request={pending} onClose={() => setPending(null)} />
    </Card>
  )
}

/**
 * One saved banner: the emblems it names, in order, and then what wears it best.
 *
 * Two views in one box, the roster dialog's shape and for the same reasons. The
 * emblems come first because a row named "Core banner" has to be checked before
 * a ranking is read against it, and the resolution can only be stated here: an
 * id this run does not generate resolves to NOTHING, which the row has no way
 * to show.
 *
 * Numbered, because the order IS the banner. Vampiric charges each neighbour
 * -10% and Benevolent pays each +20%, so the same emblems in another order are
 * a different banner with a different answer -- the same reason the delete
 * confirmation numbers them, and the only thing that tells two near-identical
 * rows apart.
 *
 * It asks for the ranking ITSELF rather than handing the emblems to the page's
 * three builders. Those hold banners the reader is part-way through, and
 * answering a question about a saved one by overwriting an unsaved one is not
 * an answer, it is a cost. The query is keyed by run, role and emblem ids
 * exactly as the tab's own is, so a banner already on screen is a cache hit and
 * not a second request.
 *
 * A banner that does not fully resolve cannot be scored at all -- `useRank`
 * wants exactly `slots` emblems, and a four-emblem question is a different
 * banner rather than a rougher version of this one. The button says so and
 * stays dead, instead of opening onto a panel that quietly answers something
 * else.
 */
function BannerRowDialog({
  item,
  run,
  emblems,
  slots,
  showing,
  onShow,
  onClose,
}: {
  item: SavedBanner | null
  run: RunMeta
  emblems: Emblem[]
  slots: number
  showing: boolean
  onShow: () => void
  onClose: () => void
}) {
  // Resolved against THIS run's catalog rather than trusted: a banner saved
  // against an earlier run can name an emblem the current one does not
  // generate. An unresolved id stays null and is printed as its id, never as
  // whichever emblem happens to hold that string now.
  const resolved: (Emblem | null)[] = item
    ? Array.from(
        { length: slots },
        (_, i) =>
          emblems.find((e) => e.emblemId === item.emblemIds[i]) ?? null,
      )
    : []

  const missing = resolved.filter((e) => e === null).length
  const title = item ? item.label || `${ROLE_LABEL[item.role]} banner` : ""

  // Gated on the banner resolving AND on the reader having asked. `item.role`
  // rather than the slot the page is showing: the role is what the banner was
  // saved under and what it must be scored against.
  const ranked = useRank(
    resolved,
    item?.role ?? "core",
    slots,
    { tournamentId: run.tournamentId, stage: run.stage },
    showing && item !== null,
  )

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      {/* Wide and scrolling once the ranking is in it -- a ladder of units does
          not fit the box that held five lines. No X either way: the emblem list
          carries Cancel, and the ranking view has the one way out it needs. */}
      <DialogContent
        className={showing ? "max-h-[85dvh] overflow-y-auto sm:max-w-2xl" : "sm:max-w-sm"}
        showCloseButton={false}
      >
        {item ? (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {ROLE_LABEL[item.role]} · saved {timestamp(item.createdAt)}.
                {showing &&
                  " Nothing on this page has changed -- the three builders are as you left them."}
              </DialogDescription>
            </DialogHeader>

            {showing ? (
              ranked.isPending ? (
                <SkeletonPanel label="Scoring every unit through this banner…">
                  {/* Five, because five rungs is what the ladder comes back
                      with. A placeholder that reserves the wrong number of rows
                      still reflows. */}
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </SkeletonPanel>
              ) : ranked.error ? (
                <RunError error={ranked.error} />
              ) : ranked.data?.best ? (
                <ResultPanel answer={ranked.data} />
              ) : (
                <AwaitingInput compact>
                  No unit in this stage has a joint sample to score through this banner.
                </AwaitingInput>
              )
            ) : (
              <>
                <ol className="grid gap-2 rounded-lg border p-3 text-sm">
                  {resolved.map((emblem, slot) => (
                    <li
                      key={`${item.emblemIds[slot] ?? "empty"}-${slot}`}
                      className="flex items-baseline gap-3"
                    >
                      <span className="text-muted-foreground w-3 shrink-0 text-xs tabular-nums">
                        {slot + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {emblem ? (
                          emblem.displayName
                        ) : (
                          <span className="text-muted-foreground">
                            <code className="text-2xs">
                              {item.emblemIds[slot] ?? "—"}
                            </code>{" "}
                            — not in this run
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>

                <p className="text-muted-foreground text-xs">
                  {missing === 0
                    ? "Ranked here, on its own. Your three builders are left alone."
                    : `${missing} of these ${missing === 1 ? "emblem is" : "emblems are"} not in this run, and a banner short an emblem is a different banner rather than a rougher version of this one. There is nothing to rank.`}
                </p>
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                {showing ? "Done" : "Cancel"}
              </Button>
              {!showing && (
                <Button type="button" autoFocus disabled={missing > 0} onClick={onShow}>
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
