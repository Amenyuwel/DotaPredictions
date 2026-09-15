import { useEffect, useState } from "react"

import { supabase } from "@/lib/supabase"
import type { AuthState } from "@/hooks/use-session"

/**
 * Whether to render the link to the configuration editor.
 *
 * That is the ENTIRE job. This answer decides what a menu looks like and
 * nothing else: it is never sent to the server, and the server never asks for
 * it. Every admin request re-asks both halves of the question itself -- is this
 * token real, and is that user in `public.admins` -- with the secret key, which
 * is the only key that can read that table.
 *
 * So a user who forges this locally gets a menu item and a 403 behind it. That
 * is the property worth having: the client's copy of an authorisation answer is
 * allowed to be wrong, because nothing depends on it being right.
 *
 * The read itself goes through row-level security and returns at most the
 * caller's own row, so it leaks nothing either -- the admin list is not
 * enumerable with the publishable key.
 */
export type AdminState =
  /** Still asking, or waiting on the session it depends on. */
  | { status: "loading" }
  | { status: "admin" }
  | { status: "not-admin" }
  /** No auth configured in this deployment, so nobody is an admin here. */
  | { status: "unavailable" }

export function useAdmin(session: AuthState): AdminState {
  /** The answer for the id that was actually asked about. Keyed rather than
   * bare, so a result that arrives after the user signed out -- or signed in as
   * somebody else -- is discarded instead of being shown against the new
   * session. */
  const [resolved, setResolved] = useState<{ userId: string; isAdmin: boolean } | null>(null)

  // The user id rather than the session object: the library refreshes the
  // session on a timer, and depending on the object would re-run this read
  // every time a token rotated, for an answer that cannot have changed.
  const userId = session.status === "user" ? session.session.user.id : null

  useEffect(() => {
    if (!userId || !supabase) return

    let live = true
    void supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return
        // An error here is "could not ask", and the honest rendering of that is
        // no link -- the page behind it would refuse anyway, and a link that
        // leads to a 403 is worse than no link.
        setResolved({ userId, isAdmin: !error && Boolean(data) })
      })

    return () => {
      live = false
    }
  }, [userId])

  // Derived during render rather than pushed into state by an effect. Three of
  // the four answers follow from the session alone and need no round trip, and
  // routing them through `setState` would render "loading" first and then the
  // answer -- a flicker on every page load, for a question already answered.
  if (session.status === "unavailable" || !supabase) return { status: "unavailable" }
  if (session.status === "loading") return { status: "loading" }
  if (!userId) return { status: "not-admin" }
  if (resolved?.userId !== userId) return { status: "loading" }
  return { status: resolved.isAdmin ? "admin" : "not-admin" }
}
