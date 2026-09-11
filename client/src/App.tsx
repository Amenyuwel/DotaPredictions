import { useMemo, useState } from "react"

import { AccountMenu } from "@/components/account-menu"
import { BannerBuilder } from "@/components/banner-builder"
import { BannerResultPanel } from "@/components/banner-result-panel"
import { InventoryBuilder } from "@/components/inventory-builder"
import { ResultPanel } from "@/components/result-panel"
import { RunHeader } from "@/components/run-header"
import { SavedBanners } from "@/components/saved-banners"
import { StageSwitcher } from "@/components/stage-switcher"
import { AwaitingInput, LoadingRun, RunError } from "@/components/states"
import { UnitPicker } from "@/components/unit-picker"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildCatalog, type EmblemCatalog } from "@/lib/emblem-catalog"
import { points } from "@/lib/format"
import { ROLE_DETAIL, ROLE_LABEL } from "@/lib/labels"
import { useOptimize } from "@/hooks/use-optimize"
import { useRank } from "@/hooks/use-rank"
import { useRun } from "@/hooks/use-run"
import { useSession } from "@/hooks/use-session"
import type { Emblem, FantasyRole, Player, Stage } from "@/types/run"

/** One role slot of a fantasy roster: the unit that wears the banner, and the
 * emblems on offer for it. */
interface RosterSlot {
  player: Player | null
  inventory: Emblem[]
}

const EMPTY_ROSTER: Record<FantasyRole, RosterSlot> = {
  core: { player: null, inventory: [] },
  mid: { player: null, inventory: [] },
  support: { player: null, inventory: [] },
}

const ROSTER_ROLES = ["core", "mid", "support"] as const

type OptimizeQuery = ReturnType<typeof useOptimize>

