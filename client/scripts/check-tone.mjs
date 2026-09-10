/**
 * The emblem palette must stay one recipe at three hues.
 *
 *   node scripts/check-tone.mjs
 *
 * Four ways it can quietly stop being uniform, and this checks all four:
 *
 *   1. A role gets a per-hue override, so red and green are no longer the same
 *      colour at different angles. Hue, sat and the weave are the only things
 *      allowed to differ.
 *   2. A colour declares a hue but no pattern, or a pattern but no hue. Half a
 *      per-colour axis is the state where two colours are told apart on one
 *      screen and not on another.
 *   3. A chroma is raised past what sRGB can reach at some hue. The wide hues
 *      honour it and the narrow one is clipped, which is how equal numbers in
 *      the stylesheet become unequal weights on screen. Which hue binds moves
 *      with lightness -- blue near white, green further down -- so it is
 *      checked per role rather than argued about once.
 *   4. A text role drops below WCAG AA 4.5:1 against the card behind it.
 *
 * Nobody can see clipping by reading the CSS, which is why this is a script and
 * not a code review note.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const CSS = fileURLToPath(new URL("../src/index.css", import.meta.url))

/** OKLCH -> linear-light sRGB. Luminance uses these directly; gamma encoding is
 * only needed to write a hex value, never to measure contrast. */
function toLinear(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-3 && v <= 1.001)
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
function contrast(rgbA, rgbB) {
  const [hi, lo] = [luminance(rgbA), luminance(rgbB)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const css = readFileSync(CSS, "utf8")
const problems = []

// Every per-colour block, and what it declares. The hues are read out of the
// stylesheet rather than restated here: a second copy of the hue table is
// exactly the silent drift this script exists to catch, and it would sit here
// checking angles that nothing on screen renders at.
const perColour = [...css.matchAll(/\[data-emblem="([a-z]+)"\]\s*\{([^}]*)\}/g)].map(
  ([, colour, body]) => ({
    colour,
    declared: [...body.matchAll(/--([a-z-]+)\s*:/g)].map((m) => m[1]),
    hue: body.match(/--emblem-hue:\s*([\d.]+)/)?.[1],
  }),
)

const HUES = Object.fromEntries(
  perColour.filter((c) => c.hue !== undefined).map((c) => [c.colour, Number(c.hue)]),
)

if (Object.keys(HUES).length === 0) {
  problems.push("no [data-emblem] hues found; has the palette been renamed or removed?")
}

// Every role in the recipe: --emblem-x: oklch(L calc(C * var(--emblem-sat)) var(--emblem-hue) ...)
const ROLE = /--emblem-([a-z-]+):\s*oklch\(([\d.]+)\s+calc\(([\d.]+)\s*\*\s*var\(--emblem-sat\)\)\s*var\(--emblem-hue\)/g
/** The roles declared in one block, tagged with the theme that block paints.
 *
 * The theme is read from the selector, never inferred from the role's own
 * lightness. A light-theme ink that drifted up past some threshold would be
 * graded against the dark card and pass -- the exact shape of bug this file
 * exists to stop, a wrong number that does not raise. */
const rolesIn = (selector, theme) => {
  const at = css.search(selector)
  if (at === -1) return []
  const body = css.slice(at, css.indexOf("}", at))
  return [...body.matchAll(ROLE)].map((m) => ({
    name: m[1],
    L: Number(m[2]),
    C: Number(m[3]),
    theme,
  }))
}

const roles = [
  ...rolesIn(/(?<!\.dark )\[data-emblem\] \{/, "light"),
  ...rolesIn(/\.dark \[data-emblem\] \{/, "dark"),
]

if (roles.length === 0) {
  problems.push("no --emblem-* roles found; has the recipe been renamed or removed?")
}

// (1) Hue, sat and the weave are the only per-colour overrides. The weave is on
// this list because the client draws each colour a different pattern and
// copying that is the point; a lightness or a chroma never can be.
const ALLOWED = new Set(["emblem-hue", "emblem-sat", "emblem-pattern", "emblem-pattern-size"])
for (const { colour, declared } of perColour) {
  const extra = declared.filter((d) => !ALLOWED.has(d))
  if (extra.length) {
    problems.push(
      `[data-emblem="${colour}"] overrides ${extra.join(", ")}. Only the hue (and sat, ` +
        `to drain colour, and the pattern) may differ per colour, or the three stop ` +
        `being one recipe.`,
    )
  }
}

// (2) A colour has both a hue and a pattern, or neither.
for (const { colour, declared, hue } of perColour) {
  const hasPattern = declared.includes("emblem-pattern")
  if (hue !== undefined && !hasPattern) {
    problems.push(
      `[data-emblem="${colour}"] declares a hue but no --emblem-pattern, so it is the ` +
        `one colour told apart by hue alone.`,
    )
  }
  if (hasPattern && hue === undefined) {
    problems.push(
      `[data-emblem="${colour}"] declares a pattern but no --emblem-hue, so it weaves ` +
        `in whatever hue it inherits.`,
    )
  }
}

// (3) No role may ask for more chroma than the tightest hue can render.
for (const { name, L, C } of roles) {
  for (const [colour, hue] of Object.entries(HUES)) {
    if (!inGamut(toLinear(L, C, hue))) {
      problems.push(
        `--emblem-${name} at L=${L} C=${C} is outside sRGB for ${colour}. It will be ` +
          `clipped there and rendered at full strength elsewhere, so the colours will ` +
          `carry different weights. Lower C until every hue fits.`,
      )
    }
  }
}

// (4) Text roles must clear AA against the card their own theme paints.
const SURFACE = { light: [1, 1, 1], dark: toLinear(0.205, 0, 0) }
const TEXT_ROLES = new Set(["ink"])
let checked = 0
for (const { name, L, C, theme } of roles) {
  if (!TEXT_ROLES.has(name)) continue
  for (const [colour, hue] of Object.entries(HUES)) {
    const ratio = contrast(toLinear(L, C, hue), SURFACE[theme])
    checked += 1
    if (ratio < 4.5) {
      problems.push(
        `--emblem-${name} in ${colour} is ${ratio.toFixed(2)}:1 against the ${theme} ` +
          `card, below WCAG AA 4.5:1.`,
      )
    }
  }
}

if (problems.length) {
  console.error("emblem palette is not uniform:\n")
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(
  `emblem palette ok: ${roles.length} roles x ${Object.keys(HUES).length} hues in gamut, ` +
    `${checked} text/card pairs at or above AA.`,
)
