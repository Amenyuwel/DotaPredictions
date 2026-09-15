import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

import { config } from "../config.js"
import type { AdminIdentity } from "./auth.js"

/**
 * A username and password that stand in for Supabase auth, for local work only.
 *
 * Why this exists: the real gate needs a Supabase session, and getting one needs
 * a working OAuth round trip, which needs redirect URIs registered with Google.
 * That is correct for a deployed tool and a wall in front of someone who just
 * wants to see whether the editor works on their own machine.
 *
 * Why it is shaped like this rather than as a password compared in the browser:
 *
 *  - A credential checked in the client is not a credential. It ships inside
 *    the bundle, and the check can be stepped over in a devtools console. More
 *    to the point it would not WORK -- every admin route verifies a bearer
 *    token server-side, so a browser that has merely decided it is an admin
 *    gets a 403 on save and no explanation.
 *  - So the check happens here, and what it hands back is a signed, expiring
 *    token. That token is what `requireAdmin` accepts, through the same door
 *    the Supabase path uses.
 *
 * What keeps it from becoming a hole: it cannot be switched on by accident and
 * it cannot reach production. `ADMIN_DEV_LOGIN` must be set on purpose, the
 * username and password have no defaults, and `assertDevLoginSafe` takes the
 * process down at boot if the flag is ever set with NODE_ENV=production. A
 * shortcut that fails loudly in the one environment it must not be in is a
 * shortcut; one that merely warns is a vulnerability with a comment above it.
 */

/** Marks a bearer as this scheme's rather than Supabase's. Supabase access
 * tokens are JWTs and start `ey`, so there is no overlap to resolve. */
const PREFIX = "devadmin."

/** Eight hours: one working session. Long enough not to interrupt, short enough
 * that a token left in a tab overnight is dead by morning. */
const TTL_MS = 8 * 60 * 60 * 1000

/**
 * What this door is configured with.
 *
 * Taken as an argument, defaulting to `config.adminDevLogin`, so that every
 * function here is a pure function of its settings rather than of a module read
 * once at import. Production call sites pass nothing and read the environment;
 * the tests pass settings directly, which is the only way to check that the
 * door is OFF under a dozen different environments in one process.
 */
export interface DevLoginSettings {
  enabled: boolean
  username: string
  password: string
  secret: string
}

const settingsOf = (given?: DevLoginSettings): DevLoginSettings => given ?? config.adminDevLogin

export function devLoginEnabled(given?: DevLoginSettings): boolean {
  const { enabled, username, password, secret } = settingsOf(given)
  return Boolean(enabled && username && password && secret)
}

/**
 * Refuse to boot rather than run this in production.
 *
 * Called from `index.ts` before the server listens. The check is deliberately
 * on the FLAG and not on whether the credentials are complete: a production
 * deployment that sets `ADMIN_DEV_LOGIN` at all has made a mistake worth
 * stopping for, even if the mistake is currently harmless because the password
 * is missing.
 */
export function assertDevLoginSafe(
  given?: DevLoginSettings,
  isProduction: boolean = config.isProduction,
): void {
  if (!isProduction || !settingsOf(given).enabled) return
  throw new Error(
    "ADMIN_DEV_LOGIN is set with NODE_ENV=production.\n" +
      "This is a local development shortcut: it replaces the Supabase session and\n" +
      "the public.admins check with a username and password held in an environment\n" +
      "variable. Anyone who learns that pair can rewrite the scoring table that\n" +
      "every visitor's projections are computed from.\n" +
      "Unset ADMIN_DEV_LOGIN and sign in through Supabase instead.",
  )
}

/** Verify the pair. Returns an identity or null; never says which half failed,
 * because the difference is only useful to somebody guessing. */
export function checkPassword(
  username: unknown,
  password: unknown,
  given?: DevLoginSettings,
): AdminIdentity | null {
  const settings = settingsOf(given)
  if (!devLoginEnabled(settings)) return null
  if (typeof username !== "string" || typeof password !== "string") return null

  // Both compared in constant time. The username is not secret, but comparing
  // it with `===` and the password in constant time is the kind of asymmetry
  // that gets copied into somewhere it matters.
  const userOk = constantTimeEqual(username, settings.username)
  const passOk = constantTimeEqual(password, settings.password)
  if (!userOk || !passOk) return null

  return { userId: devUserId(username), email: `${username} (local dev login)` }
}

/**
 * A stable id for the local admin.
 *
 * Stable so the audit trail groups their edits together across sessions, and
 * not a real `auth.users` id because there is no such user. `config_overlays`
 * and `config_audit` hold `author_id` as a bare uuid with no foreign key
 * precisely so a row can outlive -- or never have had -- an account.
 */
function devUserId(username: string): string {
  const digest = createHmac("sha256", "dotapredictions-dev-admin").update(username).digest("hex")
  // Shaped as a uuid so the column and every reader of it see what they expect.
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-")
}

export function mintToken(
  identity: AdminIdentity,
  given?: DevLoginSettings,
): { token: string; expiresAt: string } {
  const expiresAtMs = Date.now() + TTL_MS
  // The jti makes two tokens minted in the same millisecond different, so one
  // cannot be mistaken for a replay of the other in a log.
  const body = `${identity.userId}|${identity.email}|${expiresAtMs}|${randomUUID()}`
  const encoded = Buffer.from(body, "utf8").toString("base64url")
  return {
    token: `${PREFIX}${encoded}.${sign(encoded, settingsOf(given))}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  }
}

/** The identity behind a dev token, or null for anything that is not one. */
export function verifyToken(token: string, given?: DevLoginSettings): AdminIdentity | null {
  const settings = settingsOf(given)
  if (!devLoginEnabled(settings) || !token.startsWith(PREFIX)) return null

  const [encoded, signature] = token.slice(PREFIX.length).split(".")
  if (!encoded || !signature) return null
  if (!constantTimeEqual(signature, sign(encoded, settings))) return null

  const [userId, email, expiresAtMs] = Buffer.from(encoded, "base64url")
    .toString("utf8")
    .split("|")
  if (!userId || !expiresAtMs) return null
  if (Number(expiresAtMs) <= Date.now()) return null

  return { userId, email: email ?? "" }
}

function sign(encoded: string, settings: DevLoginSettings): string {
  return createHmac("sha256", settings.secret).update(encoded).digest("base64url")
}

/** Constant time, and length-safe: `timingSafeEqual` throws on a length
 * mismatch, which would itself leak the length through an exception. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  if (left.length !== right.length) {
    // Still compare something, so the failing path costs what the other does.
    timingSafeEqual(left, left)
    return false
  }
  return timingSafeEqual(left, right)
}
