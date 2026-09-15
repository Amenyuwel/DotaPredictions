/**
 * The local development admin session, held in the browser.
 *
 * `sessionStorage`, not `localStorage`, and the difference is the point: this
 * token is a development shortcut past a real sign-in, so it should die with
 * the tab rather than sit on disk until somebody clears it. Reopening the
 * browser means signing in again, which is the correct amount of friction for
 * a credential that lives in a `.env` file.
 *
 * The token is opaque here. It is signed and expiring, minted by the server,
 * and this module only carries it -- nothing in the browser decides whether it
 * is valid, because nothing in the browser is asked.
 */

const KEY = "dotapredictions.dev-admin"

interface Stored {
  token: string
  expiresAt: string
  email: string
}

/** Every access is wrapped: a private window, blocked site data, or a
 * cross-origin iframe can make `sessionStorage` throw on read rather than
 * return empty, and an admin page that white-screens on a storage policy is
 * worse than one that asks for a password again. */
function read(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    // Checked here only so an obviously dead token does not cost a round trip.
    // The server checks it properly; this is a convenience, not a gate.
    if (!parsed.token || Date.parse(parsed.expiresAt) <= Date.now()) {
      clearDevSession()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function devSession(): Stored | null {
  return read()
}

export function devToken(): string | null {
  return read()?.token ?? null
}

export function setDevSession(value: Stored): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // Storage refused. The session still works for this page load -- the token
    // is in memory in the caller -- it simply will not survive a reload.
  }
}

export function clearDevSession(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to do: there was nothing readable to remove.
  }
}
