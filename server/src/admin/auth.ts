import type { NextFunction, Request, Response } from "express"

import { config } from "../config.js"
import { postgrest } from "./rest.js"

/**
 * Who is allowed to change the configuration.
 *
 * Until this file existed, this server had no authentication of any kind, and
 * that was a correct design: every endpoint answers a question about public
 * knowledge, from an immutable run, with no side effects. Adding a write path
 * is what makes an identity necessary, so the check is deliberately the
 * narrowest thing that can work.
 *
 * Two questions, asked separately, in this order:
 *
 *   1. Is this token real?  Answered by Supabase, not by us. The bearer is sent
 *      to `GET /auth/v1/user` and the answer is whatever that endpoint says.
 *   2. Is that user an admin?  Answered by `public.admins`, read with the
 *      secret key, which is the only key that can read it.
 *
 * Verifying the JWT locally would be faster and would mean writing signature
 * verification, algorithm pinning and key rotation into this repository -- three
 * things that are catastrophic and silent when subtly wrong. An admin request
 * happens a few times a day. It can afford a round trip, and the round trip
 * cannot be subtly wrong: an invalid token comes back as an error, not as a
 * payload that parses.
 *
 * The browser also knows whether it is an admin, by reading its own row under
 * row-level security. That answer decides whether a menu item renders and
 * nothing else. It is never sent here and never trusted here -- this function
 * re-asks both questions on every single request, so a forged local answer buys
 * a visible link and a 403 behind it.
 */

export interface AdminIdentity {
  userId: string
  email: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminIdentity
    }
  }
}

/**
 * Whether an admin request could even be answered here.
 *
 * A deployment running from `RUN_FILE` with no Supabase credentials has no
 * `admins` table to consult. That must be a refusal rather than a pass: an
 * unanswerable authorisation question is not a yes. It is also not a 403 -- the
 * caller did nothing wrong -- so the routes report it as unavailable and say
 * which credentials are missing.
 */
export function adminAvailable(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseSecretKey)
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!adminAvailable()) {
    res.status(503).json({
      error: "admin_unavailable",
      reason:
        "This deployment has no Supabase credentials, so there is no admin list to " +
        "check against. An authorisation question that cannot be answered is not a yes.",
      hint: "Set SUPABASE_URL and SUPABASE_SECRET_KEY.",
    })
    return
  }

  const token = bearerOf(req.header("authorization"))
  if (!token) {
    res.status(401).json({
      error: "unauthenticated",
      reason: "No bearer token. Sign in, then send the Supabase access token.",
    })
    return
  }

  let identity: AdminIdentity | null
  try {
    identity = await resolveAdmin(token)
  } catch (err) {
    // Supabase unreachable. NOT a 403 and NOT a pass: the question could not be
    // asked, so the answer is neither yes nor no, and the caller is told which.
    // Degrading to "allow" here is the one place in this project where degrading
    // gracefully would be the wrong instinct -- a read can fall back to a smaller
    // sample, a write cannot fall back to an unchecked identity.
    res.status(503).json({
      error: "admin_check_failed",
      reason: `could not verify this session: ${err instanceof Error ? err.message : String(err)}`,
    })
    return
  }

  if (!identity) {
    // One status for "not signed in as anyone real" and for "signed in and not
    // an admin" is deliberate: a 403 that only admins receive turns this
    // endpoint into an oracle for who is an admin.
    res.status(403).json({
      error: "forbidden",
      reason: "This account cannot change the configuration.",
    })
    return
  }

  req.admin = identity
  next()
}

/** The token, or null. Case-insensitive on the scheme, because `Bearer` arrives
 * capitalised by every library and lowercased by some proxies. */
export function bearerOf(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, ...rest] = header.trim().split(/\s+/)
  if (!scheme || scheme.toLowerCase() !== "bearer") return null
  const token = rest.join("")
  return token.length > 0 ? token : null
}

/**
 * The user behind this token, if they are an admin.
 *
 * Returns null for both "the token is not valid" and "the user is not an
 * admin". The caller cannot tell those apart, and neither can the requester.
 * Throws only when the question could not be asked at all.
 */
async function resolveAdmin(token: string): Promise<AdminIdentity | null> {
  const res = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.supabaseSecretKey,
      // The USER's token, not the server's key. This request is asking "who is
      // this", so it must be made as them.
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(10_000),
  })

  // 401/403 is a bad token: a real answer, and the answer is no.
  if (res.status === 401 || res.status === 403) return null
  if (!res.ok) {
    throw new Error(`GET /auth/v1/user -> ${res.status} ${(await res.text()).slice(0, 200)}`)
  }

  const user = (await res.json()) as { id?: string; email?: string }
  if (!user.id) return null

  const rows = await postgrest<{ user_id: string; email: string }[]>("admins", {
    select: "user_id,email",
    user_id: `eq.${user.id}`,
    limit: "1",
  })
  if (rows.length === 0) return null

  // The email from the auth record, not from the admins row: that column is a
  // convenience for reading the audit trail and can go stale, and the audit
  // should record the address the action was actually taken under.
  return { userId: user.id, email: user.email ?? rows[0]!.email ?? "" }
}
