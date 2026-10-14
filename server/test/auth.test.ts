// First, before config.js resolves the environment -- see the module for why.
import "./support/admin-env.js"

import assert from "node:assert/strict"
import { afterEach, test } from "node:test"

import { config } from "../src/config.js"
import { adminAvailable, bearerOf, requireAdmin } from "../src/admin/auth.js"

/**
 * The only gate in this project that decides whether a write happens.
 *
 * Everything else here answers a question about public knowledge from an
 * immutable run, so its worst failure is a wrong number. This file's worst
 * failure is a stranger rewriting the scoring table every visitor's projection
 * is computed from -- so the cases pinned below are the ones where a plausible
 * refactor turns a refusal into a pass:
 *
 *   * an unanswerable question must be a 503, never a yes. If Supabase is
 *     unreachable the honest answer is neither "admin" nor "not admin", and the
 *     tempting shortcut -- degrade gracefully, as every read path here does --
 *     is the one place in this project where degrading is wrong.
 *   * a bad token and a real user who is not an admin must be INDISTINGUISHABLE.
 *     A 403 that only non-admins receive turns this endpoint into an oracle for
 *     who the admins are.
 *   * `next()` must be reached only after both questions were actually asked,
 *     and `req.admin` must carry the identity from the auth record rather than
 *     from the admins row, which can go stale.
 */

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

/** Answers as Supabase would, per URL. `user` is the `/auth/v1/user` reply and
 * `admins` is the PostgREST row set; either may be a status to fail with. */
function stubSupabase(opts: {
  user?: { status: number; body?: unknown }
  admins?: { status: number; body?: unknown }
  onAuthRequest?: (init: RequestInit | undefined) => void
}): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/auth/v1/user")) {
      opts.onAuthRequest?.(init)
      const { status = 200, body = {} } = opts.user ?? {}
      return new Response(JSON.stringify(body), { status })
    }
    if (url.includes("/rest/v1/admins")) {
      const { status = 200, body = [] } = opts.admins ?? {}
      return new Response(JSON.stringify(body), { status })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof fetch
}

interface Captured {
  status: number | null
  body: Record<string, unknown> | null
  nexted: boolean
  admin: { userId: string; email: string } | undefined
}

/** Runs the middleware against one authorization header and reports what it
 * did: the response it sent, or that it called `next()`. */
async function run(authorization: string | undefined): Promise<Captured> {
  const captured: Captured = { status: null, body: null, nexted: false, admin: undefined }

  const req = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? authorization : undefined,
  } as unknown as Parameters<typeof requireAdmin>[0]

  const res = {
    status(code: number) {
      captured.status = code
      return this
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload
      return this
    },
  } as unknown as Parameters<typeof requireAdmin>[1]

  await requireAdmin(req, res, () => {
    captured.nexted = true
    captured.admin = (req as { admin?: { userId: string; email: string } }).admin
  })

  return captured
}

// ---------------------------------------------------------------------------
// bearerOf
// ---------------------------------------------------------------------------

test("a missing or malformed authorization header yields no token", () => {
  assert.equal(bearerOf(undefined), null)
  assert.equal(bearerOf(""), null)
  assert.equal(bearerOf("   "), null)
  assert.equal(bearerOf("Bearer"), null, "a scheme with nothing after it is not a token")
  assert.equal(bearerOf("Bearer "), null, "an empty token is not a token")
})

test("only the bearer scheme is accepted, in any casing", () => {
  assert.equal(bearerOf("Bearer abc"), "abc")
  assert.equal(bearerOf("bearer abc"), "abc", "lowercased by some proxies")
  assert.equal(bearerOf("BEARER abc"), "abc")
  assert.equal(bearerOf("Basic abc"), null, "a password is not a session")
  assert.equal(bearerOf("abc"), null, "a bare token names no scheme")
})

test("surrounding and repeated whitespace does not change the token", () => {
  assert.equal(bearerOf("  Bearer   abc  "), "abc")
})

// ---------------------------------------------------------------------------
// adminAvailable
// ---------------------------------------------------------------------------

