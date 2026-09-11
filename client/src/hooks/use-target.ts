import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { targetBanner } from "@/lib/api"
import type { FantasyRole, Stage } from "@/types/run"

/**
 * The banner one unit should be hunting, out of the whole catalog.
 *
 * Gated on a unit and nothing else. That is the point of this direction: the
 * question is what to aim for, so there is no inventory to be short of and no
 * state a reader has to reach before the answer exists.
 *
 * The answer depends on the run and the unit alone, and a run is immutable, so
 * it never goes stale -- and the server memoises by the same two things. Three
 * roster slots are three keys, and switching tabs and back pays for none of
 * them twice.
 */
export function useTarget(
  unit: { teamId: number; role: FantasyRole } | null,
  run: { tournamentId: string; stage: Stage } | undefined,
  /** Which rung of the ladder. Default is the realistic one, which is the whole
   * point of the ladder: the ceiling is what the search used to answer with. */
  goal: string = "realistic",
  /** Off until a reader asks for this rung, so opening one slot's banner does
   * not fetch four answers for every slot on the page. */
  enabledWhen: boolean = true,
  /** The hand to score, for the custom rung. Part of the question, so it is
   * part of the key -- editing a tier asks a new one. */
  qualities?: string[],
  /**
   * Hold the last answer on screen while the next one is fetched.
   *
   * Only for a control the reader is turning: editing a tier asks a new
   * question every click, and without this the panel empties to skeletons and
   * the dialog collapses to the height of two boxes between each one.
   *
   * NOT the default, and it must never be set where the key changes because the
   * UNIT changed -- the previous player's projection under a new player's name
   * is a wrong answer rather than a slow one. Here the unit is fixed and only
   * the goal moves, and the panel dims itself while the number is stale.
   */
  keepPrevious: boolean = false,
) {
  const enabled = unit !== null && run !== undefined && enabledWhen

  return useQuery({
    queryKey: [
      "target",
      run?.tournamentId,
      run?.stage,
      unit?.role,
      unit?.teamId,
      goal,
      qualities?.join(",") ?? "",
    ],
    queryFn: () =>
      targetBanner({
        role: unit!.role,
        teamId: unit!.teamId,
        goal,
        qualities,
        tournamentId: run?.tournamentId,
        stage: run?.stage,
      }),
    enabled,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    staleTime: Infinity,
    retry: false,
  })
}
