import { LogOut, SlidersHorizontal, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAdmin } from "@/hooks/use-admin"
import { displayName, type AuthState } from "@/hooks/use-session"
import { signOut } from "@/lib/supabase"

/**
 * Who is signed in and what that lets them reach, as menu items.
 *
 * All four states are answered here rather than only the signed-in one, because
 * the narrow header folds identity into the one menu it has and a gap where
 * "sign in" should be is indistinguishable from a deployment with no accounts.
 * Written once and used by both headers, so the wide and narrow layouts cannot
 * offer different routes into the same account.
 */
export function AccountItems({
  state,
  onSignIn,
}: {
  state: AuthState
  /** Opening the sign-in dialog is the host's job: a dialog mounted inside a
   * menu item unmounts with the menu the moment the item is pressed. */
  onSignIn: () => void
}) {
  // Whether to draw one menu item, and nothing else. The answer is not sent
  // anywhere and is never trusted: every admin request re-asks both halves of
  // the question on the server, with the only key that can read the admin list.
  // So a forged answer here buys a link and a 403 behind it.
  const admin = useAdmin(state)

  // Every label here is wrapped in a group, and that is load-bearing rather
  // than decorative: `DropdownMenuLabel` is Base UI's `Menu.GroupLabel`, which
  // THROWS when it cannot find a `Menu.Group` above it. A throw inside a menu
  // popup is not a broken menu -- there is no boundary between here and the
  // root, so React unmounts the whole application and the reader gets a blank
  // page with no message, from pressing a button that says their own name.
  if (state.status === "loading") {
    return (
      <DropdownMenuGroup>
        <DropdownMenuLabel>Checking sign-in…</DropdownMenuLabel>
      </DropdownMenuGroup>
    )
  }

  if (state.status === "unavailable") {
    return (
      <DropdownMenuGroup>
        <DropdownMenuLabel>Sign-in unavailable in this deployment</DropdownMenuLabel>
      </DropdownMenuGroup>
    )
  }

  if (state.status === "guest") {
    return (
      <DropdownMenuItem onClick={onSignIn}>
        <UserRound aria-hidden />
        Sign in
      </DropdownMenuItem>
    )
  }

  const name = displayName(state.session)

  return (
    // The group is what the address labels: these three items are the things
    // that can be done to THIS account, which is the sentence a screen reader
    // gets from the pairing.
    <DropdownMenuGroup>
      <DropdownMenuLabel className="truncate font-normal">
        {state.session.user.email ?? name}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {/* First, because it is the only item here that leads somewhere rather
          than doing something: saved work across every tournament and stage,
          which this run-scoped page structurally cannot show. */}
      <DropdownMenuItem render={<a href="/account" />}>
        <UserRound aria-hidden />
        Account and saved work
      </DropdownMenuItem>
      {admin.status === "admin" ? (
        <DropdownMenuItem render={<a href="/admin" />}>
          <SlidersHorizontal aria-hidden />
          Configuration
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onClick={() => void signOut()}>
        <LogOut aria-hidden />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

/**
 * The identity control on a header wide enough to give it its own room.
 *
 * Four states, each said plainly rather than collapsed into a generic button:
 * still checking, signed in, guest, and "this deployment has no auth
 * configured". The last one matters because a sign-in button that does nothing
 * is worse than a missing one.
 *
 * Signed out it is a button rather than a menu, because a menu holding one item
 * is a second press for nothing. Signed in it opens onto `AccountItems`, the
 * same list the narrow header's menu draws.
 */
export function AccountMenu({
  state,
  onSignIn,
}: {
  state: AuthState
  onSignIn: () => void
}) {
  if (state.status === "loading") {
    return (
      <span className="text-muted-foreground text-xs" aria-live="polite">
        Checking sign-in…
      </span>
    )
  }

  if (state.status === "unavailable") {
    return (
      <span className="text-muted-foreground text-xs">
        Sign-in unavailable in this deployment
      </span>
    )
  }

  if (state.status === "guest") {
    return (
      <Button size="sm" variant="outline" onClick={onSignIn}>
        <UserRound aria-hidden />
        Sign in
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant="ghost">
            <UserRound aria-hidden />
            <span className="max-w-40 truncate">{displayName(state.session)}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <AccountItems state={state} onSignIn={onSignIn} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
