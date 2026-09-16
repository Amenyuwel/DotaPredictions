import { createHash } from "node:crypto"

/**
 * Answers remembered per run and request body.
 *
 * Every answer this server gives costs thousands of simulated draws, the inputs
 * are a small set of emblem and team ids, and a run is immutable -- so the same
 * question has the same answer for the life of the process. The cap is a plain
 * LRU: these are public endpoints with no auth, and an unbounded map keyed on
 * user input is a memory leak waiting for a bored visitor.
 */
export interface Memo {
  key(...parts: (string | number)[]): string
  remember<T>(key: string, compute: () => T): T
  /** Drop everything. See `resetMemos`. */
  clear(): void
}

/**
 * Every memo this process has made.
 *
 * A run is immutable, so for most of this project's life "the same question has
 * the same answer" was a fact about the data. Admin overlays make it a fact
 * about the data AND the configuration in force, and the configuration can
 * move between two requests.
 *
 * Registering here means an overlay change invalidates every cached answer
 * without any route having to remember to add a version to its key. That is the
 * point: a memo key that forgets to mention the overlay is a route that serves
 * yesterday's scoring table with today's confidence, and it would look exactly
 * like a correct answer. One registry, one `resetMemos()`, nothing to forget.
 */
const registry = new Set<Memo>()

/** Called when the effective configuration changes. Blunt on purpose -- an
 * overlay can move any score, and a partially invalidated cache is one that is
 * eventually wrong in a way nobody can reproduce. */
export function resetMemos(): void {
  for (const memo of registry) memo.clear()
}

export function createMemo(limit: number): Memo {
  const entries = new Map<string, unknown>()

  const memo: Memo = {
    clear() {
      entries.clear()
    },

    /** A hash rather than the joined parts, so one long inventory cannot make
     * the key itself the thing that grows without bound. */
    key(...parts) {
      const hash = createHash("sha1")
      for (const part of parts) hash.update(`${part}\0`)
      return hash.digest("hex")
    },

    remember<T>(key: string, compute: () => T): T {
      // `has`, not a truthiness or undefined check on the value: a memo whose
      // computed answer is `undefined` would otherwise never register as a hit
      // and would be recomputed on every request forever -- a cache that looks
      // present, costs a map entry, and saves nothing. Every caller here
      // returns an object today, which is exactly why this would go unnoticed.
      if (entries.has(key)) {
        const hit = entries.get(key) as T
        entries.delete(key) // re-insert to make it most-recently-used
        entries.set(key, hit)
        return hit
      }
      const value = compute()
      entries.set(key, value)
      if (entries.size > limit) entries.delete(entries.keys().next().value!)
      return value
    },
  }

  registry.add(memo)
  return memo
}
