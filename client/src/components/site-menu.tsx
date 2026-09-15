import { CircleHelp, Menu } from "lucide-react"

import { AccountItems } from "@/components/account-menu"
import { ThemeItems } from "@/components/theme-menu"
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
import type { AuthState } from "@/hooks/use-session"

/**
 * Everything the wide header spreads across its right edge, on a header too
 * narrow to spread anything.
 *
 * The three controls fit at 1024px and do not fit at 400px, where they wrapped
 * onto a second line under the title -- a row of chrome sitting where the page
 * proper should start, pushing the first question below the fold on the screen
 * with the least of it. One button collapses them.
 *
 * Flattened rather than nested: theme is a radio group inline under its own
 * label instead of a submenu, because a submenu on a touch screen is a second
 * press onto a popup that opens off the edge of a 400px viewport.
 *
 * What is NOT in here: the stage. It is the one control that changes which
 * question the page is answering, and the answer on screen is only meaningful
 * next to the stage that produced it, so it stays named in the header at every
 * width. The run's alarm badges stay out for the same reason -- a freshness
 * gate that was overridden is not a preference, and folding it into a menu
 * makes it something a reader has to go and look for.
 */
export function SiteMenu({
  auth,
  onSignIn,
  onOpenFaq,
}: {
  auth: AuthState
  onSignIn: () => void
  onOpenFaq: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="icon-sm" variant="ghost" aria-label="Menu">
            <Menu aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        <AccountItems state={auth} onSignIn={onSignIn} />

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onOpenFaq}>
          <CircleHelp aria-hidden />
          What this tool is doing
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Grouped because the label requires it -- `DropdownMenuLabel` is Base
            UI's `Menu.GroupLabel` and throws without a `Menu.Group` above it,
            which takes the whole page down rather than the menu. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <ThemeItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
