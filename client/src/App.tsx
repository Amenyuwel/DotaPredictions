import { useState } from "react"

import { BannerBuilder } from "@/components/banner-builder"
import { ResultPanel } from "@/components/result-panel"
import { RunHeader } from "@/components/run-header"
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
import { useRun } from "@/hooks/use-run"
import type { Emblem, FantasyRole } from "@/types/run"

/**
 * Two mirrored entry paths, one shared result panel.
 *
 * Only the banner -> unit direction is wired. Player -> banner needs a
 * constrained search over an inventory that no engine function performs yet, so
 * it declares itself unbuilt instead of shipping a plausible-looking answer.
 */
export default function App() {
  const { data, isPending, error } = useRun()
  const [banner, setBanner] = useState<(Emblem | null)[]>([])
  const [role, setRole] = useState<FantasyRole>("support")

  // Three emblems in a group stage, five in a main event. Read from the run,
  // never a constant, so a tournament with a different banner size just works.
  const slots = data?.run.stage === "main" ? 5 : 3
  const rank = useRank(banner, role, slots)

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
      <RunHeader run={data.run} />

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,24rem)_1fr]">
        <Tabs defaultValue="banner">
          <TabsList className="w-full">
            <TabsTrigger value="banner" className="flex-1">
              I have a banner
            </TabsTrigger>
            <TabsTrigger value="player" className="flex-1">
              I have a player
            </TabsTrigger>
          </TabsList>

          <TabsContent value="banner" className="mt-4">
            <Card>
              <CardHeader className="gap-3">
                <CardTitle className="text-sm">Your banner</CardTitle>
                <Select value={role} onValueChange={(v) => setRole(v as FantasyRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="core">Core (carry + offlane)</SelectItem>
                    <SelectItem value="mid">Mid</SelectItem>
                    <SelectItem value="support">Support (soft + hard)</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <BannerBuilder
                  emblems={data.emblems}
                  slots={slots}
                  value={banner.length === slots ? banner : Array(slots).fill(null)}
                  onChange={setBanner}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="player" className="mt-4">
            <AwaitingInput>
              Not built yet. Ranking banners for a player is a constrained search over the
              emblems you own, and it lands with <code>/api/banner/optimize</code>.
            </AwaitingInput>
          </TabsContent>
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
