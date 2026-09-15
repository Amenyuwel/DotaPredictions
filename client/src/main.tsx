import { StrictMode, Suspense } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Skeleton, SkeletonPanel } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"

import { AccountPage, AdminPage } from "@/pages/lazy"

import App from "./App.tsx"
import "./index.css"

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
 * Three pages, chosen by path, with no router.
 *
 * A router is a dependency, a bundle, and an API surface, and this application
 * has three destinations that never share a layout, never nest and never need a
 * parameter. `location.pathname` answers the question completely.
 *
 * The server already sends `index.html` for every non-`/api` path (see
 * `serveClient` in server/src/app.ts), so `/admin` is a real URL that can be
 * opened, bookmarked and reloaded rather than a mode this page enters. Which
 * matters: the honest answer to "am I looking at the tool or at the thing that
 * can change what the tool says" should be visible in the address bar.
 *
 * Nothing here decides whether the visitor may see the editor. Anyone can load
 * the path; the editor refuses to render without an admin session, and the
 * server refuses every request behind it.
 */
const path = window.location.pathname.replace(/\/+$/, "")
const isAdminPath = path === "/admin"
const isAccountPath = path === "/account"
const isLazyPath = isAdminPath || isAccountPath

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {isLazyPath ? (
          <Suspense
            fallback={
              // Held open until the chunk arrives. Generic on purpose: this
              // fallback is showing while the code that knows the real shape is
              // still being fetched, so it reserves a page rather than a layout
              // it cannot yet be sure of.
              <div className="mx-auto w-full max-w-5xl px-4 py-6">
                <SkeletonPanel
                  label={isAccountPath ? "Loading your account…" : "Loading the configuration editor…"}
                  className="space-y-3"
                >
                  <Skeleton className="h-9 w-56" />
                  <Skeleton className="h-40 w-full rounded-xl" />
                  <Skeleton className="h-40 w-full rounded-xl" />
                </SkeletonPanel>
              </div>
            }
          >
            {isAccountPath ? <AccountPage /> : <AdminPage />}
          </Suspense>
        ) : (
          <App />
        )}
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
