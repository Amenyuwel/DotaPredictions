import type { AvailableRun, Stage } from "@/types/run"

/**
 * The stage the reader last picked, remembered on this device.
 *
 * The tournament is stored with the stage, not the stage alone: "main" by itself
 * would reopen the newest Main Event of ANY tournament, which the day the next
 * International publishes its Group Stage is last year's bracket -- a stale
 * answer that looks current. The pair is only honoured while its tournament is
 * still the newest one the server holds; see `isStale`.
 *
 * Device-local, like the theme, and the same for guests and accounts.
 */
const STAGE_STORAGE_KEY = "dotapredictions:stage"

export type StageChoice = { tournamentId: string; stage: Stage }

const isStage = (v: unknown): v is Stage => v === "group" || v === "main"

/** The stored choice, or null on a first visit, a malformed value, or a
 * browser that refuses storage. Every caller treats null as "use the default". */
export function readStageChoice(): StageChoice | null {
  try {
    const raw = localStorage.getItem(STAGE_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "tournamentId" in parsed &&
      typeof parsed.tournamentId === "string" &&
      "stage" in parsed &&
      isStage(parsed.stage)
    ) {
      return { tournamentId: parsed.tournamentId, stage: parsed.stage }
    }
    return null
  } catch {
    // Degrade, never fail the run.
    return null
  }
}

/** Remember a choice. A no-op where storage is unavailable. */
export function storeStageChoice(choice: StageChoice): void {
  try {
    localStorage.setItem(STAGE_STORAGE_KEY, JSON.stringify(choice))
  } catch {
    // Degrade, never fail the run.
  }
}

export function clearStageChoice(): void {
  try {
    localStorage.removeItem(STAGE_STORAGE_KEY)
  } catch {
    // Degrade, never fail the run.
  }
}

/**
 * Whether a remembered choice belongs to an event that has since been
 * superseded: some other tournament has a run published after every run of the
 * remembered one. Undefined `available` (nothing loaded yet) is not stale.
 */
export function isStale(choice: StageChoice, available: AvailableRun[] | undefined): boolean {
  if (!available || available.length === 0) return false
  const newest = available.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
  return newest.tournamentId !== choice.tournamentId
}
