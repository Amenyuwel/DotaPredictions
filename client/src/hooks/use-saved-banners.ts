import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  deleteBanner,
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

export function useDeleteBanner(tournamentId: string, stage: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteBanner,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["saved-banners", tournamentId, stage] }),
  })
}
