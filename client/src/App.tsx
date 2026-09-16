import { useMemo, useState, type ReactNode } from "react"

import { AccountMenu } from "@/components/account-menu"
import { AnswerBar, type AnswerSummary } from "@/components/answer-bar"
import { AuthDialog } from "@/components/auth-dialog"
import { BannerDialog } from "@/components/banner-dialog"
import { FaqButton, FaqDialog } from "@/components/faq"
import { ResultPanel } from "@/components/result-panel"
import { RoleTabs } from "@/components/role-tabs"
import { RosterAnswer } from "@/components/roster-answer"
import { RunHeader } from "@/components/run-header"
import { SavedBanners } from "@/components/saved-banners"
import { SavedRosters } from "@/components/saved-rosters"
import { SiteFooter } from "@/components/site-footer"
import { SiteMenu } from "@/components/site-menu"
import { StageSwitcher } from "@/components/stage-switcher"
import { AwaitingInput, LoadingRun, RunError } from "@/components/states"
import { ThemeMenu } from "@/components/theme-menu"
import { UnitPicker } from "@/components/unit-picker"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton, SkeletonPanel } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildCatalog } from "@/lib/emblem-catalog"
import { points } from "@/lib/format"
import { ROLE_DETAIL, ROLE_LABEL, ROLE_ORDER } from "@/lib/labels"
import { rosterTotal, type Roster } from "@/lib/roster"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useTarget } from "@/hooks/use-target"
import { useRank } from "@/hooks/use-rank"
import { useRun } from "@/hooks/use-run"
import { useSession } from "@/hooks/use-session"
import type { Emblem, FantasyRole, Player, Stage } from "@/types/run"

const EMPTY_ROSTER: Roster = { core: null, mid: null, support: null }

/** Both tabs ask their question three times, once per fantasy slot, so the
 * empty state is the same shape on either side. */
const EMPTY_BANNERS: Record<FantasyRole, (Emblem | null)[]> = {
  core: [],
  mid: [],
  support: [],
}

/**
 * A banner at exactly this stage's length, padded with empty slots.
 *
 * Held state is `[]` until something is placed, and the two stages have
 * different banner sizes -- so a banner carried into a render before `slots` is
 * known, or one left over from a stage with three slots, would otherwise reach
 * the builder at the wrong length. Padding rather than truncating: a five-slot
 * array trimmed to three is a different banner scored as if it were this one.
 */
const sized = (banner: (Emblem | null)[], slots: number): (Emblem | null)[] =>
  banner.length === slots ? banner : Array.from({ length: slots }, (_, i) => banner[i] ?? null)

/**
 * Two mirrored entry paths, one column of answers.
 *
 * Both are three questions rather than one, and they are the SAME three: core,
 * mid and support, in that order, on either tab. The client scores those three
 * independently and adds them, so there is no cross-slot interaction to model
 * on either side -- which is what makes one column of stacked answers honest
 * rather than a layout convenience.
 *
 * "I have a banner" fixes the emblems, one banner per slot, and ranks the units
 * that could stand behind each. "My roster" fixes the units and names the
 * banner each should be hunting -- searched over the whole catalog, so that
 * answer is a goal rather than a verdict on what you happen to hold.
 *
 * The roster tab asks for units and nothing else. An inventory of already-rolled
 * emblems used to sit under each slot, answering "what is the best of what I
 * hold tonight" -- a different question, and one that pushed the answer it was a
 * footnote to further down a column that was already too long to compare across.
 * Which answer is on the right depends on which tab is open, so the tabs are
 * controlled here rather than left to themselves -- an answer to the question
 * you are not looking at is worse than no answer, because it is still a
 * number.
 */
