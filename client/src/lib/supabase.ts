/**
 * The only module that knows Supabase exists.
 *
 * Same boundary rule as `lib/api.ts` keeps for the Express server, and the same
 * rule `dota/sources/` keeps for OpenDota: everything above works in this file's
 * types, so a change of auth provider or table name stops here.
 *
 * Two things live behind it, and they are unrelated on purpose:
 *
 *   auth           who is signed in, via Google or GitHub
 *   saved_banners  that person's own banner setups, gated by row-level security
 *
 * Scoring is NOT here. Ranked answers come from the Express server, which reads
 * an immutable published run; nothing the browser can send changes a projection.
 */
// Type-only: the library itself is loaded on demand, see `getSupabase`.
import type { Session, SupabaseClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL ?? ""
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ""

/**
 * Auth is optional, and the app has to work without it.
 *
 * With no credentials configured every visitor is a guest, the tool still ranks
 * banners, and the sign-in button says why it is unavailable. Degrading into a
 * smaller feature set is this project's habit everywhere else -- a missing
 * STRATZ token costs a faster fetch, not the run -- and it holds here too.
 */
export const authConfigured = Boolean(url && publishableKey)

/**
 * The client, loaded the first time something needs it.
 *
 * The library is ~130 kB gzipped -- more than half of the JavaScript a first
 * visit used to download -- and a guest, who is most visitors, never uses it.
 * Imported eagerly it sat in front of the first paint for everyone; behind a
 * dynamic import it costs nothing until someone signs in, has a stored session
 * (`mayHaveSession`), or opens a page that needs one. One promise, shared, so
 * every caller gets the same client and the module loads once.
 */
let client: Promise<SupabaseClient | null> | null = null

export function getSupabase(): Promise<SupabaseClient | null> {
  if (!authConfigured) return Promise.resolve(null)
  client ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(url, publishableKey, {
      auth: {
        // PKCE, and the library exchanges the code itself when the provider
        // redirects back. There is no server-side callback route to run one:
        // this is a Vite SPA, not a framework with request handlers.
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    }),
  )
  return client
}

/**
 * Whether this page load could be a signed-in one, read without the library.
 *
 * Two cases need the client at startup: a session the library persisted
 * (`sb-<ref>-auth-token`, plus its PKCE verifier mid-sign-in) and the OAuth
 * redirect landing back with `?code=`, which the library must exchange. Neither
 * present means a guest, and the guest's first paint does not wait on auth.
 * Storage that throws is treated as "maybe": loading the client is the safe
 * side of being wrong.
 */
export function mayHaveSession(): boolean {
  if (!authConfigured) return false
  try {
    if (new URLSearchParams(window.location.search).has("code")) return true
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith("sb-") && key.includes("-auth-token")) return true
    }
    return false
  } catch {
    return true
  }
}

export type { Session }

export type OAuthProvider = "google" | "github"

export async function signIn(provider: OAuthProvider): Promise<void> {
  const supabase = await getSupabase()
  if (!supabase) throw new Error("Supabase is not configured")
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    // Back to wherever the user actually was. The origin must also be on the
    // dashboard's redirect allow list, or the provider refuses the round trip.
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase()
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/**
 * One saved banner.
 *
 * `emblemIds` is ordered, and the order is part of the answer rather than
 * presentation: Vampiric charges each neighbour and Benevolent pays each
 * neighbour, so the same five emblems in a different order score differently.
 * Stored as array position for that reason -- a separate order column could
 * drift from the array it describes.
 */
export interface SavedBanner {
  id: string
  tournamentId: string
  stage: string
  role: "core" | "mid" | "support"
  emblemIds: string[]
  label: string
  createdAt: string
}

interface SavedBannerRow {
  id: string
  tournament_id: string
  stage: string
  role: SavedBanner["role"]
  emblem_ids: string[]
  label: string
  created_at: string
}

const fromRow = (row: SavedBannerRow): SavedBanner => ({
  id: row.id,
  tournamentId: row.tournament_id,
  stage: row.stage,
  role: row.role,
  emblemIds: row.emblem_ids,
  label: row.label,
  createdAt: row.created_at,
})

/**
 * A guest has no rows, and asking for them is not an error.
 *
 * Row-level security answers an unauthenticated request with an empty set
 * rather than a rejection, so the guest path needs no special case beyond not
 * offering to save. That is deliberate: "continue as guest" means the rows do
 * not exist, not that they are hidden.
 */
const BANNER_COLUMNS = "id, tournament_id, stage, role, emblem_ids, label, created_at"

/**
 * Two screens ask different questions of one table, so the scope is a
 * parameter rather than a second query.
 *
 * The sidebar asks "what did I save for the run on screen" and MUST be scoped:
 * a Group Stage banner offered inside a Main Event would load three emblems
 * into five slots and score as if it belonged there. The account page asks
 * "what have I saved at all", which a scoped list cannot answer however many
 * times it is called. One builder for both, because the column list and the
 * ordering are the parts that would drift.
 */
async function queryBanners(scope?: { tournamentId: string; stage: string }) {
  const supabase = await getSupabase()
  if (!supabase) return []
  const base = supabase.from("saved_banners").select(BANNER_COLUMNS)
  const scoped = scope
    ? base.eq("tournament_id", scope.tournamentId).eq("stage", scope.stage)
    : base
  const { data, error } = await scoped.order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data as SavedBannerRow[]).map(fromRow)
}

