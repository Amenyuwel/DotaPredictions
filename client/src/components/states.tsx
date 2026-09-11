import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Loading } from "@/components/ui/spinner"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * What the app shows when it has no answer.
 *
 * Deliberately not a blank screen and never a placeholder number: an unmeasured
 * value is not a zero, and a fabricated one would be indistinguishable from a
 * real result. Each state says what is missing and what would fix it.
 */

export function LoadingRun() {
  return (
    <div className="space-y-3" aria-busy>
      <Loading>Loading the published run…</Loading>
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

/** 502/503/504 come from the dev proxy or a load balancer when nothing is
 * listening upstream. That is the same problem as a failed fetch -- the server
 * is not there -- and a different one from a request it actually rejected. */
const GATEWAY = new Set([502, 503, 504])

/** The two 404s that mean "publish something".
 *
 * Matched on the server's own code rather than on the status, because other
 * 404s exist and their fix is the opposite: asking for a team that is not in
 * this stage is a 404, and telling someone to run `publish.py` over it would
 * send them to fix a file that is already correct. A 404 with no code at all
 * predates the codes and is read the old way. */
const NOT_PUBLISHED = new Set(["no_current_run", "no_such_run"])

export function RunError({ error }: { error: unknown }) {
  const api = error instanceof ApiError ? error : null
  const notPublished =
    api?.status === 404 && (api.code === null || NOT_PUBLISHED.has(api.code))
  const unreachable = api === null || GATEWAY.has(api.status)

  return (
    <Alert variant={notPublished ? "default" : "destructive"}>
      <AlertTitle>
        {notPublished
          ? "No run published yet"
          : unreachable
            ? "Cannot reach the compute server"
            : "The server rejected the request"}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        {notPublished && (
          <p>
            The engine has not published a snapshot for this tournament and stage. Run{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-xs">
              python -m scripts.publish
            </code>{" "}
            from <code className="bg-muted rounded px-1 py-0.5 text-xs">engine/</code>, then
            reload.
          </p>
        )}
        {unreachable && (
          <p>
            Start it with <code className="bg-muted rounded px-1 py-0.5 text-xs">npm run dev</code>{" "}
            in <code className="bg-muted rounded px-1 py-0.5 text-xs">server/</code>. Nothing is
            shown until it answers, because a guessed number is worse than none.
          </p>
        )}
        {/* The server's sentence, not one written here. It is the side that
            knows which of its own rules the request broke. */}
        {!notPublished && api?.reason && <p>{api.reason}</p>}
        {error instanceof Error && (
          <p className="text-muted-foreground font-mono text-xs">{error.message}</p>
        )}
      </AlertDescription>
    </Alert>
  )
}

/**
 * A box where an answer will go, saying what is still missing.
 *
 * Two sizes, and which one to use is a question about how many are on screen
 * rather than about what the box says. One of these standing alone is the whole
 * answer column and can afford the room; three stacked, one per roster slot,
 * are a frame drawn three times around one short line, and at that point the
 * frame is louder than the three headings telling them apart. `compact` is the
 * three-up size, so the set stays one size decided by the group.
 */
export function AwaitingInput({
  compact,
  children,
}: {
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground rounded-lg border border-dashed text-center",
        compact ? "px-4 py-4 text-xs" : "p-6 text-sm",
      )}
    >
      {children}
    </div>
  )
}
