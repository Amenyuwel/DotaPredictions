/**
 * Enum key -> the words a reader sees.
 *
 * The contract carries roles as lowercase keys (`core`, `mid`, `support`)
 * because that is what the API takes. Every place that shows one to a person
 * shows the same capitalised label, from here: a `capitalize` class in one
 * component and a hand-typed string in another are two spellings of one name,
 * and they drift the moment a role is renamed.
 */
import type { FantasyRole, Lane } from "@/types/run"

export const ROLE_LABEL: Record<FantasyRole, string> = {
  core: "Core",
  mid: "Mid",
  support: "Support",
}

/** The role with the lanes it covers, for a control where the distinction is
 * the whole point -- core and support are duos, mid is one player. */
export const ROLE_DETAIL: Record<FantasyRole, string> = {
  core: "Carry + Offlane",
  mid: "One player",
  support: "Soft + Hard Support",
}

/** Lane key -> the position a reader knows it by. Separate from the role
 * because a role is two lanes for core and support, and a player picker has to
 * say which half of the duo it is offering. */
export const LANE_LABEL: Record<Lane, string> = {
  carry: "Carry",
  mid: "Mid",
  offlane: "Offlane",
  soft_support: "Soft support",
  hard_support: "Hard support",
}

/** Board order, not alphabetical: position 1 through 5, the way a roster is
 * always read. `LANE_LABEL`'s own key order would do it, but relying on the
 * declaration order of an object as a sort key is a rule nothing enforces. */
export const LANE_ORDER: Lane[] = ["carry", "mid", "offlane", "soft_support", "hard_support"]
