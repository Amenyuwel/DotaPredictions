import { useEffect, useState } from "react"

import { authConfigured, getSupabase, mayHaveSession, type Session } from "@/lib/supabase"

export type AuthState =
  /** Still asking the library whether a stored session is valid. */
  | { status: "loading" }
  /** Signed in. */
  | { status: "user"; session: Session }
  /** Chose to continue without an account, or has no account yet. */
  | { status: "guest" }
  /** No credentials configured in this deployment; everyone is a guest. */
  | { status: "unavailable" }

/**
 * Who is using the tool.
 *
 * A guest and a signed-in user see the same projections -- the model does not
 * know or care who is asking. The only thing identity buys is persistence, so
 * this hook exists to answer one question: can what is on screen be saved?
 */
export function useSession(): AuthState {
  // Decided once, at mount, without the auth library: no stored session and
  // no OAuth redirect is a guest, answered before the first paint. Only a
  // load that could be signed in waits on the library (see the effect).
  const [needsClient] = useState(() => authConfigured && mayHaveSession())
  const [state, setState] = useState<AuthState>(
    !authConfigured
      ? { status: "unavailable" }
      : needsClient
        ? { status: "loading" }
        : { status: "guest" },
  )

  useEffect(() => {
    // A guest (decided above) never loads the auth library. Signing in
    // redirects away and back, so a guest who signs in returns on a fresh
    // load that starts as "loading" and takes the path below.
    if (!needsClient) return

    let live = true
    let unsubscribe = () => {}
    void getSupabase().then((supabase) => {
      if (!live || !supabase) return
      supabase.auth.getSession().then(({ data }) => {
        if (!live) return
        setState(data.session ? { status: "user", session: data.session } : { status: "guest" })
      })

      // Covers the OAuth round trip: the provider redirects back, the library
      // exchanges the code, and this fires with the new session. Nothing polls.
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        setState(session ? { status: "user", session } : { status: "guest" })
      })
      unsubscribe = () => sub.subscription.unsubscribe()
    })

    return () => {
      live = false
      unsubscribe()
    }
  }, [needsClient])

  return state
}

/** Display name for a signed-in user, falling back through what the provider
 * actually sent. Google and GitHub populate different fields, and an account
 * with neither still has an email. */
export function displayName(session: Session): string {
  const meta = session.user.user_metadata ?? {}
  return (
    (meta.user_name as string) ||
    (meta.full_name as string) ||
    (meta.name as string) ||
    session.user.email ||
    "Signed in"
  )
}
