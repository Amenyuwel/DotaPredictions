import { useState } from "react"
import { LogOut, SlidersHorizontal, UserRound } from "lucide-react"

import { AuthDialog } from "@/components/auth-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAdmin } from "@/hooks/use-admin"
import { displayName, type AuthState } from "@/hooks/use-session"
import { signOut } from "@/lib/supabase"

/**
 * The only identity control in the app.
 *
 * Four states, each said plainly rather than collapsed into a generic button:
 * still checking, signed in, guest, and "this deployment has no auth
 * configured". The last one matters because a sign-in button that does nothing
 * is worse than a missing one.
 */
export function AccountMenu({ state }: { state: AuthState }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  // Whether to draw one menu item, and nothing else. The answer is not sent
  // anywhere and is never trusted: every admin request re-asks both halves of
  // the question on the server, with the only key that can read the admin list.
  // So a forged answer here buys a link and a 403 behind it.
  const admin = useAdmin(state)

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
      <>
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
          <UserRound aria-hidden />
          Sign in
        </Button>
        <AuthDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onGuest={() => setDialogOpen(false)}
        />
      </>
    )
  }

  const name = displayName(state.session)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" variant="ghost">
            <UserRound aria-hidden />
            <span className="max-w-40 truncate">{name}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal">
          {state.session.user.email ?? name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
