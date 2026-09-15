import { lazy, StrictMode, Suspense } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Loading } from "@/components/ui/spinner"
import { TooltipProvider } from "@/components/ui/tooltip"

import App from "./App.tsx"
import "./index.css"

/**
 * The editor is loaded only on its own path.
 *
 * Almost nobody who opens this site is an administrator, and the editing
 * surface -- four tabs of forms over the scoring table -- is a large thing to
 * put in the bundle every visitor downloads to look at a ranking. A dynamic
 * import keeps it in its own chunk, fetched when `/admin` is opened and never
 * otherwise.
 *
 * This is a bundling decision and not a security one. The chunk is public, like
 * every other asset here; what protects the configuration is that the page
 * refuses to render without an admin session and the server refuses every
 * request behind it.
 */
const AdminPage = lazy(async () => ({ default: (await import("@/pages/admin")).AdminPage }))

/**
 * Runs are immutable, so a fetched answer cannot go stale on its own. Refetching
 * on window focus would spend requests to receive the same bytes.
 *
 * The configuration editor is the exception and sets `staleTime: 0` on its own
 * queries: what it edits is mutable by definition, and somebody else may be
 * editing it too.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: false },
  },
})

/**
 * Two pages, chosen by path, with no router.
 *
 * A router is a dependency, a bundle, and an API surface, and this application
 * has exactly two destinations that never share a layout, never nest and never
 * need a parameter. `location.pathname` answers the question completely.
 *
 * The server already sends `index.html` for every non-`/api` path (see
 * `serveClient` in server/src/app.ts), so `/admin` is a real URL that can be
 * opened, bookmarked and reloaded rather than a mode this page enters. Which
 * matters: the honest answer to "am I looking at the tool or at the thing that
 * can change what the tool says" should be visible in the address bar.
 *
 * Nothing here decides whether the visitor may see the editor. Anyone can load
 * this path; the page refuses to render, and the server refuses every request
 * behind it.
 */
const isAdminPath = window.location.pathname.replace(/\/+$/, "") === "/admin"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {isAdminPath ? (
          <Suspense
            fallback={
              <div className="mx-auto w-full max-w-5xl px-4 py-6">
                <Loading>Loading the configuration editor…</Loading>
              </div>
            }
          >
            <AdminPage />
          </Suspense>
        ) : (
          <App />
        )}
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
