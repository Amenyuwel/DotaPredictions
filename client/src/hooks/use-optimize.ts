import { useQuery } from "@tanstack/react-query"

import { optimiseBanner } from "@/lib/api"
import type { Emblem, FantasyRole, Stage } from "@/types/run"

/**
 * The best banners for one unit, out of the emblems it owns.
 *
 * Gated on an inventory that can actually fill a banner. Fewer emblems than
 * slots is not a smaller version of the question -- there is no banner to
 * arrange -- and asking anyway would put a rejected request behind a spinner
 * where an instruction belongs.
 */
export function useOptimize(
  unit: { teamId: number; role: FantasyRole } | null,
  inventory: Emblem[],
  slots: number,
  run: { tournamentId: string; stage: Stage } | undefined,
) {
  const ids = inventory.map((e) => e.emblemId)
  const enabled = unit !== null && run !== undefined && slots > 0 && ids.length >= slots

  return useQuery({
    // The inventory is a SET, so the key is sorted: adding an emblem and then
    // removing it must land back on the answer already in the cache rather than
    // spend a second search arriving at the same list.
    queryKey: ["optimize", run?.tournamentId, run?.stage, unit?.role, unit?.teamId, [...ids].sort()],
    queryFn: () =>
      optimiseBanner({
        role: unit!.role,
        teamId: unit!.teamId,
        tournamentId: run?.tournamentId,
        stage: run?.stage,
        inventory: ids.map((emblemId) => ({ emblemId })),
      }),
    enabled,
    // The run is immutable and the server memoises by body, so the same
    // inventory has the same answer for the life of the process.
    staleTime: Infinity,
    retry: false,
  })
}
