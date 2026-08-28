import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"

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
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

/** 502/503/504 come from the dev proxy or a load balancer when nothing is
 * listening upstream. That is the same problem as a failed fetch — the server
 * is not there — and a different one from a request it actually rejected. */
const GATEWAY = new Set([502, 503, 504])

export function RunError({ error }: { error: unknown }) {
  const notPublished = error instanceof ApiError && error.status === 404
  const unreachable =
    !(error instanceof ApiError) || GATEWAY.has((error as ApiError).status)

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
        {error instanceof Error && (
          <p className="text-muted-foreground font-mono text-xs">{error.message}</p>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function AwaitingInput({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
      {children}
    </div>
  )
}
