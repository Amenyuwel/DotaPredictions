/**
 * The only module that knows how an admin request is authenticated.
 *
 * Same boundary rule as `lib/api.ts` keeps for the public endpoints, with one
 * addition: every request here carries the signed-in user's Supabase access
 * token, and the token is read from the live session at call time rather than
 * captured once. A token captured at mount is a token that expires while the
 * editor is open -- the library refreshes the session in the background, and a
 * copy taken an hour ago would start failing with no visible cause.
 *
 * Nothing here decides whether the caller is an admin. That question is
 * answered by the server on every single request; this module only makes sure
 * it has what it needs to answer.
 */
import { ApiError } from "@/lib/api"
import { getSupabase } from "@/lib/supabase"
import type {
  AdminConfig,
  ConfigOverlay,
  OverlayPreview,
  OverlayVersion,
} from "@/types/admin"

/** An admin failure carries the server's list of reasons, not just one line.
 * An overlay is rejected for every reason at once precisely so the editor can
 * show all of them -- fixing them one round trip at a time is how a five-minute
 * correction becomes an afternoon. */
export class AdminError extends ApiError {
  readonly reasons: string[]

  constructor(message: string, status: number, code: string | null, reason: string | null, reasons: string[]) {
    super(message, status, code, reason)
    this.name = "AdminError"
    this.reasons = reasons
  }
}

/**
 * The bearer for an admin request.
 *
 * One source: the signed-in Supabase session. There was a second -- a local
 * password door that minted its own token -- and it is gone, so there is one
 * kind of admin session and one place it comes from.
 *
 * Read at call time rather than captured once: the Supabase library refreshes
 * its session in the background, and a token copied at mount starts failing an
 * hour later with no visible cause.
 */
async function bearer(): Promise<string> {
  const supabase = await getSupabase()
  if (!supabase) {
    throw new AdminError(
      "No sign-in is configured in this deployment",
      503,
      "admin_unavailable",
      null,
      [],
    )
  }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new AdminError("Not signed in", 401, "unauthenticated", null, [])
  return token
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await bearer()

  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })

  if (!res.ok) {
    let code: string | null = null
    let reason: string | null = null
    let reasons: string[] = []
    try {
      const body = (await res.json()) as { error?: string; reason?: string; reasons?: string[] }
      code = body.error ?? null
      reason = body.reason ?? null
      reasons = body.reasons ?? []
    } catch {
      // no JSON body; the status is the whole message
    }
    throw new AdminError(`${init?.method ?? "GET"} ${path} -> ${res.status}`, res.status, code, reason, reasons)
  }

  // 204-shaped answers do not occur here, but an empty body from a proxy would
  // otherwise throw inside JSON.parse and read as a server error.
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

const scoped = (tournamentId: string, stage: string) =>
  `?${new URLSearchParams({ tournamentId, stage })}`

export function getAdminConfig(tournamentId?: string, stage?: string) {
  const q = new URLSearchParams()
  if (tournamentId) q.set("tournamentId", tournamentId)
  if (stage) q.set("stage", stage)
  const qs = q.toString()
  return request<AdminConfig>(`/api/admin/config${qs ? `?${qs}` : ""}`)
}

export function saveDraft(body: {
  tournamentId: string
  stage: string
  doc: ConfigOverlay
  note: string
}) {
  return request<{ savedAt: string; preview: OverlayPreview }>("/api/admin/config/draft", {
    method: "PUT",
    body: JSON.stringify(body),
  })
}

export function publishDraft(body: { tournamentId: string; stage: string; note: string }) {
  return request<{ version: number; publishedAt: string }>("/api/admin/config/publish", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function discardDraft(body: { tournamentId: string; stage: string }) {
  return request<{ discarded: boolean }>("/api/admin/config/discard", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export function getHistory(tournamentId: string, stage: string) {
  return request<{ versions: OverlayVersion[] }>(`/api/admin/config/history${scoped(tournamentId, stage)}`)
}

/** Load an earlier version into the DRAFT. Deliberately not "make it live
 * again": it lands in the editor, and going live from there mints a new version
 * with its own note and author, so the history stays a list of decisions in
 * order rather than a stack that can be rewound. */
export function revertTo(body: { tournamentId: string; stage: string; version: number }) {
  return request<{ loaded: number; preview: OverlayPreview }>("/api/admin/config/revert", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/**
 * The YAML to write back into `engine/config/<tournament>/scoring.yaml`.
 *
 * Text, not JSON, so it is pasted rather than parsed. This is how an overlay
 * retires: the correction belongs in the config the engine reads, or the next
 * crawl publishes a run without it and the overlay goes on silently patching.
 */
export async function exportYaml(tournamentId: string, stage: string): Promise<string> {
  const token = await bearer()

  const res = await fetch(`/api/admin/config/export${scoped(tournamentId, stage)}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new AdminError(`GET export -> ${res.status}`, res.status, null, null, [])
  }
  return res.text()
}
