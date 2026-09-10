/**
 * Enum key -> the words a reader sees.
 *
 * The contract carries roles as lowercase keys (`core`, `mid`, `support`)
 * because that is what the API takes. Every place that shows one to a person
 * shows the same capitalised label, from here: a `capitalize` class in one
 * component and a hand-typed string in another are two spellings of one name,
 * and they drift the moment a role is renamed.
 */
import type { FantasyRole } from "@/types/run"

export const ROLE_LABEL: Record<FantasyRole, string> = {
  core: "Core",
  mid: "Mid",
  support: "Support",
}

/** The role with the lanes it covers, for a control where the distinction is
 * the whole point -- core and support are duos, mid is one player. */
export const ROLE_DETAIL: Record<FantasyRole, string> = {
  core: "Carry + offlane",
  mid: "One player",
  support: "Soft + hard support",
}
