import { useEffect, useState } from "react"

import { authConfigured, supabase, type Session } from "@/lib/supabase"

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
  const [state, setState] = useState<AuthState>(
    authConfigured ? { status: "loading" } : { status: "unavailable" },
  )

  useEffect(() => {
    if (!supabase) return

    let live = true
    supabase.auth.getSession().then(({ data }) => {
      if (!live) return
      setState(data.session ? { status: "user", session: data.session } : { status: "guest" })
    })

    // Covers the OAuth round trip: the provider redirects back, the library
    // exchanges the code, and this fires with the new session. Nothing polls.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: "user", session } : { status: "guest" })
    })

    return () => {
      live = false
      sub.subscription.unsubscribe()
    }
  }, [])

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
