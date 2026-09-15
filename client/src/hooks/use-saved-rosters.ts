import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  deleteRoster,
  listAllSavedRosters,
  listSavedRosters,
  saveRoster,
  type SavedRoster,
} from "@/lib/supabase"

/**
 * A signed-in user's saved rosters for the run on screen.
 *
 * Scoped to tournament and stage for the same reason banners are: fantasy
 * resets per period, and the eight teams left in a Main Event are not the
 * sixteen a Group Stage offered. A roster listed across both would invite
 * loading one whose players this run cannot score.
 */
export function useSavedRosters(tournamentId: string, stage: string, enabled: boolean) {
  return useQuery<SavedRoster[]>({
    queryKey: ["saved-rosters", tournamentId, stage],
    queryFn: () => listSavedRosters(tournamentId, stage),
    enabled,
    staleTime: 30_000,
  })
}

export function useSaveRoster(tournamentId: string, stage: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveRoster,
    // Refetched rather than patched into the cache: the row that comes back
    // carries a server-assigned id and timestamp, and a hand-merged copy is a
    // second version of one row that can disagree with it.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["saved-rosters", tournamentId, stage] }),
  })
}

/** Every saved roster, across tournaments and stages -- see
 * `useAllSavedBanners` for why this is a separate question. */
export function useAllSavedRosters(enabled: boolean) {
  return useQuery<SavedRoster[]>({
    queryKey: ["saved-rosters", "all"],
    queryFn: listAllSavedRosters,
    enabled,
    staleTime: 30_000,
  })
}

/** Invalidates the whole key, for the reason `useDeleteBanner` gives: one row
 * can be sitting in both the scoped and the unscoped cached list. */
export function useDeleteRoster() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteRoster,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-rosters"] }),
  })
}
