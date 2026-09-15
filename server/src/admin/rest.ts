import { config } from "../config.js"

/**
 * PostgREST, over `fetch`, with the secret key.
 *
 * `run-store.ts` already talks to Supabase this way and says why there is no
 * Postgres driver here: that file asks one question once at boot. This one asks
 * a handful more -- read the draft, write the draft, publish, list history --
 * which is still far short of what a client library earns, and the two of them
 * having one shared helper is cheaper than either having a dependency.
 *
 * Everything here runs with the secret key, which carries BYPASSRLS. That is
 * the whole security model of `config_overlays`: RLS on, no policy, one reader.
 * So nothing in this file may ever be reachable without `requireAdmin` in front
 * of it, and the only caller is `routes/admin.ts`, where every route has it.
 */

/**
 * Both header shapes, because the project spans a key migration.
 *
 * Identical to `run-store.ts`'s, and deliberately duplicated rather than
 * imported: that module is the boot-time reader and this one is the admin
 * writer, and a shared mutable helper between them would be a shared failure.
 * Six lines, no branching, and the rule is written down in both places.
 */
function authHeaders(): Record<string, string> {
  const key = config.supabaseSecretKey
  const headers: Record<string, string> = { apikey: key }
  if (key.startsWith("ey")) headers.Authorization = `Bearer ${key}`
  return headers
}

export class RestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "RestError"
    this.status = status
  }
}

/** A GET against one table. `query` is the PostgREST filter set, spelled out by
 * the caller so the filters live beside the reason for them. */
export async function postgrest<T>(
  table: string,
  query: Record<string, string>,
): Promise<T> {
  const url = `${config.supabaseUrl}/rest/v1/${table}?${new URLSearchParams(query)}`
  const res = await fetch(url, {
    headers: { ...authHeaders(), Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new RestError(res.status, `GET ${table} -> ${res.status} ${(await res.text()).slice(0, 300)}`)
  }
  return (await res.json()) as T
}

/**
 * An insert, returning the row.
 *
 * Not an upsert. PostgREST infers `ON CONFLICT` from the columns named in
 * `on_conflict`, and the only unique index on `config_overlays` is PARTIAL --
 * `(tournament_id, stage) where status = 'draft'` -- which is what allows one
 * draft per stage alongside many published versions. Postgres can use a partial
 * index for conflict inference only when the predicate is supplied too, and
 * PostgREST has no way to send one, so every upsert against that table comes
 * back `42P10: there is no unique or exclusion constraint matching the ON
 * CONFLICT specification`.
 *
 * So the branch happens in the caller, which had already read the row it was
 * about to write. See `writeDraft` in routes/admin.ts.
 */
export async function insertReturning<T>(
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new RestError(
      res.status,
      `POST ${table} -> ${res.status} ${(await res.text()).slice(0, 300)}`,
    )
  }
  const rows = (await res.json()) as T[]
  return rows[0] as T
}

/** A PATCH against the rows `query` selects, returning the first. */
export async function patch<T>(
  table: string,
  query: Record<string, string>,
  row: Record<string, unknown>,
): Promise<T> {
  const url = `${config.supabaseUrl}/rest/v1/${table}?${new URLSearchParams(query)}`
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new RestError(
      res.status,
      `PATCH ${table} -> ${res.status} ${(await res.text()).slice(0, 300)}`,
    )
  }
  const rows = (await res.json()) as T[]
  return rows[0] as T
}

/** A unique violation, which is how the database reports the race `writeDraft`
 * retries around. Worth naming: every other 409 here would be a real error. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof RestError && err.message.includes('"code":"23505"')
}

/** A plain insert with no conflict handling. Used for the audit log, which has
 * no unique key by design: every write is a new row, including two identical
 * ones a minute apart. */
export async function insert(table: string, row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new RestError(
      res.status,
      `POST ${table} -> ${res.status} ${(await res.text()).slice(0, 300)}`,
    )
  }
}

export async function del(table: string, query: Record<string, string>): Promise<void> {
  const url = `${config.supabaseUrl}/rest/v1/${table}?${new URLSearchParams(query)}`
  const res = await fetch(url, {
    method: "DELETE",
    headers: { ...authHeaders(), Prefer: "return=minimal" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new RestError(
      res.status,
      `DELETE ${table} -> ${res.status} ${(await res.text()).slice(0, 300)}`,
    )
  }
}

/** Call a Postgres function. Used for `publish_config_overlay`, which assigns a
 * version number under a lock -- the one operation here that two admins can race
 * and that must not be a read followed by a write from this process. */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    throw new RestError(
      res.status,
      `POST rpc/${fn} -> ${res.status} ${(await res.text()).slice(0, 300)}`,
    )
  }
  return (await res.json()) as T
}
