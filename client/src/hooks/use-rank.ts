import { useQuery } from "@tanstack/react-query"

import { rankPlayers } from "@/lib/api"
import type { Emblem, FantasyRole, Stage } from "@/types/run"

/**
 * Ranked units for a banner, fetched only once the banner is complete.
 *
 * A partial banner is not a cheaper question with a rougher answer -- it is a
 * different banner, and scoring it would put a number on screen that answers
 * something the user did not ask.
 */
export function useRank(
  banner: (Emblem | null)[],
  role: FantasyRole,
  slots: number,
  run: { tournamentId: string; stage: Stage } | undefined,
) {
  const chosen = banner.filter((e): e is Emblem => e !== null)
  const complete = chosen.length === slots

  return useQuery({
    // The run is part of the key, not just the request: the same three emblems
    // mean a different question in a different stage, and a cache that could not
    // tell them apart would answer the group stage with main-event numbers.
    queryKey: ["rank", run?.tournamentId, run?.stage, role, chosen.map((e) => e.emblemId)],
    queryFn: () =>
      rankPlayers({
        role,
        tournamentId: run?.tournamentId,
        stage: run?.stage,
        emblems: chosen.map((e, order) => ({ emblemId: e.emblemId, order })),
      }),
    enabled: complete && run !== undefined,
    // The run is immutable and the server memoises by body, so the same banner
    // has the same answer for the life of the process.
    staleTime: Infinity,
    retry: false,
  })
}
