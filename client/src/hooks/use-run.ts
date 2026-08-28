import { useQuery } from "@tanstack/react-query"

import { getCurrentRun } from "@/lib/api"
import type { Stage } from "@/types/run"

/**
 * The current published run.
 *
 * `staleTime` mirrors the `Cache-Control: public, max-age=3600` the server sets
 * on this endpoint: a run is immutable, so re-fetching it inside the hour can
 * only cost a request. Retries are off for 404 because "nothing published yet"
 * is a state to render, not a failure to retry.
 */
export function useRun(tournamentId?: string, stage?: Stage) {
  return useQuery({
    queryKey: ["run", tournamentId ?? "latest", stage ?? "latest"],
    queryFn: () => getCurrentRun(tournamentId, stage),
    staleTime: 60 * 60 * 1000,
    retry: false,
  })
}
