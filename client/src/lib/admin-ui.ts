/**
 * Values the configuration editor shares that are not components.
 *
 * In their own module because a file that exports both a component and a
 * constant cannot be hot-reloaded as a component -- React Fast Refresh has no
 * way to know whether the constant is still the same one. That is a build
 * ergonomics rule, not a design one, but the split lands somewhere sensible
 * anyway: these are the two facts about the editor that more than one component
 * has to agree on.
 */

/** The sections, in the order the rail lists them. Shared so the nav and the
 * panel it switches cannot disagree about what exists. */
export const SECTIONS = [
  { value: "scoring", label: "Scoring" },
  { value: "roster", label: "Teams and players" },
  { value: "catalog", label: "Emblem catalog" },
  { value: "history", label: "History" },
] as const

/**
 * The key shape every id in this stack assumes.
 *
 * An emblem id is `stat:tier:trait`, so a key carrying a colon or a space
 * breaks resolution somewhere far from where it was typed. Shared rather than
 * repeated at each call site, so two dialogs cannot validate the same key
 * differently.
 */
export const KEY_PATTERN = /^[a-z0-9][a-z0-9_]{0,63}$/

export const validateKey = (value: string): string | null =>
  KEY_PATTERN.test(value)
    ? null
    : "Use lower-case letters, digits and underscores only — emblem ids are built by joining stat, tier and trait with colons."

export const validateId = (value: string): string | null =>
  /^[1-9][0-9]{0,18}$/.test(value) ? null : "Enter the numeric id, digits only."
