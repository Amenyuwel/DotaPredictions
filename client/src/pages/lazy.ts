import { lazy } from "react"

/**
 * The admin pages, loaded only on their own paths.
 *
 * Almost nobody who opens this site is an administrator, and the editing
 * surface -- four tabs of forms over the scoring table -- is a large thing to
 * put in the bundle every visitor downloads to look at a ranking. Dynamic
 * imports keep both pages in their own chunks, fetched when `/admin` or
 * `/admin/login` is opened and never otherwise.
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

export const AdminLoginPage = lazy(async () => ({
  default: (await import("@/pages/admin-login")).AdminLoginPage,
}))