export default function App() {
  // Null means "whatever the server considers newest", which is what a cold
  // load asks. It becomes concrete the moment the reader picks a stage.
  const [selected, setSelected] = useState<{ tournamentId: string; stage: Stage } | null>(
    null,
  )
  const { data, isPending, error } = useRun(selected?.tournamentId, selected?.stage)
  const auth = useSession()
  const [tab, setTab] = useState("banner")

  // The FAQ's open state, held here rather than inside the header button:
  // the dialog is a sibling of the page rather than a child of a control in
  // a wrapping flex row, which is not somewhere a modal should be mounted.
  const [faqOpen, setFaqOpen] = useState(false)

  // Sign-in is now asked for from two places -- the account button on a wide
  // header, a menu item on a narrow one -- and the dialog belongs to neither.
  // A modal mounted inside a menu item unmounts with the menu the moment the
  // item is pressed, which is the press that was meant to open it.
  const [authOpen, setAuthOpen] = useState(false)

  // Whether the answer has a column of its own. Below this the page is one
  // column, and the answer moves into a dialog the bottom bar opens rather than
  // sitting a screen below the questions -- see `AnswerBar`. A media query
  // rather than two copies behind `lg:hidden`, because the answer is written
  // once and put in one of two places.
  const wide = useMediaQuery("(min-width: 64rem)")
  const [answerOpen, setAnswerOpen] = useState(false)

  // One banner per fantasy slot, each an ORDERED array with a null for every
  // slot not filled yet. Nulls are held in place rather than closed up: an
  // emblem's multiplier depends on its neighbours, so slot 4 sitting empty
  // between two filled ones is a different banner from the same three emblems
  // pushed together.
  const [banners, setBanners] = useState<Record<FantasyRole, (Emblem | null)[]>>(
    EMPTY_BANNERS,
  )

  function setBanner(slotRole: FantasyRole, next: (Emblem | null)[]) {
    setBanners((prev) => ({ ...prev, [slotRole]: next }))
  }

  // The roster path carries its own three units rather than sharing `role`
  // with the banner path. Picking a support there would otherwise silently
  // retarget the banner tab's ranking at support, and a reader coming back to
  // it would find an answer to a question they did not ask.
  const [roster, setRoster] = useState<Roster>(EMPTY_ROSTER)

  function setRosterPlayer(slotRole: FantasyRole, player: Player | null) {
    setRoster((prev) => ({ ...prev, [slotRole]: player }))
  }

  // Three emblems in a group stage, five in a main event -- read off the run,
  // never inferred from the stage name, so a period with a different banner
  // size works without a client release.
  const slots = data?.run.bannerSlots ?? 0

  // The colour of each slot, per role, read off the run like the slot count.
  // It decides which stats a slot can hold at all, so it is the difference
  // between offering a legal banner and offering one that cannot be worn.
  // Empty for a run published before the rule shipped -- the builders then
  // offer every colour, which is the old behaviour and the old bug.
  const colorsFor = (r: FantasyRole) =>
    (data?.scoring?.bannerColors?.[r] ?? []).slice(0, slots)
  const run = data && { tournamentId: data.run.tournamentId, stage: data.run.stage }

  // One rank call per slot, each gated on its own banner being complete, so a
  // tab with one finished banner and two empty ones asks exactly one question.
  const ranks = {
    core: useRank(sized(banners.core, slots), "core", slots, run),
    mid: useRank(sized(banners.mid, slots), "mid", slots, run),
    support: useRank(sized(banners.support, slots), "support", slots, run),
  }

  // One call per role slot, fired as soon as that slot has a player.
  // `roleFilter` on each slot's `UnitPicker` guarantees the chosen player
  // already carries that role, so the slot's own key is the query -- not the
  // player's `fantasyRole` -- to keep the three calls independent of what is
  // selected.
  const coreUnit = roster.core && { teamId: roster.core.teamId, role: "core" as const }
  const midUnit = roster.mid && { teamId: roster.mid.teamId, role: "mid" as const }
  const supportUnit =
    roster.support && { teamId: roster.support.teamId, role: "support" as const }

  const targets = {
    core: useTarget(coreUnit, run),
    mid: useTarget(midUnit, run),
    support: useTarget(supportUnit, run),
  }

  // The same reshaping the builders do, needed here too because the answer
  // panel draws emblems the user never picked from a list.
  const catalog = useMemo(
    () => buildCatalog(data?.emblems ?? [], data?.scoring),
    [data?.emblems, data?.scoring],
  )

  const answerHeading =
    tab === "banner" ? "Who should wear these banners" : "What this roster scores"

  /** What to do to get an answer, for the narrow layout's bar. The long form of
   * the same sentence is what `AwaitingInput` prints inside the panel; this is
   * the one line that fits above a thumb. */
  const answerHint =
    tab === "banner"
      ? "Build a banner for any slot to see which units score best through it."
      : "Pick a core, a mid and a support to see what the roster is worth."

  /**
   * The answer itself, written once.
   *
   * Rendered into the right-hand column on a wide screen and into a dialog on a
   * narrow one. Two copies behind `lg:hidden` would be two live regions
   * announcing the same number to a screen reader and two sets of the same
   * headings to walk past, and the day one copy is edited they stop agreeing.
   */
  const answer =
    tab === "banner" ? (
      <BannerAnswers banners={banners} ranks={ranks} slots={slots} />
    ) : (
      <RosterAnswer
        roster={roster}
        targets={targets}
        run={run}
        slots={slots}
        catalog={catalog}
      />
    )

  /**
   * What the narrow layout's bar says, or null while there is no answer behind
   * it yet.
   *
   * Read off the same queries the panel draws, and null until at least one of
   * them has resolved: a button offered the moment a picker is touched opens
   * onto a box still saying "two more emblems to go". The roster total goes
   * through `rosterTotal` rather than being added up again here, so the bar and
   * the card cannot disagree.
   */
  const answerSummary: AnswerSummary | null = (() => {
    if (tab === "banner") {
      const ranked = ROLE_ORDER.filter(
        (r) => slots > 0 && banners[r].filter(Boolean).length === slots && ranks[r].data?.best,
      ).length
      return ranked === 0 ? null : { title: `${ranked} of 3 banners ranked` }
    }

    const scored = ROLE_ORDER.filter((r) => targets[r].data?.best).length
    if (scored === 0) return null

    const total = rosterTotal(targets)
    return total === null
      ? { title: `${scored} of 3 slots scored` }
      : { title: "Projected roster total", value: points(total) }
  })()

  /**
   * Switching stage clears both inputs rather than carrying them across.
   *
   * The two stages have different banner sizes and different emblem catalogues,
   * so a carried-over banner would be partly invalid and entirely misleading --
   * three emblems sitting in five slots look like a banner still being built,
   * not like the answer to a different question. The roster goes with them: a
   * team in the group stage is not necessarily in the main event, and one that
   * is not would be a selection that cannot be scored.
   */
  function selectRun(next: { tournamentId: string; stage: Stage }) {
    setSelected(next)
    setBanners(EMPTY_BANNERS)
    setRoster(EMPTY_ROSTER)
  }

  if (isPending) {
    return (
      <PreRun>
        <LoadingRun />
      </PreRun>
    )
  }

  if (error || !data) {
    return (
      <PreRun>
        <RunError error={error} />
      </PreRun>
    )
  }

  return (
    // A column with the answers growing, so the footer sits on the bottom of
    // the viewport rather than wherever the content happened to stop. On a
    // short page -- the roster tab before anyone is picked -- a footer that
    // floats has a rule across the page with a screen of nothing under it,
    // which reads as the footer being that tall.
    <div className="flex min-h-dvh flex-col">
      {/* The header carries the run's identity, a stage control and an account
          menu before the page proper starts, and every tab press walks through
          them. One link, invisible until it has focus. */}
      {/* Only where the answer is on the page. In the narrow layout it is
          behind a button at the bottom of the document, so a link offering to
          skip to it would land on nothing. */}
      {wide && (
        <a
          href="#answers"
          className="focus-visible:ring-ring bg-popover text-popover-foreground sr-only rounded-md px-3 py-2 text-sm shadow-md focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:ring-2"
        >
          Skip to answers
        </a>
      )}

      <RunHeader
        run={data.run}
        overlay={data.overlay}
        account={<AccountMenu state={auth} onSignIn={() => setAuthOpen(true)} />}
        help={<FaqButton onClick={() => setFaqOpen(true)} />}
        menu={
          <SiteMenu
            auth={auth}
            onSignIn={() => setAuthOpen(true)}
            onOpenFaq={() => setFaqOpen(true)}
          />
        }
        stages={
          <StageSwitcher
            available={data.available}
            current={{ tournamentId: data.run.tournamentId, stage: data.run.stage }}
            onSelect={selectRun}
          />
        }
      />

      <main className="mx-auto grid w-full max-w-6xl grow gap-6 px-4 py-6 content-start sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,24rem)_1fr]">
        <Tabs value={tab} onValueChange={(next) => setTab(next as string)} className="flex flex-col gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="banner" className="flex-1">
              I have a banner
            </TabsTrigger>
            <TabsTrigger value="roster" className="flex-1">
              My roster
            </TabsTrigger>
          </TabsList>

          <TabsContent value="banner" className="flex flex-col gap-4">
            {/* One card per fantasy slot, the same three the roster tab uses.
                A single role dropdown put the three questions behind each other
                -- switching it swapped the banner AND the answer, so comparing
                what core and support are wearing meant holding one of them in
                your head. Three cards ask all three at once. */}
            {ROLE_ORDER.map((slotRole) => (
              <Card key={slotRole}>
                <CardHeader className="gap-3">
                  <CardTitle className="text-sm">
                    {ROLE_LABEL[slotRole]}
                    <span className="text-muted-foreground ml-1.5 font-normal">
                      · {ROLE_DETAIL[slotRole]}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <BannerDialog
                    // Remounted per run: the builder remembers the axes of slots
                    // that have not resolved yet, and a half-chosen stat from the
                    // Group Stage catalog is not a half-chosen stat in the Main
                    // Event one.
                    key={`${data.run.tournamentId}:${data.run.stage}:${slotRole}`}
                    role={ROLE_LABEL[slotRole]}
                    emblems={data.emblems}
                    scoring={data.scoring}
                    slots={slots}
                    slotColors={colorsFor(slotRole)}
                    value={sized(banners[slotRole], slots)}
                    onChange={(next) => setBanner(slotRole, next)}
                  />
                </CardContent>
              </Card>
            ))}

            <SavedBanners
              run={data.run}
              auth={auth}
              emblems={data.emblems}
              banners={banners}
              slots={slots}
              // Kept now, so the builder starts the next banner rather than
              // holding one that is already in the list below. Only the slot
              // that was saved -- the other two are still being built.
              onSaved={(savedRole) => setBanner(savedRole, [])}
            />
          </TabsContent>

          <TabsContent value="roster" className="flex flex-col gap-4">
            {ROLE_ORDER.map((slotRole) => (
              <Card key={slotRole}>
                <CardHeader className="gap-3">
                  <CardTitle className="text-sm">
                    {ROLE_LABEL[slotRole]}
                    <span className="text-muted-foreground ml-1.5 font-normal">
                      · {ROLE_DETAIL[slotRole]}
                    </span>
                  </CardTitle>
                  <UnitPicker
                    players={data.players}
                    teams={data.teams}
                    roleFilter={slotRole}
                    placeholder={`Choose a ${ROLE_LABEL[slotRole].toLowerCase()} player`}
                    stageTeamIds={data.stageTeamIds ?? data.teams.map((t) => t.teamId)}
                    value={roster[slotRole]?.playerId ?? null}
                    onSelect={(next) => setRosterPlayer(slotRole, next)}
                  />
                </CardHeader>
              </Card>
            ))}

            <SavedRosters
              run={data.run}
              auth={auth}
              players={data.players}
              roster={roster}
              // Kept now, so the pickers start the next one rather than
              // holding a roster that is already in the list below.
              onSaved={() => setRoster(EMPTY_ROSTER)}
              // The saved list answers for itself, in its own dialog. It never
              // writes back into these three pickers: a reader opening a row to
              // check a number they saved last week has not asked for the
              // roster they are building now to be thrown away.
              slots={slots}
              catalog={catalog}
            />
          </TabsContent>
        </Tabs>

        {/* Named, because "region" alone tells a screen-reader user nothing
            about which of the two columns they have landed in. Live, because
            this is where an answer appears without the reader having moved.
            Focusable, because the skip link moves the viewport here, and moving
            the viewport without moving focus leaves a keyboard user tabbing on
            from the control they were just sent away from. */}
        {wide && (
          <section
            id="answers"
            aria-labelledby="answers-heading"
            aria-live="polite"
            tabIndex={-1}
            className="scroll-mt-4 outline-none"
          >
            <h2 id="answers-heading" className="sr-only">
              {answerHeading}
            </h2>

            {answer}
          </section>
        )}
      </main>

      {/* The narrow layout's answer: a bar that is always there and a dialog it
          opens. Not rendered at all on a wide screen, so the answer exists once
          in the document rather than once per layout. */}
      {!wide && (
        <>
          <AnswerBar
            summary={answerSummary}
            hint={answerHint}
            onOpen={() => setAnswerOpen(true)}
          />

          <Dialog open={answerOpen} onOpenChange={setAnswerOpen}>
            {/* Capped against the viewport rather than given a height, and
                scrolled inside: a roster answer is a total and three cards, and
                the ranked list is longer still. */}
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{answerHeading}</DialogTitle>
              </DialogHeader>

              {answer}
            </DialogContent>
          </Dialog>
        </>
      )}

      <SiteFooter run={data.run} />

      <FaqDialog open={faqOpen} onOpenChange={setFaqOpen} slots={slots} />

      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onGuest={() => setAuthOpen(false)}
      />
    </div>
  )
}

