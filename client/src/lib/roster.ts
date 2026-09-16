import type { useTarget } from "@/hooks/use-target"
import { ROLE_ORDER } from "@/lib/labels"
import type { FantasyRole, Player } from "@/types/run"

/** A fantasy roster is three units, one per slot. Null is a slot nobody has
 * been picked for yet, which is the state the tab opens in. */
export type Roster = Record<FantasyRole, Player | null>

/** What a banner answer arrives as, for the panel that draws it. */
export type BannerQuery = ReturnType<typeof useTarget>

/**
 * The roster's three best scores added, or null until all three have one.
 *
 * One definition rather than one per place it is shown. The card, the
 * narrow-screen bar and the saved list's dialog are three renderings of a
 * single number, and sums written separately are sums that can come to
 * disagree -- which on this page reads as the tool being uncertain about its
 * own arithmetic rather than as a bug.
 */
export function rosterTotal(targets: Record<FantasyRole, BannerQuery>): number | null {
  const bests = ROLE_ORDER.map((r) => targets[r].data?.best ?? null)
  return bests.every((b) => b !== null)
    ? bests.reduce((sum, b) => sum + b!.score, 0)
    : null
}
