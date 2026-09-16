import { useQuery, type Query } from "@tanstack/react-query"

import { getCurrentRun } from "@/lib/api"
import type { CurrentRun, Stage } from "@/types/run"

/** Used only when the server did not say. Deliberately the short bound -- see
 * `runQueryOptions`. Matches `overlayCacheSeconds` in the server's config. */
const FALLBACK_CACHE_SECONDS = 30

/**
 * The current published run.
 *
 * `staleTime` is the server's own `Cache-Control: max-age`, read off the
 * response rather than written down here. It used to be a hardcoded hour,
 * mirroring a header that really did say 3600 -- and then admin overlays
 * capped that header at `overlayCacheSeconds` wherever an overlay can exist,
 * and the copy in this file did not move. The result was the failure the cap
 * was added to prevent, one layer up: an admin publishes a scoring change, the
 * header expires in thirty seconds, and this cache holds the query fresh for
 * an hour so nothing ever revalidates. The tab keeps rendering the previous
 * scoring table -- percentages, colours, which stats a slot can hold --
 * against scores the server is now computing from the new one.
 *
 * So the number travels with the answer. One place decides it, both caches
 * honour it, and tuning it server-side moves them together.
 *
 * Retries are off for 404 because "nothing published yet" is a state to
 * render, not a failure to retry.
 */
export function useRun(tournamentId?: string, stage?: Stage) {
  return useQuery(runQueryOptions(tournamentId, stage))
}

/**
 * The same query, as options, for a caller that needs several at once.
 *
 * The account page lists saved work across every tournament and stage, and a
 * saved roster holds player ids rather than names -- so it has to resolve each
 * group against its own run, which is `useQueries` and not a hook it can call
 * in a loop. Shared rather than rewritten there because the KEY is the shared
 * part: a second spelling of `["run", id, stage]` would fetch a second copy of
 * a payload this cache already holds, and the two could disagree about which
 * run is current.
 */
export function runQueryOptions(tournamentId?: string, stage?: Stage) {
  return {
    queryKey: ["run", tournamentId ?? "latest", stage ?? "latest"] as const,
    queryFn: () => getCurrentRun(tournamentId, stage),
    // A function, because the bound is in the response and so is not known
    // until there is one. The fallback is the SHORT one: a server that does not
    // send the field is either older than it or unreachable, and revalidating
    // too often costs a request while revalidating too rarely costs a wrong
    // number on screen.
    staleTime: (query: Query<CurrentRun>) =>
      (query.state.data?.cacheSeconds ?? FALLBACK_CACHE_SECONDS) * 1000,
    retry: false,
  }
}
