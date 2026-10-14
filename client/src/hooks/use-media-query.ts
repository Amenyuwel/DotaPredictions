import { useEffect, useState } from "react"

/**
 * Whether a CSS media query currently matches.
 *
 * For the one thing CSS cannot do on its own: rendering a subtree in a
 * different PLACE at a different width. Hiding one copy with `lg:hidden` and
 * showing another is two copies of the answer in the document -- two live
 * regions announcing the same number, and two sets of the same headings for a
 * screen reader to walk past.
 *
 * Read synchronously on the first render rather than in an effect, so the first
 * paint is already the right layout instead of the wide one flashing on a
 * phone. Kept in step afterwards by the list's own change event.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(query).matches === true,
  )

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const list = window.matchMedia(query)
    // No re-read on subscribe. The initialiser above ran during this same
    // render pass, so there is no width change for one to catch, and a
    // setState here would start a second render on every mount.
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    list.addEventListener("change", onChange)
    return () => list.removeEventListener("change", onChange)
  }, [query])

  return matches
}
