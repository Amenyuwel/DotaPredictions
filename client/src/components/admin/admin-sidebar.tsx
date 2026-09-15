import { Download, Save, Send, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loading } from "@/components/ui/spinner"
import { SECTIONS } from "@/lib/admin-ui"
import { cn } from "@/lib/utils"
import type { AdminConfig, OverlayPreview } from "@/types/admin"

/**
 * The rail: where you are, what state the draft is in, and what you can do.
 *
 * All three used to be full-width rows stacked above the editor, which put the
 * work surface below the fold and gave a status line the same visual weight as
 * the form it described. A rail holds them beside the work instead, so the
 * section you are editing starts at the top of the page and the state of the
 * draft is readable without scrolling back up to it.
 *
 * `sticky` rather than fixed: the sections are long, and the Publish button
 * should be reachable from the bottom of the stats list without a journey. On
 * narrow screens the rail becomes an ordinary block above the content and the
 * actions sit under the nav, because a sticky column 320px wide is the whole
 * viewport.
 */


export function AdminSidebar({
  section,
  onSection,
  config,
  preview,
  dirty,
  saving,
  onSave,
  onPublish,
  onDiscard,
  onExport,
}: {
  section: string
  onSection: (next: string) => void
  config: AdminConfig
  preview: OverlayPreview | null
  dirty: boolean
  saving: boolean
  onSave: () => void
  onPublish: () => void
  onDiscard: () => void
  onExport: () => void
}) {
  const blocked = preview !== null && !preview.ok
  // Publishing publishes the SAVED draft, never what is on screen. Validation
  // runs on the server when a draft is saved, so an unsaved document is one
  // nothing has checked -- and "publish" must not be able to mean that.
  const canPublish = Boolean(config.draft) && !dirty && !blocked

  return (
    <div className="grid gap-4 md:sticky md:top-4">
      {/* Buttons, not a tablist. This was a vertical `Tabs` with the scoring
          panes' horizontal `Tabs` nested inside it, and Tailwind's `group/tabs`
          variants match ANY ancestor carrying that class -- so the inner strip
          inherited `group-data-vertical/tabs:flex-col` from this one and
          rendered stacked. Overriding that per-utility would have been a
          specificity fight with a shared component; not nesting two tablists
          removes the collision instead.

          It is also the more honest markup: this is navigation between the
          page's sections, which is what `nav` and `aria-current` say. */}
      <nav aria-label="Configuration sections">
        <ul className="grid gap-0.5">
          {SECTIONS.map((entry) => (
            <li key={entry.value}>
              <button
                type="button"
                aria-current={entry.value === section ? "page" : undefined}
                onClick={() => onSection(entry.value)}
                className={cn(
                  "focus-visible:ring-ring w-full rounded-md px-2.5 py-1.5 text-left text-sm focus-visible:ring-2 focus-visible:outline-none",
                  entry.value === section
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* A named region, so a screen reader hears what it is rather than
          "region". Live, because the draft state changes under the reader
          without them moving focus here -- and scoped to just this card, so a
          save announces the status rather than re-reading the whole rail. */}
      <section
        aria-label="Draft status"
        aria-live="polite"
        className="bg-card grid gap-3 rounded-lg border p-3"
      >
        <div className="grid gap-1">
          <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Live now
          </h2>
          {config.live ? (
            <>
              <p className="flex items-center gap-1.5 text-sm">
                <Badge>v{config.live.version}</Badge>
                <span>
                  {config.live.changeCount} override
                  {config.live.changeCount === 1 ? "" : "s"}
                </span>
              </p>
              <p className="text-muted-foreground text-xs">
                {config.live.authorEmail || "unknown"},{" "}
                {new Date(config.live.publishedAt).toLocaleDateString()}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              No overrides. The run is served exactly as the engine made it.
            </p>
          )}
        </div>

        <div className="grid gap-1">
          <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Draft
          </h2>
          {/* One line, three states, never absent -- so the card keeps one
              height and the buttons below it do not move as you type. */}
          <p className="text-sm">
            {dirty ? (
              <span className="text-destructive">Unsaved edits, not yet checked</span>
            ) : blocked ? (
              <span className="text-destructive">Saved, cannot be published</span>
            ) : config.draft ? (
              <span>Saved and ready to publish</span>
            ) : (
              <span className="text-muted-foreground">Nothing drafted</span>
            )}
          </p>
        </div>

        <div className="grid gap-1.5">
          <Button size="sm" onClick={onSave} disabled={!dirty || saving} className="justify-start">
            {saving ? <Loading>Saving…</Loading> : <Save aria-hidden />}
            Save draft
          </Button>
          <Button
            size="sm"
            variant={canPublish ? "default" : "outline"}
            onClick={onPublish}
            disabled={!canPublish}
            className="justify-start"
          >
            <Send aria-hidden />
            Publish…
          </Button>
        </div>

        <div className="grid gap-1.5 border-t pt-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={onExport}
            disabled={!preview?.ok}
            className="justify-start"
          >
            <Download aria-hidden />
            Export YAML
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDiscard}
            disabled={!config.draft}
            className="text-destructive justify-start"
          >
            <Trash2 aria-hidden />
            Discard draft
          </Button>
        </div>
      </section>

      {/* Settled explanation, folded. It answers a question asked once, on a
          first visit, and it was previously a permanent banner above the work.
          A warning would never fold away -- this is not one. */}
      <details className="bg-card rounded-lg border px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium">
          What this page can and cannot change
        </summary>
        <div className="text-muted-foreground mt-2 grid gap-2">
          <p>
            The scoring table is read on every request, so editing it takes effect without
            a re-crawl. The emblem catalog is not edited directly — it is the cross product
            of stats, tiers and traits, regenerated whenever any of those move.
          </p>
          <p>
            Measurements are not editable at all. Per-game stat lines and simulated
            schedules come from the crawler, so a player added here has no data until the
            next <code>python -m scripts.publish</code>.
          </p>
        </div>
      </details>
    </div>
  )
}
