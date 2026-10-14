/**
 * Presentation only. This is the one place a number becomes a string.
 *
 * The API and the database carry doubles end to end; rounding anywhere below
 * the UI would make two callers disagree about the same value. Keeping every
 * formatter here is what makes that rule checkable.
 */

const INTEGER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const PERCENT = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
})
const DATE = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export const points = (n: number) => INTEGER.format(n)
export const percent = (p: number) => PERCENT.format(p)
export const timestamp = (iso: string) => DATE.format(new Date(iso))
export const day = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso))

/**
 * A projection's 90% interval, as printed under its figure.
 *
 * One formatter for every card and row: the interval was written out by hand
 * in three components as "lo - hi at 90%", a hyphen that reads as a minus sign
 * and a phrase a stranger has to decode. The en dash is the range; "90% range"
 * names what it is, and the FAQ and the orientation panel say how it is made.
 */
export const interval = (ci: { lo: number; hi: number }) => `${range(ci)} · 90% range`

/**
 * The same interval without its label, for the rows under a figure that already
 * carries one. Eight rows each saying "90% range" was the same two words eight
 * times; the lead says it, the list below inherits it.
 */
export const range = (ci: { lo: number; hi: number }) =>
  `${points(ci.lo)}–${points(ci.hi)}`

/** "40 to 112 games" reads better than a bare count in a header. */
export const matchCount = (n: number) => `${INTEGER.format(n)} matches`
