import { useCallback, useEffect, useState } from "react"

import {
  DARK_QUERY,
  applyPalette,
  readTheme,
  storeTheme,
  systemPalette,
  type Palette,
  type Theme,
} from "@/lib/theme"

/**
 * The theme choice, and the palette it currently resolves to.
 *
 * Both are returned because they answer different questions and a control needs
 * both: the menu marks "System" as chosen, while the trigger shows a moon
 * because system happens to mean dark right now.
 *
 * Only two things here are state, and neither is the palette. The choice is
 * state because a click changes it; what the OS is asking for is state because
 * it changes underneath us, which is the definition of an external system. The
 * palette is neither -- it is those two combined, so it is derived during
 * render and cannot lag a frame behind the thing it is derived from.
 *
 * The OS is watched even while the choice is explicit. The listener is one per
 * document and fires about as often as someone changes their wallpaper, and the
 * alternative -- subscribing only under "system" -- means the value is stale at
 * the exact moment it starts being read, on the click that selects "System".
 */
export function useTheme(): {
  theme: Theme
  palette: Palette
  setTheme: (next: Theme) => void
} {
  const [theme, setState] = useState<Theme>(readTheme)
  const [system, setSystem] = useState<Palette>(systemPalette)
  const palette = theme === "system" ? system : theme

  useEffect(() => {
    // `matchMedia` is missing in a few test and embedded runtimes. The page has
    // already been painted at the resolved palette by then, so the only thing
    // lost is following a later OS change.
    if (typeof matchMedia !== "function") return

    const media = matchMedia(DARK_QUERY)
    const onChange = (event: MediaQueryListEvent) =>
      setSystem(event.matches ? "dark" : "light")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  // The document is the external system being synchronised here: the boot
  // script in `index.html` set the class before React existed, and from the
  // first render on this is what keeps it true.
  useEffect(() => applyPalette(palette), [palette])

  const setTheme = useCallback((next: Theme) => {
    setState(next)
    storeTheme(next)
    // Re-read rather than trust the value the listener last delivered: the OS
    // can change while the choice is explicit in a runtime with no `matchMedia`
    // event to hear it, and this is the moment that value starts being used.
    if (next === "system") setSystem(systemPalette())
  }, [])

  return { theme, palette, setTheme }
}
