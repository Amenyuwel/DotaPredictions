/**
 * The emblem palette must stay one recipe at three hues.
 *
 *   node scripts/check-tone.mjs
 *
 * Three ways it can quietly stop being uniform, and this checks all three:
 *
 *   1. A role gets a per-hue override, so red and green are no longer the same
 *      colour at different angles.
 *   2. A chroma is raised past what sRGB can reach at some hue. The wide hues
 *      honour it and the narrow one is clipped, which is how equal numbers in
 *      the stylesheet become unequal weights on screen -- green tops out at
 *      C=0.136 at L=0.62 where red reaches 0.251.
 *   3. A text role drops below WCAG AA 4.5:1 against the surface behind it.
 *
 * Nobody can see clipping by reading the CSS, which is why this is a script and
 * not a code review note.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const CSS = fileURLToPath(new URL("../src/index.css", import.meta.url))
const HUES = { red: 25, blue: 260, green: 162 }

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

// Every role in the recipe: --emblem-x: oklch(L calc(C * var(--emblem-sat)) var(--emblem-hue) ...)
const ROLE = /--emblem-([a-z-]+):\s*oklch\(([\d.]+)\s+calc\(([\d.]+)\s*\*\s*var\(--emblem-sat\)\)\s*var\(--emblem-hue\)/g
const roles = [...css.matchAll(ROLE)].map((m) => ({
  name: m[1],
  L: Number(m[2]),
  C: Number(m[3]),
}))

if (roles.length === 0) {
  problems.push("no --emblem-* roles found; has the recipe been renamed or removed?")
}

// (1) Hue must be the only per-colour override.
const perColour = [...css.matchAll(/\[data-emblem="([a-z]+)"\]\s*\{([^}]*)\}/g)]
for (const [, colour, body] of perColour) {
  const declared = [...body.matchAll(/--([a-z-]+)\s*:/g)].map((m) => m[1])
  const allowed = new Set(["emblem-hue", "emblem-sat"])
  const extra = declared.filter((d) => !allowed.has(d))
  if (extra.length) {
    problems.push(
      `[data-emblem="${colour}"] overrides ${extra.join(", ")}. Only the hue (and sat, ` +
        `to drain colour) may differ per colour, or the three stop being one recipe.`,
    )
  }
}

// (2) No role may ask for more chroma than the tightest hue can render.
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

// (3) Text roles must clear AA against the surface behind them.
const WHITE = [1, 1, 1]
const DARK_CARD = toLinear(0.205, 0, 0)
const TEXT_ROLES = new Set(["ink", "ink-on"])
let checked = 0
for (const { name, L, C } of roles) {
  if (!TEXT_ROLES.has(name)) continue
  const surface = L > 0.6 ? DARK_CARD : WHITE // light text sits on the dark card
  for (const [colour, hue] of Object.entries(HUES)) {
    const ratio = contrast(toLinear(L, C, hue), surface)
    checked += 1
    if (ratio < 4.5) {
      problems.push(
        `--emblem-${name} in ${colour} is ${ratio.toFixed(2)}:1 against its surface, ` +
          `below WCAG AA 4.5:1.`,
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
    `${checked} text/background pairs at or above AA.`,
)