/**
 * The screens that exist before a run does.
 *
 * `RunHeader` is built out of the run, so these two have no header to hang
 * chrome on. The theme control rides along regardless: a failed fetch is a
 * state a reader can sit in, and reading an error message is exactly when
 * being stuck in the wrong palette costs something.
 */
function PreRun({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-4 flex justify-end">
        <ThemeMenu />
      </div>
      {children}
    </main>
  )
}

/** Nothing is shown until the server answers. A placeholder number here would
 * be indistinguishable from a real one. */
function Pending() {
  return (
    <SkeletonPanel label="Scoring every unit through this banner…">
      {/* Five, because five rungs is what the ladder comes back with. A
          placeholder that reserves the wrong number of rows still reflows. */}
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </SkeletonPanel>
  )
}

/**
 * The banner tab's three answers, stacked, each headed by its slot.
 *
 * No total across them, unlike the roster tab. These are three separate
 * questions that happen to be on one screen -- "who should wear my core
 * banner", and again for mid and support -- and the units answering them are
 * not a roster anybody is fielding. Adding up the best unit from each list
 * would produce a number for a team that does not exist.
 *
 * A slot with no banner says so and nothing else. Three copies of the same
 * instruction is the state the tab opens in, so that one is said once, above.
 */
function BannerAnswers({
  banners,
  ranks,
  slots,
}: {
  banners: Record<FantasyRole, (Emblem | null)[]>
  ranks: Record<FantasyRole, ReturnType<typeof useRank>>
  slots: number
}) {
  const placed = (r: FantasyRole) => banners[r].filter(Boolean).length

  if (ROLE_ORDER.every((r) => placed(r) === 0)) {
    return (
      <AwaitingInput>
        Build a banner for any of the three slots to see which units score best through
        it. Each is {slots} emblems and each is scored on its own - core and support are
        duos, mid is one player.
      </AwaitingInput>
    )
  }

  // No score on the tabs here: this side ranks units through a banner, so a
  // slot's headline is a unit's projection and the three are not one roster.
  // Three of them side by side would read as a total that nobody is fielding.
  return (
    <RoleTabs
      render={(slotRole) => {
        const query = ranks[slotRole]
        const short = slots - placed(slotRole)
        if (short === slots) {
          return (
            <AwaitingInput compact>
              No {ROLE_LABEL[slotRole].toLowerCase()} banner built.
            </AwaitingInput>
          )
        }
        if (short > 0) {
          return (
            <AwaitingInput compact>
              {short} more emblem{short === 1 ? "" : "s"} to go.
            </AwaitingInput>
          )
        }
        if (query.isPending) return <Pending />
        if (query.error) return <RunError error={query.error} />
        if (!query.data?.best) {
          return (
            <AwaitingInput compact>
              No unit in this stage has a joint sample to score through this banner.
            </AwaitingInput>
          )
        }
        return <ResultPanel answer={query.data} />
      }}
    />
  )
}
