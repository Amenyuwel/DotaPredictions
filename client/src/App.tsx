import { useState } from "react"

import { AccountMenu } from "@/components/account-menu"
import { BannerBuilder } from "@/components/banner-builder"
import { ResultPanel } from "@/components/result-panel"
import { RunHeader } from "@/components/run-header"
import { SavedBanners } from "@/components/saved-banners"
import { StageSwitcher } from "@/components/stage-switcher"
import { AwaitingInput, LoadingRun, RunError } from "@/components/states"
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
import { useRank } from "@/hooks/use-rank"
import { ROLE_DETAIL, ROLE_LABEL } from "@/lib/labels"
import { useRun } from "@/hooks/use-run"
import { useSession } from "@/hooks/use-session"
import type { Emblem, FantasyRole, Stage } from "@/types/run"

/**
 * Two mirrored entry paths, one shared result panel.
 *
 * Only the banner -> unit direction is wired. Player -> banner needs a
 * constrained search over an inventory that no engine function performs yet, so
 * it declares itself unbuilt instead of shipping a plausible-looking answer.
 */
export default function App() {
  // Null means "whatever the server considers newest", which is what a cold
  // load asks. It becomes concrete the moment the reader picks a stage.
  const [selected, setSelected] = useState<{ tournamentId: string; stage: Stage } | null>(
    null,
  )
  const { data, isPending, error } = useRun(selected?.tournamentId, selected?.stage)
  const auth = useSession()
  const [banner, setBanner] = useState<(Emblem | null)[]>([])
  const [role, setRole] = useState<FantasyRole>("support")

  // Three emblems in a group stage, five in a main event -- read off the run,
  // never inferred from the stage name, so a period with a different banner
  // size works without a client release.
  const slots = data?.run.bannerSlots ?? 0
  const rank = useRank(
    banner,
    role,
    slots,
    data && { tournamentId: data.run.tournamentId, stage: data.run.stage },
  )

  /**
   * Switching stage clears the banner rather than carrying it across.
   *
   * The two stages have different banner sizes and different emblem catalogues,
   * so a carried-over banner would be partly invalid and entirely misleading --
   * three emblems sitting in five slots look like a banner still being built,
   * not like the answer to a different question.
   */
  function selectRun(next: { tournamentId: string; stage: Stage }) {
    setSelected(next)
    setBanner([])
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
    const catalog = data?.emblems ?? []
    const resolved = emblemIds.map((id) => catalog.find((e) => e.emblemId === id) ?? null)
    setRole(savedRole)
    setBanner(
      Array.from({ length: slots }, (_, i) => resolved[i] ?? null),
    )
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
        <Tabs defaultValue="banner" className="flex flex-col gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="banner" className="flex-1">
              I have a banner
            </TabsTrigger>
            <TabsTrigger value="player" className="flex-1">
              I have a player
            </TabsTrigger>
          </TabsList>

          <TabsContent value="banner">
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
          </TabsContent>

          <TabsContent value="player">
            <AwaitingInput>
              Not built yet. Ranking banners for a player is a constrained search over the
              emblems you own, and it lands with <code>/api/banner/optimize</code>.
            </AwaitingInput>
          </TabsContent>

          <SavedBanners
            run={data.run}
            auth={auth}
            role={role}
            banner={banner}
            slots={slots}
            onLoad={loadSaved}
          />
        </Tabs>

        <section aria-live="polite">
          {filled < slots ? (
            <AwaitingInput>
              Choose {slots} emblems to see which{" "}
              {role === "mid" ? "players" : "duos"} score best through them.
              {filled > 0 && ` ${slots - filled} to go.`}
            </AwaitingInput>
          ) : rank.isPending ? (
            <div className="space-y-2" aria-busy>
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : rank.error ? (
            <RunError error={rank.error} />
          ) : rank.data?.best ? (
            <ResultPanel answer={rank.data} />
          ) : (
            <AwaitingInput>
              No unit in this stage has a joint sample to score through this banner.
            </AwaitingInput>
          )}
        </section>
      </main>
    </div>
  )
}
