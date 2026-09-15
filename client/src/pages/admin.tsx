import { useState, type ReactNode } from "react"
import { ArrowLeft, LogOut, ShieldAlert } from "lucide-react"

import { AdminSidebar } from "@/components/admin/admin-sidebar"
import { HistoryPanel } from "@/components/admin/history-panel"
import { PublishDialog } from "@/components/admin/publish-dialog"
import { RosterEditor } from "@/components/admin/roster-editor"
import { ScoringEditor } from "@/components/admin/scoring-editor"
import { StageSwitcher } from "@/components/stage-switcher"
import { ThemeMenu } from "@/components/theme-menu"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loading } from "@/components/ui/spinner"
import { useAdmin } from "@/hooks/use-admin"
import { useDraft } from "@/hooks/use-draft"
import { useSession } from "@/hooks/use-session"
import { devLogout, exportYaml } from "@/lib/admin-api"
import { SECTIONS } from "@/lib/admin-ui"
import { devSession } from "@/lib/dev-session"
import type { Stage } from "@/types/run"

/**
 * The configuration editor.
 *
 * Every International moves the numbers -- new tiers, a retuned trait, a stat
 * revalued, a roster that changed between the qualifier and the event -- and
 * each of those used to be a YAML edit plus a full crawl. That is the right
 * price when the MEASUREMENTS change and a needless one when only the table
 * does, so this page pays the smaller one.
 *
 * It can, because of a fact about the server rather than a decision made here:
 * scores are computed per request from the scoring table against raw per-game
 * values, so the table can be replaced between requests and the measurements
 * cannot be replaced at all.
 *
 * Which also makes it the most direct route this project has to a confidently
 * wrong number. Nothing typed here is public until it is published; publishing
 * needs a saved draft, a clean server-side validation against the run being
 * served, and a written reason; every published version is immutable, numbered
 * and attributed.
 *
 * The layout carries one rule worth stating. Status and actions sit in a rail
 * beside the work, not in banners above it. Stacked full-width alerts are not
 * more warning -- they are a wall the reader scrolls past to reach the form,
 * and the one that mattered looks exactly like the three that did not. What is
 * left in the main column is the section being edited, and the single banner
 * that describes something actually broken.
 */