export const listSavedBanners = (tournamentId: string, stage: string) =>
  queryBanners({ tournamentId, stage })

/** Every saved banner this user has, whichever run it belongs to. */
export const listAllSavedBanners = () => queryBanners()

export async function saveBanner(input: {
  tournamentId: string
  stage: string
  role: SavedBanner["role"]
  emblemIds: string[]
  label: string
}): Promise<SavedBanner> {
  const supabase = await getSupabase()
  if (!supabase) throw new Error("Supabase is not configured")
  // user_id is not sent. It defaults from the JWT in Postgres and the insert
  // policy checks it again, so a forged owner cannot even be expressed here.
  const { data, error } = await supabase
    .from("saved_banners")
    .insert({
      tournament_id: input.tournamentId,
      stage: input.stage,
      role: input.role,
      emblem_ids: input.emblemIds,
      label: input.label,
    })
    .select("id, tournament_id, stage, role, emblem_ids, label, created_at")
    .single()
  if (error) throw new Error(error.message)
  return fromRow(data as SavedBannerRow)
}

export async function deleteBanner(id: string): Promise<void> {
  const supabase = await getSupabase()
  if (!supabase) throw new Error("Supabase is not configured")
  const { error } = await supabase.from("saved_banners").delete().eq("id", id)
  if (error) throw new Error(error.message)
}

/**
 * One saved roster: the three units a reader picked, together.
 *
 * A whole roster per row rather than three rows with a role each. The three are
 * chosen together, the tab adds their targets into one total, and half a roster
 * restored later would read as a finished one with a slot gone missing.
 *
 * Player ids, not team ids. A roster follows people: a stand-in or a transfer
 * should come back as the player who was picked rather than as whoever wears
 * that jersey now. The ids are resolved against the run on screen when loading,
 * so one this run does not carry comes back as an empty slot, never a wrong one.
 */
export interface SavedRoster {
  id: string
  tournamentId: string
  stage: string
  players: { core: number; mid: number; support: number }
  label: string
  createdAt: string
}

interface SavedRosterRow {
  id: string
  tournament_id: string
  stage: string
  core_player_id: number
  mid_player_id: number
  support_player_id: number
  label: string
  created_at: string
}

const ROSTER_COLUMNS =
  "id, tournament_id, stage, core_player_id, mid_player_id, support_player_id, label, created_at"

const rosterFromRow = (row: SavedRosterRow): SavedRoster => ({
  id: row.id,
  tournamentId: row.tournament_id,
  stage: row.stage,
  players: {
    core: row.core_player_id,
    mid: row.mid_player_id,
    support: row.support_player_id,
  },
  label: row.label,
  createdAt: row.created_at,
})

/** Scoped or not, for the same reason banners are -- see `queryBanners`. */
async function queryRosters(scope?: { tournamentId: string; stage: string }) {
  const supabase = await getSupabase()
  if (!supabase) return []
  const base = supabase.from("saved_rosters").select(ROSTER_COLUMNS)
  const scoped = scope
    ? base.eq("tournament_id", scope.tournamentId).eq("stage", scope.stage)
    : base
  const { data, error } = await scoped.order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data as SavedRosterRow[]).map(rosterFromRow)
}

export const listSavedRosters = (tournamentId: string, stage: string) =>
  queryRosters({ tournamentId, stage })

/** Every saved roster this user has, whichever run it belongs to. */
export const listAllSavedRosters = () => queryRosters()

export async function saveRoster(input: {
  tournamentId: string
  stage: string
  players: { core: number; mid: number; support: number }
  label: string
}): Promise<SavedRoster> {
  const supabase = await getSupabase()
  if (!supabase) throw new Error("Supabase is not configured")
  // user_id is not sent, for the same reason as a banner: it defaults from the
  // JWT in Postgres and the insert policy checks it again.
  const { data, error } = await supabase
    .from("saved_rosters")
    .insert({
      tournament_id: input.tournamentId,
      stage: input.stage,
      core_player_id: input.players.core,
      mid_player_id: input.players.mid,
      support_player_id: input.players.support,
      label: input.label,
    })
    .select(ROSTER_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return rosterFromRow(data as SavedRosterRow)
}

export async function deleteRoster(id: string): Promise<void> {
  const supabase = await getSupabase()
  if (!supabase) throw new Error("Supabase is not configured")
  const { error } = await supabase.from("saved_rosters").delete().eq("id", id)
  if (error) throw new Error(error.message)
}
