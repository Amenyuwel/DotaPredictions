/**
 * Enum key -> the words a reader sees.
 *
 * The contract carries roles as lowercase keys (`core`, `mid`, `support`)
 * because that is what the API takes. Every place that shows one to a person
 * shows the same capitalised label, from here: a `capitalize` class in one
 * component and a hand-typed string in another are two spellings of one name,
 * and they drift the moment a role is renamed.
 */
import type { FantasyRole, Lane, Player, Stage } from "@/types/run"

/** The three fantasy slots, in the order every screen shows them: core, mid,
 * support. Board order rather than alphabetical, for the same reason as
 * `LANE_ORDER` -- and written once, because a second copy is a second order. */
export const ROLE_ORDER = ["core", "mid", "support"] as const satisfies readonly FantasyRole[]

export const ROLE_LABEL: Record<FantasyRole, string> = {
  core: "Core",
  mid: "Mid",
  support: "Support",
}

/**
 * A unit as one name: "Ari & Whitemon" for a duo, "Nisha" for mid.
 *
 * `&` rather than `+`, because a duo is two people together and not a sum --
 * the plus sign reads as arithmetic on a page whose every other number is one.
 * Three components drew this string and each joined it by hand; the separator
 * is a decision, so it is made once. `routes/optimize.ts` spells the same pair
 * into an error sentence server-side and is the one copy outside this file.
 *
 * In lane order, whatever order the players arrived in. The picker lists a duo
 * carry first and the server's answers did not, so one pair was "Yatoro &
 * Collapse" on the card a reader tapped and "Collapse & Yatoro" on the answer
 * it produced -- close enough to look like the same unit, far enough to make a
 * reader check.
 */
export const unitName = (players: Player[]) =>
  [...players]
    .sort((a, b) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane))
    .map((p) => p.nick)
    .join(" & ")

/** Stage key -> the words a reader sees. Three places showed this pair -- the
 * header, the switcher and the saved list -- and a hand-typed "Main Event" in
 * any of them is a second spelling of one name. */
export const STAGE_LABEL: Record<Stage, string> = {
  group: "Group Stage",
  main: "Main Event",
}

/**
 * A tournament id as a reader writes it: `ti2026` -> `TI2026`.
 *
 * The id is the API's key and stays lowercase everywhere it is SENT. Only the
 * International's `ti<year>` form is rewritten, because that is the one whose
 * casing a reader would call wrong; any other id passes through untouched
 * rather than being blanket-uppercased, which would turn a hyphenated event
 * name into shouting. The edition number (TI15) is deliberately not derived
 * from the year -- that is a fact about Valve's schedule rather than
 * arithmetic, and a skipped year would make it quietly wrong.
 */
export const tournamentLabel = (id: string) =>
  /^ti\d{2,4}$/.test(id) ? id.toUpperCase() : id

/** The role with the lanes it covers, for a control where the distinction is
 * the whole point -- core and support are duos, mid is one player. */
export const ROLE_DETAIL: Record<FantasyRole, string> = {
  core: "Carry & Offlane",
  mid: "One player",
  support: "Soft & Hard Support",
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

/**
 * A stat key as a reader sees it: `courier_kills` -> `Courier Kills`.
 *
 * The keys are the scoring table's own, and they stay exactly as they are
 * everywhere they are SENT -- an emblem id is `stat:tier:trait`, so the key is
 * load-bearing. This is only how the same stat is written down for a person.
 *
 * Deliberately the same transform the publisher applies when it builds an
 * emblem's `displayName` (`stat.replace("_", " ").title()` in
 * engine/scripts/publish.py, mirrored in server/src/admin/overlay.ts). A reader
 * comparing the configuration editor against an emblem in the client must see
 * one spelling, not two -- so this is a third copy of one rule, and the reason
 * it is tolerated rather than shared is that the three live in three languages.
 * `server/test/overlay.test.ts` pins the pair that CAN drift silently.
 */
export const statLabel = (key: string) =>
  key.replace(/_/g, " ").replace(/[a-z]+/gi, (word) => capitalize(word.toLowerCase()))

/** First letter up, rest untouched. For values that are already words -- an
 * emblem colour, a source of "none" -- where the contract holds them lowercase
 * and only the reader needs them otherwise. */
export const capitalize = (value: string) =>
  value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1)