export function AdminPage() {
  const session = useSession()
  const admin = useAdmin(session)
  const [selected, setSelected] = useState<{ tournamentId: string; stage: Stage } | null>(null)
  const [section, setSection] = useState<string>(SECTIONS[0].value)
  const [publishOpen, setPublishOpen] = useState(false)
  const draft = useDraft(selected?.tournamentId, selected?.stage)
  // Present only when the local password door was used. A `sessionStorage` read
  // per render rather than state, so it cannot disagree with what the API
  // client sends.
  const local = devSession()

  if (session.status === "loading" || admin.status === "loading") {
    return (
      <Shell>
        <Loading>Checking whether you can edit the configuration…</Loading>
      </Shell>
    )
  }

  if (admin.status !== "admin") {
    // One page for "not signed in", "signed in and not an admin" and "this
    // deployment has no auth". Different situations, same answer -- and saying
    // which one applies to a stranger turns this page into a way of finding out
    // who the admins are.
    return (
      <Shell>
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertTitle>This page is not available to you</AlertTitle>
          <AlertDescription>
            {admin.status === "unavailable"
              ? "This deployment has no sign-in configured, so it has no administrators."
              : "Sign in with an account that can change the configuration."}
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" render={<a href="/admin/login" />}>
            Sign in with a username
          </Button>
          <BackLink />
        </div>
      </Shell>
    )
  }

  if (draft.isLoading) {
    return (
      <Shell>
        <Loading>Loading the published run and the current draft…</Loading>
      </Shell>
    )
  }

  if (draft.error || !draft.config) {
    return (
      <Shell>
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertTitle>The configuration could not be loaded</AlertTitle>
          <AlertDescription>
            {draft.error instanceof Error ? draft.error.message : "Unknown error."}
          </AlertDescription>
        </Alert>
        <BackLink />
      </Shell>
    )
  }

  const { config } = draft
  const preview = config.preview

  // The effective tables come from the server's own apply, and only once the
  // draft has been saved. While there are unsaved edits the form shows the last
  // CHECKED state rather than a browser-side guess -- a second implementation of
  // `applyOverlay` in here is exactly the thing whose disagreement with the
  // first would be invisible.
  const effective = !draft.dirty && preview?.ok ? preview : undefined
  const blocked = preview !== null && !preview.ok

  return (
    <Shell
      toolbar={
        <>
          <StageSwitcher
            available={config.available}
            current={{
              tournamentId: config.scope.tournamentId,
              stage: config.scope.stage as Stage,
            }}
            onSelect={setSelected}
          />
          {local ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                devLogout()
                window.location.assign("/admin/login")
              }}
            >
              <LogOut aria-hidden />
              Sign out
            </Button>
          ) : null}
          <BackLink />
        </>
      }
      subtitle={
        local
          ? `Signed in as ${local.email}`
          : session.status === "user"
            ? `Signed in as ${session.session.user.email}`
            : undefined
      }
    >
      {/* A plain two-column layout, not a vertical tablist. The sections are
          navigation and say so with `nav` and `aria-current`; nesting a
          tablist here also collided with the scoring panes' own strip, since
          Tailwind's `group/tabs` variants match any ancestor. */}
      <div className="flex flex-col items-start gap-6 md:flex-row">
        <div className="w-full shrink-0 md:w-64 xl:w-72">
          <AdminSidebar
            section={section}
            onSection={setSection}
            config={config}
            preview={preview}
            dirty={draft.dirty}
            saving={draft.saving}
            onSave={draft.save}
            onPublish={() => setPublishOpen(true)}
            onDiscard={draft.discard}
            onExport={() => void download(config.scope.tournamentId, config.scope.stage)}
          />
        </div>

        {/* `min-w-0`, or a wide table inside a flex child refuses to shrink and
            pushes the whole page into a horizontal scroll. */}
        <main id="editor" className="grid min-w-0 flex-1 gap-4">
          {blocked ? (
            <Alert variant="destructive">
              <ShieldAlert aria-hidden />
              <AlertTitle>This draft cannot be published</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 grid list-disc gap-1 pl-4">
                  {preview.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          {draft.actionError ? (
            <Alert variant="destructive">
              <ShieldAlert aria-hidden />
              <AlertTitle>That did not go through</AlertTitle>
              <AlertDescription>
                {draft.actionError instanceof Error
                  ? draft.actionError.message
                  : "Unknown error."}
                {reasonsOf(draft.actionError).length > 0 ? (
                  <ul className="mt-1 grid list-disc gap-1 pl-4">
                    {reasonsOf(draft.actionError).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {section === "scoring" ? (
            <ScoringEditor
              config={config}
              doc={draft.doc}
              onChange={draft.setDoc}
              effective={effective?.scoring}
            />
          ) : null}

          {section === "roster" ? (
            <RosterEditor
              config={config}
              doc={draft.doc}
              onChange={draft.setDoc}
              effective={effective}
            />
          ) : null}

          {section === "catalog" ? (
            <Card>
              <CardHeader>
                <CardTitle>Emblem catalog</CardTitle>
                <p className="text-muted-foreground mt-1 text-xs">
                  Read-only, and deliberately so. The catalog is every stat × tier × trait
                  the client can produce, so it is not an input — it is the product of the
                  three tables on the Scoring tab. An emblem list edited beside them would
                  be a second source of truth that disagrees the moment either side moves.
                </p>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                <p>
                  Published run:{" "}
                  <strong>{config.published.emblemCount.toLocaleString()}</strong> emblems.
                </p>
                {effective ? (
                  <p>
                    With this draft:{" "}
                    <strong>{effective.emblemCount.toLocaleString()}</strong> emblems (
                    {Object.keys(effective.scoring.stats).length} stats ×{" "}
                    {Object.keys(effective.scoring.quality).length} tiers ×{" "}
                    {Object.keys(effective.scoring.traits).length} traits).
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Save the draft to see what it would generate.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {section === "history" ? (
            <HistoryPanel
              tournamentId={config.scope.tournamentId}
              stage={config.scope.stage}
              currentVersion={config.live?.version ?? null}
              onLoad={draft.loadVersion}
            />
          ) : null}
        </main>
      </div>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        config={config}
        preview={preview}
        publishing={draft.publishing}
        onPublish={(note) => {
          draft.publish(note)
          setPublishOpen(false)
        }}
      />
    </Shell>
  )
}

/**
 * The frame every state of this page shares.
 *
 * No account menu. On the public page that control is the only way in or out of
 * an account; here it was a "Sign in" button sitting a few inches from the words
 * "Signed in as amenyuwel" -- two facts about one thing, disagreeing, because
 * the local password door is not a Supabase session and that menu only knows
 * about Supabase. Signing out belongs to whichever door was actually used, so
 * it is rendered by the page that knows which.
 */
function Shell({
  children,
  toolbar,
  subtitle,
}: {
  children: ReactNode
  toolbar?: ReactNode
  subtitle?: string
}) {
  return (
    // No max width. The public tool is reading material and caps its line
    // length; this is a table of eighteen stats across five columns, and
    // capping it at 1152px left the tables cramped while the screen sat empty
    // on both sides. Prose inside the cards carries `max-w-prose` instead, so
    // the paragraphs stay readable without holding the tables back.
    <div className="grid w-full gap-4 px-4 py-6 2xl:px-8">
      <a
        href="#editor"
        className="bg-background focus:ring-ring sr-only rounded-md px-3 py-2 text-sm focus:not-sr-only focus:ring-2"
      >
        Skip to the editor
      </a>

      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-4">
        <div className="mr-auto grid gap-0.5">
          <h1 className="font-heading text-xl font-semibold tracking-tight">Configuration</h1>
          {subtitle ? <p className="text-muted-foreground text-xs">{subtitle}</p> : null}
        </div>
        {/* One cluster, not three loose controls. An auto margin on a bare
            control pushes only that one right and leaves the rest free to break
            off a line at a time; auto margins resolve per flex line, so a
            wrapped group stays together on whichever line it lands on. */}
        <div className="flex flex-wrap items-center justify-end gap-1">
          {toolbar}
          <ThemeMenu />
        </div>
      </header>

      {children}
    </div>
  )
}

function BackLink() {
  return (
    <Button size="sm" variant="ghost" render={<a href="/" />}>
      <ArrowLeft aria-hidden />
      Back to the tool
    </Button>
  )
}

/** The server rejects an overlay for EVERY reason at once, precisely so all of
 * them can be shown. Fixing them one round trip at a time is how a five-minute
 * correction becomes an afternoon. */
function reasonsOf(error: unknown): string[] {
  return error && typeof error === "object" && "reasons" in error
    ? ((error as { reasons?: string[] }).reasons ?? [])
    : []
}

/**
 * Hand the YAML over as a file.
 *
 * A download rather than a copy button, because what comes back is a block to
 * paste into a file in the repository, in a commit, beside the comments that
 * explain the traps. That round trip is how an overlay retires -- without it a
 * correction lives in the database forever and silently reverts a deliberate
 * change the day one is published.
 */
async function download(tournamentId: string, stage: string): Promise<void> {
  const yaml = await exportYaml(tournamentId, stage)
  const url = URL.createObjectURL(new Blob([yaml], { type: "text/yaml" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `${tournamentId}-${stage}-scoring.yaml`
  link.click()
  URL.revokeObjectURL(url)
}
