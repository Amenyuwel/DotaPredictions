import { useQuery } from "@tanstack/react-query"

import { rankPlayers } from "@/lib/api"
import type { Emblem, FantasyRole } from "@/types/run"

/**
 * Ranked units for a banner, fetched only once the banner is complete.
 *
 * A partial banner is not a cheaper question with a rougher answer -- it is a
 * different banner, and scoring it would put a number on screen that answers
 * something the user did not ask.
 */
export function useRank(banner: (Emblem | null)[], role: FantasyRole, slots: number) {
  const chosen = banner.filter((e): e is Emblem => e !== null)
  const complete = chosen.length === slots

  return useQuery({
    queryKey: ["rank", role, chosen.map((e) => e.emblemId)],
    queryFn: () =>
      rankPlayers({
        role,
        emblems: chosen.map((e, order) => ({ emblemId: e.emblemId, order })),
      }),
    enabled: complete,
    // The run is immutable and the server memoises by body, so the same banner
    // has the same answer for the life of the process.
    staleTime: Infinity,
    retry: false,
  })
}
