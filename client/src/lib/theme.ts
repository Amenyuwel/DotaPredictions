/**
 * Which of the two palettes in `index.css` is on screen, and who decided.
 *
 * Three choices, not two. "System" is a real third state rather than a default
 * value for one of the others: a reader who has never touched the control wants
 * the page to follow the OS, and a reader who picked light at noon wants light
 * at midnight. Collapsing them loses the difference -- a stored "light" that
 * came from a preference and a stored "light" that came from the OS look
 * identical, and the second one stops tracking.
 *
 * The applied class is always concrete. Nothing below stores the resolved
 * palette -- `systemPalette` reads the OS on demand and `useTheme` combines it
 * with the choice during render, so there is no third value that can disagree
 * with the two it came from.
 */

/** In choice order, which is also the order the menu lists them. */
export const THEMES = ["light", "dark", "system"] as const

export type Theme = (typeof THEMES)[number]

/** What the stylesheet can actually paint: `.dark` is on the root, or it is not. */
export type Palette = "light" | "dark"

/**
 * Namespaced, because this origin also holds Supabase's auth keys and a bare
 * "theme" is the sort of name two libraries pick independently.
 *
 * Duplicated as a literal in `index.html`'s boot script, which has to read it
 * before any module exists. That copy is the one place it may be restated, and
 * it carries a comment pointing back here.
 */
export const THEME_STORAGE_KEY = "dotapredictions:theme"

export const DARK_QUERY = "(prefers-color-scheme: dark)"

const isTheme = (value: unknown): value is Theme =>
  THEMES.includes(value as Theme)

/**
 * The stored choice, or "system" for a first visit.
 *
 * Storage throws rather than returning null in a locked-down browser -- Safari
 * private mode, third-party iframe, cookies blocked -- so the read is guarded.
 * A theme that cannot be remembered is a smaller failure than a page that does
 * not render, and every call site treats "system" as the sane fallback.
 */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : "system"
  } catch {
    // Degrade, never fail the run.
    return "system"
  }
}

/** Remember a choice. Silently a no-op where storage is unavailable, which
 * means the choice holds for this tab and is forgotten on reload -- visibly
 * degraded, never broken. */
export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Degrade, never fail the run.
  }
}

/** What the OS is asking for right now. Defaults to light where `matchMedia`
 * is missing, matching the `:root` block the stylesheet paints by default. */
export function systemPalette(): Palette {
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches
    ? "dark"
    : "light"
}

/**
 * Put the palette on the document.
 *
 * Two things, not one. The class drives `index.css`; `color-scheme` drives what
 * the browser paints itself -- scrollbars, the caret, form controls, and the
 * canvas behind an over-scroll. Setting only the class leaves a dark page with
 * a white scrollbar and a white flash past the end of the scroll.
 */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement
  root.classList.toggle("dark", palette === "dark")
  root.style.colorScheme = palette
}
