import { LANE_ORDER } from "@/lib/labels"
import type { FantasyRole, Player } from "@/types/run"

/**
 * The players scored together as one fantasy unit: a duo for core and support,
 * one player for mid.
 *
 * Stored state names ONE player per slot -- the picker hands back a single
 * `Player`, and a saved roster keeps a single id -- because one id is all it
 * takes to identify the unit. What gets scored, and what every screen has to
 * NAME, is the whole unit: a core slot holding "Satanic" is a slot holding
 * Satanic and Noticed, and printing half of it is a roster the reader cannot
 * check against the one in their client.
 *
 * Sorted by lane, not by which half was stored. The picker's cards are in lane
 * order, so a roster saved from the offlane half would otherwise read back with
 * its two names swapped -- the same unit under a second spelling.
 *
 * `role` narrows the match to a player carrying that fantasy role. Callers
 * restoring saved state pass it and callers reading live state do not: an id
 * off a saved row can name somebody this run carries in a DIFFERENT slot, and a
 * support quietly resolving through the core slot is a wrong answer rather than
 * a missing one. Empty when nothing matches, which is the caller's cue that the
 * slot cannot be filled from this run.
 */
export function unitOf(
  players: Player[],
  playerId: number,
  role?: FantasyRole,
): Player[] {
  const member = players.find(
    (p) => p.playerId === playerId && (role === undefined || p.fantasyRole === role),
  )
  if (!member) return []

  return players
    .filter((p) => p.teamId === member.teamId && p.fantasyRole === member.fantasyRole)
    .sort((a, b) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane))
}
