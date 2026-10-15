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

/**
 * Drop a key, and the map with it once empty.
 *
 * Dropping rather than writing the published value back. An overlay entry that
 * agrees with the run is not nothing -- it is a standing instruction to hold
 * that value if the run ever changes, which is the silent revert this design
 * exists to prevent. An empty map left behind is the same problem smaller: it
 * still counts as a change and still publishes.
 */
export function without<T extends object>(map: T | undefined, key: string): T | undefined {
  if (!map || !(key in map)) return map
  const next = { ...map } as Record<string, unknown>
  delete next[key]
  return (Object.keys(next).length > 0 ? next : undefined) as T | undefined
}

/**
 * Put an entry's changed fields into a patch map, or drop the entry entirely
 * when nothing differs from the published run.
 *
 * An edit dialog hands back a whole row, so the diff happens on save. Writing
 * every field would leave entries that AGREE with the run. `isKnown` is false
 * for a row the run does not carry, where the entry is kept whole because there
 * is nothing to merge onto. Shared by both editors, because the roster's copy of
 * this rule was the one that drifted: it spread the old entry over the new
 * changes, so a field set back to its published value could never be cleared.
 */
export function mergeEntry<T extends object>(
  map: Record<string, T> | undefined,
  key: string,
  changes: T,
  isKnown: boolean,
): Record<string, T> | undefined {
  if (isKnown && Object.keys(changes).length === 0) return without(map, key)
  return { ...(map ?? {}), [key]: changes }
}

/** The server rejects an overlay for EVERY reason at once, precisely so all of
 * them can be shown. Fixing them one round trip at a time is how a five-minute
 * correction becomes an afternoon. Shared, because the page and the publish
 * dialog both render a failure and must list the same reasons. */
export function reasonsOf(error: unknown): string[] {
  return error && typeof error === "object" && "reasons" in error
    ? ((error as { reasons?: string[] }).reasons ?? [])
    : []
}
