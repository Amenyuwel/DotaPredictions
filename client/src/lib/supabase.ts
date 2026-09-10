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
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js"

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

export const supabase: SupabaseClient | null = authConfigured
  ? createClient(url, publishableKey, {
      auth: {
        // PKCE, and the library exchanges the code itself when the provider
        // redirects back. There is no server-side callback route to run one:
        // this is a Vite SPA, not a framework with request handlers.
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null

export type { Session }

export type OAuthProvider = "google" | "github"

export async function signIn(provider: OAuthProvider): Promise<void> {
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
export async function listSavedBanners(tournamentId: string, stage: string) {
  if (!supabase) return []
  const { data, error } = await supabase
    .from("saved_banners")
    .select("id, tournament_id, stage, role, emblem_ids, label, created_at")
    .eq("tournament_id", tournamentId)
    .eq("stage", stage)
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data as SavedBannerRow[]).map(fromRow)
}

export async function saveBanner(input: {
  tournamentId: string
  stage: string
  role: SavedBanner["role"]
  emblemIds: string[]
  label: string
}): Promise<SavedBanner> {
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
  if (!supabase) throw new Error("Supabase is not configured")
  const { error } = await supabase.from("saved_banners").delete().eq("id", id)
  if (error) throw new Error(error.message)
}
