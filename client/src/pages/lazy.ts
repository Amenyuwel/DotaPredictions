import { lazy } from "react"

/**
 * The admin page, loaded only on its own path.
 *
 * Almost nobody who opens this site is an administrator, and the editing
 * surface -- four tabs of forms over the scoring table -- is a large thing to
 * put in the bundle every visitor downloads to look at a ranking. A dynamic
 * import keeps it in its own chunk, fetched when `/admin` is opened and never
 * otherwise.
 *
 * This is a bundling decision and not a security one. The chunks are public,
 * like every other asset here; what protects the configuration is that the
 * editor refuses to render without an admin session and the server refuses
 * every request behind it.
 *
 * In their own module rather than beside the router: `main.tsx` exports
 * nothing, and a file that mixes component definitions with a side-effecting
 * `createRoot` call is one React Fast Refresh cannot reason about.
 */
export const AdminPage = lazy(async () => ({
  default: (await import("@/pages/admin")).AdminPage,
}))

/** Split for the same reason, if less dramatically: most visits never open an
 * account page, and several of them are guests who have no account to open. */
export const AccountPage = lazy(async () => ({
  default: (await import("@/pages/account")).AccountPage,
}))
