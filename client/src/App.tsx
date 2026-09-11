import { useMemo, useState, type ReactNode } from "react"

import { AccountMenu } from "@/components/account-menu"
import { BannerDialog } from "@/components/banner-dialog"
import { FaqButton, FaqDialog } from "@/components/faq"
import { ResultPanel } from "@/components/result-panel"
import { RoleTabs } from "@/components/role-tabs"
import { RunHeader } from "@/components/run-header"
import { SlotTargetCard } from "@/components/slot-target-card"
import { SavedBanners } from "@/components/saved-banners"
import { SavedRosters } from "@/components/saved-rosters"
import { SiteFooter } from "@/components/site-footer"
import { StageSwitcher } from "@/components/stage-switcher"
import { AwaitingInput, LoadingRun, RunError } from "@/components/states"
import { ThemeMenu } from "@/components/theme-menu"
import { UnitPicker } from "@/components/unit-picker"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Loading } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildCatalog, type EmblemCatalog } from "@/lib/emblem-catalog"
import { points } from "@/lib/format"
import { ROLE_DETAIL, ROLE_LABEL, ROLE_ORDER } from "@/lib/labels"
import { useTarget } from "@/hooks/use-target"
import { useRank } from "@/hooks/use-rank"
import { useRun } from "@/hooks/use-run"
import { useSession } from "@/hooks/use-session"
import type { Emblem, FantasyRole, Player, Stage } from "@/types/run"

/** A fantasy roster is three units, one per slot. Null is a slot nobody has
 * been picked for yet, which is the state the tab opens in. */
type Roster = Record<FantasyRole, Player | null>

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

