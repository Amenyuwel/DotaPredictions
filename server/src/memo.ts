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
}

export function createMemo(limit: number): Memo {
  const entries = new Map<string, unknown>()

  return {
    /** A hash rather than the joined parts, so one long inventory cannot make
     * the key itself the thing that grows without bound. */
    key(...parts) {
      const hash = createHash("sha1")
      for (const part of parts) hash.update(`${part}\0`)
      return hash.digest("hex")
    },

    remember<T>(key: string, compute: () => T): T {
      const hit = entries.get(key)
      if (hit !== undefined) {
        entries.delete(key) // re-insert to make it most-recently-used
        entries.set(key, hit)
        return hit as T
      }
      const value = compute()
      entries.set(key, value)
      if (entries.size > limit) entries.delete(entries.keys().next().value!)
      return value
    },
  }
}
