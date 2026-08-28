import { useState } from "react"

import { BannerBuilder } from "@/components/banner-builder"
import { RunHeader } from "@/components/run-header"
import { AwaitingInput, LoadingRun, RunError } from "@/components/states"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useRun } from "@/hooks/use-run"
import type { Emblem } from "@/types/run"

/**
 * Two mirrored entry paths, one shared result panel.
 *
 * Only the banner -> player direction is wired. Player -> banner needs a
 * constrained search over an inventory that no engine function performs yet, so
 * it declares itself unbuilt instead of shipping a plausible-looking answer.
 */
export default function App() {
  const { data, isPending, error } = useRun()
  const [banner, setBanner] = useState<(Emblem | null)[]>([])

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

  // Three in a group stage, five in a main event -- read from the run, never a
  // constant, so a future tournament with a different banner size just works.
  const slots = data.run.stage === "main" ? 5 : 3
  const filled = banner.filter(Boolean).length

  return (
    <div className="min-h-dvh">
      <RunHeader run={data.run} />

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[minmax(0,22rem)_1fr]">
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
              <CardHeader>
                <CardTitle className="text-sm">Your banner</CardTitle>
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
              Choose {slots} emblems to see which {data.run.stage === "main" ? "duos" : "teams"}{" "}
              score best through them.
              {filled > 0 && ` ${slots - filled} to go.`}
            </AwaitingInput>
          ) : (
            <PendingAnswer />
          )}
        </section>
      </main>
    </div>
  )
}

/**
 * The banner is complete but no ranking exists yet: `/api/player/rank` is the
 * next slice, and `ResultPanel` is waiting for it. Saying so beats rendering an
 * empty panel, which would read as "no players qualify".
 */
function PendingAnswer() {
  return (
    <AwaitingInput>
      Banner complete. Ranking arrives with <code>/api/player/rank</code>; nothing is shown
      until a real score exists.
    </AwaitingInput>
  )
}