/** What a banner answer arrives as, for the panel that draws it. */
type BannerQuery = ReturnType<typeof useTarget>

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

  /**
   * Load a saved banner back into the builder.
   *
   * Emblem ids are resolved against THIS run's catalog rather than trusted: a
   * banner saved against an earlier run can name an emblem the current one does
   * not generate. An unresolved id becomes an empty slot, so the banner comes
   * back visibly incomplete instead of silently scoring four emblems as five.
   */
  function loadSaved(savedRole: FantasyRole, emblemIds: string[]) {
    const rows = data?.emblems ?? []
    const resolved = emblemIds.map((id) => rows.find((e) => e.emblemId === id) ?? null)
    // Into the card for the role it was SAVED under, never the one on screen: a
    // support banner loaded into the core slot would be scored against the
    // wrong unit and look like a finding.
    setBanner(savedRole, Array.from({ length: slots }, (_, i) => resolved[i] ?? null))
  }

  /**
   * Load a saved roster back into the three pickers.
   *
   * Player ids are resolved against THIS run rather than trusted, the same way
   * a saved banner's emblems are: a roster saved against the Group Stage can
   * name a player whose team did not make the Main Event. An id the run does
   * not carry becomes an empty slot, so the roster comes back visibly short
   * instead of scoring two units as three.
   */
  function loadRoster(players: { core: number; mid: number; support: number }) {
    const rows = data?.players ?? []
    const find = (playerId: number, slotRole: FantasyRole) =>
      rows.find((p) => p.playerId === playerId && p.fantasyRole === slotRole) ?? null
    setRoster({
      core: find(players.core, "core"),
      mid: find(players.mid, "mid"),
      support: find(players.support, "support"),
    })
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
      <a
        href="#answers"
        className="focus-visible:ring-ring bg-popover text-popover-foreground sr-only rounded-md px-3 py-2 text-sm shadow-md focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:ring-2"
      >
        Skip to answers
      </a>

      <RunHeader
        run={data.run}
        account={<AccountMenu state={auth} />}
        help={<FaqButton onClick={() => setFaqOpen(true)} />}
        stages={
          <StageSwitcher
            available={data.available}
            current={{ tournamentId: data.run.tournamentId, stage: data.run.stage }}
            onSelect={selectRun}
          />
        }
      />

      <main className="mx-auto grid w-full max-w-6xl grow gap-6 px-6 py-8 content-start lg:grid-cols-[minmax(0,24rem)_1fr]">
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
              banners={banners}
              slots={slots}
              onLoad={loadSaved}
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

            <SavedRosters run={data.run} auth={auth} roster={roster} onLoad={loadRoster} />
          </TabsContent>
        </Tabs>

        {/* Named, because "region" alone tells a screen-reader user nothing
            about which of the two columns they have landed in. Live, because
            this is where an answer appears without the reader having moved. */}
        <section id="answers" aria-label="Answer" aria-live="polite">
          {tab === "banner" ? (
            <BannerAnswers banners={banners} ranks={ranks} slots={slots} />
          ) : (
            <RosterAnswer
              roster={roster}
              targets={targets}
              run={run}
              slots={slots}
              catalog={catalog}
            />
          )}
        </section>
      </main>

      <SiteFooter run={data.run} />

      <FaqDialog open={faqOpen} onOpenChange={setFaqOpen} slots={slots} />
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
    <main className="mx-auto min-h-dvh max-w-6xl px-6 py-10">
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
    <div className="space-y-2" aria-busy>
      <Loading>Scoring every unit through this banner…</Loading>
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
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

/**
 * The roster's three answers as three cards, with their total on top once all
 * three have one.
 *
 * The total is a plain sum of each slot's best score, not a re-optimisation
 * across them -- `enumerate_fantasy_rosters` in the engine treats the three
 * slots the same way, because the client scores core, mid and support as
 * separate averages and adds them. No interval is shown on the total: summing
 * the three point estimates is exact, but summing their confidence intervals
 * would overstate the combined uncertainty, and understating it is worse than
 * leaving it off.
 *
 * What it sums is the REALISTIC rung of each slot, not the ceiling. Quality
 * cannot be rerolled -- the client rolls stats and traits and nothing else --
 * so a total built from five Tier V emblems per slot is a number no run of luck
 * can be planned towards. It is still one tab along on every card, because the
 * ceiling is what a real goal is measured against.
 */
function RosterAnswer({
  roster,
  targets,
  run,
  slots,
  catalog,
}: {
  roster: Roster
  targets: Record<FantasyRole, BannerQuery>
  run: { tournamentId: string; stage: Stage } | undefined
  slots: number
  catalog: EmblemCatalog
}) {
  const bests = ROLE_ORDER.map((r) => targets[r].data?.best ?? null)
  const total = bests.every((b) => b !== null)
    ? bests.reduce((sum, b) => sum + b!.score, 0)
    : null

  // Before the first player is picked the three slots have nothing to say
  // apart from each other, and saying it three times fills the whole answer
  // column with a paragraph repeated with one word changed. One sentence until
  // there is something to be specific about.
  if (ROLE_ORDER.every((r) => roster[r] === null)) {
    return (
      <AwaitingInput>
        Pick a core, a mid and a support. Each one gets the {slots} emblems that score
        best for it out of the whole catalog -- the banner to go and roll for -- and the
        three are added up.
      </AwaitingInput>
    )
  }

  return (
    <div className="space-y-4">
      {total !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Projected roster total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{points(total)}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Sum of each slot's realistic target, so it is what this roster is worth on a
              hand of emblems an ordinary set of crafts leaves you with - not the ceiling.
              Quality cannot be rerolled, so the perfect banner is a number to measure
              against rather than one to plan for; each card opens on the whole ladder.
              The game scores core, mid and support as separate averages, so there is
              nothing for the slots to trade off against each other.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Three cards rather than three stacked answers, and rather than one
          answer behind a tab: the three numbers the ceiling is the sum of are
          then on the page together, which is the comparison a reader came for.
          The emblems are what they act on one slot at a time, so those open. */}
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-3">
        {ROLE_ORDER.map((slotRole) => (
          <SlotTargetCard
            key={slotRole}
            role={slotRole}
            player={roster[slotRole]}
            run={run}
            target={targets[slotRole]}
            catalog={catalog}
          />
        ))}
      </div>
    </div>
  )
}
