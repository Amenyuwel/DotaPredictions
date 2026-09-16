import assert from "node:assert/strict"
import { test } from "node:test"

import { createMemo, resetMemos } from "../src/memo.js"

/**
 * The cache in front of every scored answer.
 *
 * Two failures worth pinning, both of which look like a working cache:
 *
 *   * a miss that never becomes a hit, so the map fills up and saves nothing
 *   * an eviction order that drops the entry being used, so a hot question
 *     recomputes while cold ones sit in the map
 *
 * And one that is not a performance problem at all: `resetMemos` must reach
 * every memo this process made. A memo the registry missed would serve answers
 * computed against the previous scoring table after an admin published a new
 * one -- correct-looking numbers from a configuration no longer in force.
 */

test("a computed answer is remembered rather than recomputed", () => {
  const memo = createMemo(10)
  let calls = 0
  const compute = () => {
    calls += 1
    return { value: 1 }
  }

  const first = memo.remember("k", compute)
  const second = memo.remember("k", compute)

  assert.equal(calls, 1)
  assert.equal(second, first, "the same object, not an equal copy")
})

test("an answer of undefined is still a hit", () => {
  // The reason this is not a hypothetical: the check used to be
  // `hit !== undefined`, which recomputes such an entry on every request while
  // still occupying a slot in the map. No caller returns undefined today, which
  // is exactly why it would go unnoticed if one ever did.
  const memo = createMemo(10)
  let calls = 0
  const compute = () => {
    calls += 1
    return undefined
  }

  memo.remember("k", compute)
  memo.remember("k", compute)

  assert.equal(calls, 1)
})

test("the least recently USED entry is evicted, not the oldest inserted", () => {
  const memo = createMemo(2)
  const made: string[] = []
  const compute = (id: string) => () => {
    made.push(id)
    return { id }
  }

  memo.remember("a", compute("a"))
  memo.remember("b", compute("b"))
  memo.remember("a", compute("a")) // touches "a", so "b" is now the coldest
  memo.remember("c", compute("c")) // over the limit: evicts "b"

  memo.remember("a", compute("a"))
  assert.deepEqual(made, ["a", "b", "c"], "'a' survived because it was used")

  memo.remember("b", compute("b"))
  assert.deepEqual(made, ["a", "b", "c", "b"], "'b' was the one evicted")
})

test("the cap is honoured, so a bored visitor cannot grow the map without bound", () => {
  const memo = createMemo(3)
  const seen: string[] = []
  for (let i = 0; i < 50; i++) {
    memo.remember(`k${i}`, () => {
      seen.push(`k${i}`)
      return { i }
    })
  }
  assert.equal(seen.length, 50, "every distinct key was computed once")

  // Only the last three can still be resident.
  let recomputed = 0
  for (const i of [47, 48, 49]) {
    memo.remember(`k${i}`, () => {
      recomputed += 1
      return { i }
    })
  }
  assert.equal(recomputed, 0)
})

test("keys are built from all their parts, and differ when any part does", () => {
  const memo = createMemo(10)

  assert.equal(memo.key("a", 1), memo.key("a", 1))
  assert.notEqual(memo.key("a", 1), memo.key("a", 2))
  assert.notEqual(memo.key("a", 1), memo.key("b", 1))
  // The separator matters: without it ("ab", "c") and ("a", "bc") would collide
  // and two different questions would share one answer.
  assert.notEqual(memo.key("ab", "c"), memo.key("a", "bc"))
})

test("resetMemos clears every memo this process made", () => {
  const first = createMemo(10)
  const second = createMemo(10)
  let calls = 0
  const compute = () => {
    calls += 1
    return { value: 1 }
  }

  first.remember("k", compute)
  second.remember("k", compute)
  assert.equal(calls, 2)

  resetMemos()

  first.remember("k", compute)
  second.remember("k", compute)
  assert.equal(calls, 4, "a memo the registry missed would serve stale scoring")
})
