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

/** "40 to 112 games" reads better than a bare count in a header. */
export const matchCount = (n: number) => `${INTEGER.format(n)} matches`
