import { Monitor, Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/hooks/use-theme"
import { THEMES, type Theme } from "@/lib/theme"

const LABEL: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
}

const ICON: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

/**
 * The theme control: light, dark, or whatever the machine says.
 *
 * A menu rather than a two-state toggle, because a toggle can only express the
 * palette on screen and there are three things to express. With a toggle, a
 * reader who wants to go back to following the OS has no way to say so -- the
 * only route back is clearing site data.
 *
 * The trigger wears the icon of the palette currently painted, not of the
 * choice: under "System" at night it shows a moon, because it is reporting what
 * the reader is looking at. The choice is what the menu marks, and the button's
 * accessible name says both, so the distinction survives without the icon.
 */
export function ThemeMenu() {
  const { theme, palette, setTheme } = useTheme()
  const TriggerIcon = ICON[palette]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Theme: ${LABEL[theme].toLowerCase()}`}
          >
            <TriggerIcon aria-hidden />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(next) => setTheme(next as Theme)}
        >
          {THEMES.map((option) => {
            const Icon = ICON[option]
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <Icon aria-hidden />
                {LABEL[option]}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