/**
 * Two mirrored entry paths, one column of answers.
 *
 * "I have a banner" fixes the emblems and ranks the units that could stand
 * behind them; "My roster" fixes three units, one per fantasy role, and
 * ranks the banners each could wear -- the client scores core, mid and
 * support independently and sums them, so there is no cross-slot interaction
 * to model here either. Which answer is on the right depends on which tab is
 * open, so the tabs are controlled here rather than left to themselves -- an
 * answer to the question you are not looking at is worse than no answer,
 * because it is still a number.
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

  const [banner, setBanner] = useState<(Emblem | null)[]>([])
  const [role, setRole] = useState<FantasyRole>("support")

  // The roster path carries its own three units rather than sharing `role`
  // with the banner path. Picking a support there would otherwise silently
  // retarget the banner tab's ranking at support, and a reader coming back to
  // it would find an answer to a question they did not ask.
  const [roster, setRoster] = useState<Record<FantasyRole, RosterSlot>>(EMPTY_ROSTER)

  function updateRosterSlot(slotRole: FantasyRole, patch: Partial<RosterSlot>) {
    setRoster((prev) => ({ ...prev, [slotRole]: { ...prev[slotRole], ...patch } }))
  }

  // Three emblems in a group stage, five in a main event -- read off the run,
  // never inferred from the stage name, so a period with a different banner
  // size works without a client release.
  const slots = data?.run.bannerSlots ?? 0
  const run = data && { tournamentId: data.run.tournamentId, stage: data.run.stage }

  const rank = useRank(banner, role, slots, run)

  // One optimize call per role slot. `roleFilter` on each slot's `UnitPicker`
  // guarantees the chosen player already carries that role, so the slot's own
  // key is the query -- not the player's `fantasyRole` -- to keep the three
  // calls independent of what is selected.
  const rosterCore = useOptimize(
    roster.core.player && { teamId: roster.core.player.teamId, role: "core" },
    roster.core.inventory,
    slots,
    run,
  )
  const rosterMid = useOptimize(
    roster.mid.player && { teamId: roster.mid.player.teamId, role: "mid" },
    roster.mid.inventory,
    slots,
    run,
  )
  const rosterSupport = useOptimize(
    roster.support.player && { teamId: roster.support.player.teamId, role: "support" },
    roster.support.inventory,
    slots,
    run,
  )
  const rosterQueries = { core: rosterCore, mid: rosterMid, support: rosterSupport }

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
    setBanner([])
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
    setRole(savedRole)
    setBanner(Array.from({ length: slots }, (_, i) => resolved[i] ?? null))
  }

  if (isPending) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <LoadingRun />
      </main>
    )
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <RunError error={error} />
      </main>
    )
  }

  const filled = banner.filter(Boolean).length

  return (
    <div className="min-h-dvh">
      <RunHeader
        run={data.run}
        account={<AccountMenu state={auth} />}
        stages={
          <StageSwitcher
            available={data.available}
            current={{ tournamentId: data.run.tournamentId, stage: data.run.stage }}
            onSelect={selectRun}
          />
        }
      />

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,24rem)_1fr]">
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
            <Card>
              <CardHeader className="gap-3">
                <CardTitle className="text-sm">Your banner</CardTitle>
                <Select value={role} onValueChange={(v) => setRole(v as FantasyRole)}>
                  <SelectTrigger className="w-full">
                    {/* The function form: `Select.Value` otherwise renders the
                        raw contract value, and the contract spells roles in
                        lowercase because that is what the API takes. */}
                    <SelectValue>
                      {(v: FantasyRole) => ROLE_LABEL[v] ?? ROLE_LABEL.support}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(["core", "mid", "support"] as const).map((r) => (
                      <SelectItem key={r} value={r}>
                        <span className="flex flex-col items-start">
                          <span>{ROLE_LABEL[r]}</span>
                          <span className="text-muted-foreground text-xs">
                            {ROLE_DETAIL[r]}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <BannerBuilder
                  // Remounted per run: the builder remembers the axes of slots
                  // that have not resolved yet, and a half-chosen stat from the
                  // Group Stage catalog is not a half-chosen stat in the Main
                  // Event one.
                  key={`${data.run.tournamentId}:${data.run.stage}`}
                  emblems={data.emblems}
                  scoring={data.scoring}
                  slots={slots}
                  value={banner.length === slots ? banner : Array(slots).fill(null)}
                  onChange={setBanner}
                />
              </CardContent>
            </Card>

            <SavedBanners
              run={data.run}
              auth={auth}
              role={role}
              banner={banner}
              slots={slots}
              onLoad={loadSaved}
            />
          </TabsContent>

          <TabsContent value="roster" className="flex flex-col gap-4">
            {ROSTER_ROLES.map((slotRole) => (
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
                    value={roster[slotRole].player?.playerId ?? null}
                    onSelect={(next) => updateRosterSlot(slotRole, { player: next })}
                  />
                </CardHeader>
                <CardContent>
                  <InventoryBuilder
                    key={`${data.run.tournamentId}:${data.run.stage}:${slotRole}`}
                    emblems={data.emblems}
                    scoring={data.scoring}
                    slots={slots}
                    max={data.limits?.maxInventory ?? slots}
                    value={roster[slotRole].inventory}
                    onChange={(next) => updateRosterSlot(slotRole, { inventory: next })}
                  />
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>

        <section aria-live="polite">
          {tab === "banner" ? (
            filled < slots ? (
              <AwaitingInput>
                Choose {slots} emblems to see which{" "}
                {role === "mid" ? "players" : "duos"} score best through them.
                {filled > 0 && ` ${slots - filled} to go.`}
              </AwaitingInput>
            ) : rank.isPending ? (
              <Pending />
            ) : rank.error ? (
              <RunError error={rank.error} />
            ) : rank.data?.best ? (
              <ResultPanel answer={rank.data} />
            ) : (
              <AwaitingInput>
                No unit in this stage has a joint sample to score through this banner.
              </AwaitingInput>
            )
          ) : (
            <RosterAnswer roster={roster} queries={rosterQueries} slots={slots} catalog={catalog} />
          )}
        </section>
      </main>
    </div>
  )
}

/** Nothing is shown until the server answers. A placeholder number here would
 * be indistinguishable from a real one. */
function Pending() {
  return (
    <div className="space-y-2" aria-busy>
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  )
}

/**
 * The roster's three answers, stacked, with the sum on top once all three
 * have one.
 *
 * The total is a plain sum of each slot's best score, not a re-optimisation
 * across them -- `enumerate_fantasy_rosters` in the engine treats the three
 * slots the same way, because the client scores core, mid and support as
 * separate averages and adds them. No interval is shown on the total: summing
 * the three point estimates is exact, but summing their confidence intervals
 * would overstate the combined uncertainty, and understating it is worse than
 * leaving it off.
 */
function RosterAnswer({
  roster,
  queries,
  slots,
  catalog,
}: {
  roster: Record<FantasyRole, RosterSlot>
  queries: Record<FantasyRole, OptimizeQuery>
  slots: number
  catalog: EmblemCatalog
}) {
  const bests = ROSTER_ROLES.map((r) => queries[r].data?.best ?? null)
  const total = bests.every((b) => b !== null)
    ? bests.reduce((sum, b) => sum + b!.score, 0)
    : null

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
              Sum of each slot's best banner. The game scores core, mid and support as
              separate averages, so there is nothing for the slots to trade off against
              each other.
            </p>
          </CardContent>
        </Card>
      )}

      {ROSTER_ROLES.map((slotRole) => (
        <div key={slotRole}>
          <h3 className="font-heading mb-2 text-sm font-medium">{ROLE_LABEL[slotRole]}</h3>
          <RosterSlotAnswer
            label={ROLE_LABEL[slotRole].toLowerCase()}
            state={roster[slotRole]}
            query={queries[slotRole]}
            slots={slots}
            catalog={catalog}
          />
        </div>
      ))}
    </div>
  )
}

/** One role slot's answer: nothing chosen, an inventory still short, pending,
 * errored, or a banner. */
function RosterSlotAnswer({
  label,
  state,
  query,
  slots,
  catalog,
}: {
  label: string
  state: RosterSlot
  query: OptimizeQuery
  slots: number
  catalog: EmblemCatalog
}) {
  if (!state.player) {
    return (
      <AwaitingInput>
        Choose a {label} player, then add the emblems you rolled for this slot.
      </AwaitingInput>
    )
  }
  if (state.inventory.length < slots) {
    const short = slots - state.inventory.length
    return (
      <AwaitingInput>
        Add {short} more emblem{short === 1 ? "" : "s"} to this slot's inventory.
      </AwaitingInput>
    )
  }
  if (query.isPending) return <Pending />
  if (query.error) return <RunError error={query.error} />
  if (query.data) return <BannerResultPanel answer={query.data} catalog={catalog} />
  return null
}