test("admin is available only when both credentials are configured", () => {
  assert.equal(adminAvailable(), true)

  // `as const` is compile-time only, so the deployment shape can be simulated
  // here. Restored immediately: every later test reads the same object.
  const mutable = config as { -readonly [K in keyof typeof config]: (typeof config)[K] }
  const url = mutable.supabaseUrl
  try {
    mutable.supabaseUrl = ""
    assert.equal(adminAvailable(), false)
  } finally {
    mutable.supabaseUrl = url
  }
})

test("a deployment with no admin list refuses rather than passing", async () => {
  const mutable = config as { -readonly [K in keyof typeof config]: (typeof config)[K] }
  const key = mutable.supabaseSecretKey
  try {
    mutable.supabaseSecretKey = ""
    const result = await run("Bearer anything")

    assert.equal(result.nexted, false, "an unanswerable question is not a yes")
    assert.equal(result.status, 503)
    assert.equal(result.body?.error, "admin_unavailable")
  } finally {
    mutable.supabaseSecretKey = key
  }
})

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

test("no bearer token is unauthenticated, not forbidden", async () => {
  const result = await run(undefined)

  assert.equal(result.nexted, false)
  assert.equal(result.status, 401)
  assert.equal(result.body?.error, "unauthenticated")
})

test("a token supabase rejects is forbidden, and says nothing more", async () => {
  stubSupabase({ user: { status: 401 } })
  const result = await run("Bearer forged")

  assert.equal(result.nexted, false)
  assert.equal(result.status, 403)
  assert.equal(result.body?.error, "forbidden")
})

test("a real user with no admins row gets the SAME answer as a forged token", async () => {
  stubSupabase({
    user: { status: 200, body: { id: "user-1", email: "someone@example.com" } },
    admins: { status: 200, body: [] },
  })
  const result = await run("Bearer real-but-not-admin")

  assert.equal(result.nexted, false)
  assert.equal(result.status, 403, "otherwise this endpoint names the admins")
  assert.equal(result.body?.error, "forbidden")
})

test("supabase being unreachable is a 503, never a pass", async () => {
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED")
  }) as typeof fetch

  const result = await run("Bearer real")

  assert.equal(result.nexted, false, "a write cannot fall back to an unchecked identity")
  assert.equal(result.status, 503)
  assert.equal(result.body?.error, "admin_check_failed")
})

test("a 500 from the auth endpoint is unreachable, not a rejection", async () => {
  stubSupabase({ user: { status: 500, body: { message: "boom" } } })
  const result = await run("Bearer real")

  assert.equal(result.status, 503, "a broken dependency is not evidence of a bad token")
  assert.equal(result.body?.error, "admin_check_failed")
})

test("an admin passes, carrying the identity from the auth record", async () => {
  stubSupabase({
    user: { status: 200, body: { id: "user-1", email: "current@example.com" } },
    // Deliberately a different address: the admins row is a convenience for
    // reading the audit trail and can go stale, and the audit should record the
    // address the action was actually taken under.
    admins: { status: 200, body: [{ user_id: "user-1", email: "stale@example.com" }] },
  })

  const result = await run("Bearer real-admin")

  assert.equal(result.nexted, true)
  assert.equal(result.status, null, "no response is sent when the gate opens")
  assert.deepEqual(result.admin, { userId: "user-1", email: "current@example.com" })
})

test("the user lookup is made as the caller, not as the server", async () => {
  let seen: RequestInit | undefined
  stubSupabase({
    user: { status: 200, body: { id: "user-1", email: "a@example.com" } },
    admins: { status: 200, body: [{ user_id: "user-1", email: "a@example.com" }] },
    onAuthRequest: (init) => {
      seen = init
    },
  })

  await run("Bearer caller-token")

  const headers = seen?.headers as Record<string, string>
  assert.equal(
    headers.Authorization,
    "Bearer caller-token",
    "asking who this is must be done as them",
  )
  assert.equal(headers.apikey, config.supabaseSecretKey)
})

test("an auth record with no id is not a user", async () => {
  stubSupabase({ user: { status: 200, body: {} } })
  const result = await run("Bearer odd")

  assert.equal(result.nexted, false)
  assert.equal(result.status, 403)
})
