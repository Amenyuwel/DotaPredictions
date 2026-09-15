import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { test } from "node:test"

import {
  assertDevLoginSafe,
  checkPassword,
  devLoginEnabled,
  mintToken,
  verifyToken,
  type DevLoginSettings,
} from "../src/admin/dev-login.js"

/**
 * These pin the ways the local admin door could quietly stop being a door.
 *
 * It is a development shortcut past the only authentication this server has, so
 * every case below targets a failure that would look like nothing on screen: a
 * forged token accepted, an expired one accepted, the whole thing switched on
 * by a stray environment variable, or -- the one that matters most -- reaching
 * production at all.
 *
 * Settings are passed in rather than set through the environment. That is what
 * lets one process check a dozen different configurations, and it is why those
 * functions take them as an argument: a module that reads its config once at
 * import can only ever be tested in the configuration the machine happens to
 * have.
 */

const GOOD: DevLoginSettings = {
  enabled: true,
  username: "someone",
  password: "a-password",
  secret: "0".repeat(64),
}

const DEV = false
const PROD = true

// ---------------------------------------------------------------------------
// off by default
// ---------------------------------------------------------------------------

test("off when the flag is not set", () => {
  assert.equal(devLoginEnabled({ ...GOOD, enabled: false }), false)
})

test("off when any credential is missing, including the signing secret", () => {
  // Each of these is a half-configured .env, which is the realistic shape of a
  // mistake here. None of them may leave a door ajar.
  for (const field of ["username", "password", "secret"] as const) {
    assert.equal(
      devLoginEnabled({ ...GOOD, [field]: "" }),
      false,
      `a blank ${field} should not enable it`,
    )
  }
})

test("a partial configuration accepts nothing rather than defaulting", () => {
  // The failure this rules out: falling back to some built-in pair, which would
  // be a password published in the repository.
  const settings = { ...GOOD, password: "" }
  assert.equal(checkPassword("someone", "", settings), null)
  assert.equal(checkPassword("someone", "a-password", settings), null)
})

// ---------------------------------------------------------------------------
// production
// ---------------------------------------------------------------------------

test("the process refuses to start with the flag set in production", () => {
  assert.throws(
    () => assertDevLoginSafe(GOOD, PROD),
    (err: unknown) => err instanceof Error && err.message.includes("ADMIN_DEV_LOGIN"),
  )
})

test("production refuses on the FLAG, not on whether credentials are complete", () => {
  // A production deployment that sets this at all has made a mistake worth
  // stopping for, even when the mistake is currently inert.
  assert.throws(
    () => assertDevLoginSafe({ enabled: true, username: "", password: "", secret: "" }, PROD),
    Error,
  )
})

test("production with the flag off starts normally", () => {
  assert.doesNotThrow(() => assertDevLoginSafe({ ...GOOD, enabled: false }, PROD))
})

test("development with the flag on starts normally", () => {
  assert.doesNotThrow(() => assertDevLoginSafe(GOOD, DEV))
})

// ---------------------------------------------------------------------------
// the credential check
// ---------------------------------------------------------------------------

test("the right pair is accepted and either wrong half is not", () => {
  assert.ok(checkPassword("someone", "a-password", GOOD))
  assert.equal(checkPassword("someone", "a-passwore", GOOD), null)
  assert.equal(checkPassword("someonf", "a-password", GOOD), null)
  assert.equal(checkPassword("", "", GOOD), null)
})

test("a length mismatch is refused rather than thrown", () => {
  // `timingSafeEqual` throws when the buffers differ in length. An exception
  // escaping here would be a 500 that tells the caller their password was the
  // wrong LENGTH, which is a hint they did not have a moment earlier.
  assert.equal(checkPassword("someone", "x", GOOD), null)
  assert.equal(checkPassword("someone", "x".repeat(4096), GOOD), null)
  assert.equal(checkPassword("x".repeat(4096), "a-password", GOOD), null)
})

test("non-string input is rejected rather than coerced", () => {
  // A JSON body is attacker-shaped: `{"username": {}}` or an array must never
  // reach a comparison that might coerce into a match.
  for (const value of [null, undefined, 0, {}, [], true]) {
    assert.equal(checkPassword(value, "a-password", GOOD), null)
    assert.equal(checkPassword("someone", value, GOOD), null)
  }
})

// ---------------------------------------------------------------------------
// the token
// ---------------------------------------------------------------------------

test("a minted token verifies back to the same identity", () => {
  const identity = checkPassword("someone", "a-password", GOOD)!
  const { token, expiresAt } = mintToken(identity, GOOD)
  assert.deepEqual(verifyToken(token, GOOD), identity)
  assert.ok(Date.parse(expiresAt) > Date.now())
})

test("a token signed with another secret is refused", () => {
  // The whole point of signing: a token is not a bearer string a client can
  // compose, it is one this server produced.
  const { token } = mintToken({ userId: "u", email: "e" }, GOOD)
  assert.equal(verifyToken(token, { ...GOOD, secret: "f".repeat(64) }), null)
})

test("a tampered payload is refused", () => {
  const { token } = mintToken({ userId: "u", email: "e" }, GOOD)
  const signature = token.split(".").pop()!
  const forged = Buffer.from(`elevated|e|${Date.now() + 1e6}|x`, "utf8").toString("base64url")
  assert.equal(verifyToken(`devadmin.${forged}.${signature}`, GOOD), null)
})

test("an expired token is refused", () => {
  // Built by hand rather than by waiting eight hours, and signed CORRECTLY --
  // so the only thing wrong with it is the clock, which is exactly the case
  // that must not pass.
  const body = Buffer.from(`u|e|${Date.now() - 1000}|x`, "utf8").toString("base64url")
  const sig = createHmac("sha256", GOOD.secret).update(body).digest("base64url")
  assert.equal(verifyToken(`devadmin.${body}.${sig}`, GOOD), null)
})

test("a Supabase JWT is not mistaken for one of these", () => {
  assert.equal(verifyToken("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", GOOD), null)
})

test("malformed bearers are refused rather than parsed", () => {
  for (const token of ["", "devadmin.", "devadmin.onlyonepart", "devadmin..", "garbage"]) {
    assert.equal(verifyToken(token, GOOD), null, `${token || "(empty)"} should not verify`)
  }
})

test("nothing verifies while the door is switched off", () => {
  // Minting and verifying are separate processes in the real world: a token
  // issued while the flag was on must stop working the moment it is off.
  const { token } = mintToken({ userId: "u", email: "e" }, GOOD)
  assert.equal(verifyToken(token, { ...GOOD, enabled: false }), null)
})

test("the identity is stable across logins, so the audit trail groups them", () => {
  const first = checkPassword("someone", "a-password", GOOD)!
  const second = checkPassword("someone", "a-password", GOOD)!
  assert.equal(first.userId, second.userId)
  // Shaped as a uuid, because that is what the author_id column holds.
  assert.match(first.userId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  // And it says out loud which door was used, wherever it is displayed.
  assert.match(first.email, /local dev login/)
})
