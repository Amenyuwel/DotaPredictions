import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  deleteBanner,
  listAllSavedBanners,
  listSavedBanners,
  saveBanner,
  type SavedBanner,
} from "@/lib/supabase"

/**
 * A signed-in user's saved banners for the run on screen.
 *
 * Scoped to tournament and stage because a banner is only meaningful inside
 * one: a five-emblem Main Event banner is not a partially filled group-stage
 * banner, and showing them in one list would invite loading one into the other.
 */
export function useSavedBanners(tournamentId: string, stage: string, enabled: boolean) {
  return useQuery<SavedBanner[]>({
    queryKey: ["saved-banners", tournamentId, stage],
    queryFn: () => listSavedBanners(tournamentId, stage),
    enabled,
    staleTime: 30_000,
  })
}

export function useSaveBanner(tournamentId: string, stage: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveBanner,
    // Refetch rather than patch the cache by hand: the row that comes back
    // carries server-assigned id and timestamp, and a hand-merged optimistic
    // copy is a second version of a row that can disagree with the first.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["saved-banners", tournamentId, stage] }),
  })
}

/**
 * Every saved banner, across tournaments and stages.
 *
 * The account page's question, and one the scoped list structurally cannot
 * answer -- it is the only place a banner saved against a stage that has since
 * ended is still visible, and so the only place it can be deleted.
 */
export function useAllSavedBanners(enabled: boolean) {
  return useQuery<SavedBanner[]>({
    queryKey: ["saved-banners", "all"],
    queryFn: listAllSavedBanners,
    enabled,
    staleTime: 30_000,
  })
}

/**
 * Deleting invalidates the whole `saved-banners` key rather than one run's.
 *
 * A deleted row can sit in two cached lists at once -- the scoped one the
 * sidebar reads and the unscoped one the account page reads -- and they are the
 * same row. Invalidating only the list the delete was issued from leaves the
 * other showing a banner that no longer exists, which is the one failure a
 * saved list has: it is a record of what is there.
 */
export function useDeleteBanner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteBanner,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["saved-banners"] }),
  })
}
