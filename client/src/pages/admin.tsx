import { useState, type ReactNode } from "react"
import { ArrowLeft, ShieldAlert } from "lucide-react"

import { AdminNav, DraftStatus } from "@/components/admin/admin-sidebar"
import { ConfirmDialog, type ConfirmRequest } from "@/components/admin/confirm-dialog"
import { HistoryPanel } from "@/components/admin/history-panel"
import { PublishDialog } from "@/components/admin/publish-dialog"
import { RosterEditor } from "@/components/admin/roster-editor"
import { ScoringEditor } from "@/components/admin/scoring-editor"
import { StageSwitcher } from "@/components/stage-switcher"
import { ThemeMenu } from "@/components/theme-menu"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton, SkeletonPanel } from "@/components/ui/skeleton"
import { useAdmin } from "@/hooks/use-admin"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useDraft } from "@/hooks/use-draft"
import { useSession } from "@/hooks/use-session"
import { exportYaml } from "@/lib/admin-api"
import { SECTIONS } from "@/lib/admin-ui"
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
  const [pending, setPending] = useState<ConfirmRequest | null>(null)
  const draft = useDraft(selected?.tournamentId, selected?.stage)
  // Whether the rail sits beside the editor or the page is one column -- the
  // same 48rem the flex direction below switches at. It decides WHERE the draft
  // status is rendered, which CSS cannot do: `order` moves the box and leaves
  // the tab order behind it, so a phone would tab into the editor from a card
  // sitting visually after it. Read up here with the other hooks, because the
  // loading and unauthorised states below return early.
  const wide = useMediaQuery("(min-width: 48rem)")

  if (session.status === "loading" || admin.status === "loading") {
    return (
      <Shell>
        {/* Deliberately NOT the editor's shape. This check resolves to the
            editor or to a refusal, and holding open two columns of forms for
            somebody who is about to be told they cannot edit anything is a
            promise the page may not keep. */}
        <SkeletonPanel label="Checking whether you can edit the configuration…">
          <Skeleton className="h-24 w-full rounded-xl" />
        </SkeletonPanel>
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
        {/* One way out, and it is the only one that can help: signing in
            happens on the tool, through the account menu, and this page has no
            sign-in of its own to offer. */}
        <BackLink />
      </Shell>
    )
  }

  if (draft.isLoading) {
    return (
      <Shell>
        <EditorSkeleton />
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

  // One element, placed in one of two slots. Built here rather than twice, so
  // the two layouts cannot drift into two different status cards.
  const status = (
    <DraftStatus
      config={config}
      preview={preview}
      dirty={draft.dirty}
      saving={draft.saving}
      onSave={draft.save}
      onPublish={() => setPublishOpen(true)}
      onDiscard={() =>
        setPending({
          title: "Discard this draft?",
          detail:
            "Every unpublished edit in it goes. What is live now is unaffected — the published version keeps serving.",
          // A draft has no name of its own, so the stage it belongs to is what
          // gets typed. It is still the thing being destroyed, and it is still
          // on screen to be read off.
          confirmText: config.scope.stage,
          confirmLabel: "Discard draft",
          // The one action here that writes through: it deletes the draft row
          // rather than adding an entry to it, so the Removed list cannot bring
          // it back.
          reversible: false,
          onConfirm: draft.discard,
        })
      }
      onExport={() => void download(config.scope.tournamentId, config.scope.stage)}
    />
  )

  return (
    <Shell
      toolbar={
        <StageSwitcher
          available={config.available}
          current={{
            tournamentId: config.scope.tournamentId,
            stage: config.scope.stage as Stage,
          }}
          onSelect={setSelected}
        />
      }
      subtitle={
        session.status === "user"
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
          {/* The nav sits directly on top of what it navigates at every width.
              Beside the editor the status card follows it, the way a rail is
              read: where you are, then what state the draft is in. In one
              column it does not follow it at all -- see below. */}
          <div className="grid gap-4 md:sticky md:top-4">
            <AdminNav section={section} onSection={setSection} />
            {wide ? status : null}
          </div>
        </div>

        {/* `min-w-0`, or a wide table inside a flex child refuses to shrink and
            pushes the whole page into a horizontal scroll.

            `w-full` for the other direction, and it is not redundant with
            `flex-1`: below `md` this row is a COLUMN, where width is the cross
            axis and `items-start` sizes every child to its own content. A
            section whose content happened to be wide -- a scoring table -- filled
            the page and hid that; one whose content is four short buttons came
            out the width of the word "Colours". In the row direction `flex-1`
            still decides the width, because a `flex-basis` of 0 outranks a
            declared one. */}
        <main id="editor" className="grid w-full min-w-0 flex-1 gap-4">
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

        {/* Last in one column. Save and Publish are what you reach for once the
            editing is done, and the live version is read once on arrival --
            neither is worth a screenful above the form on a phone. */}
        {wide ? null : <div className="w-full">{status}</div>}
      </div>

      <ConfirmDialog request={pending} onClose={() => setPending(null)} />

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
 * an account; this page is reached FROM that menu, already signed in, and it
 * says so in the subtitle. A second control offering to sign in, inches from
 * the words "Signed in as", is one fact stated twice and disagreeing with
 * itself. The way out is the link back to the tool.
 */
/**
 * The editor's own shape, held open while the draft loads.
 *
 * Here the outcome IS this layout -- admin is already established by the time
 * this renders, so the rail and the form are what arrive -- which is what makes
 * reserving them honest rather than a guess. A single line of text in this
 * space left the configuration page empty under its own header and then dropped
 * a two-column editor into it, which reads as the page having been broken and
 * then suddenly fixed.
 */
function EditorSkeleton() {
  return (
    <SkeletonPanel
      label="Loading the published run and the current draft…"
      className="flex flex-col items-start gap-6 space-y-0 md:flex-row"
    >
      {/* The rail, at the width it actually takes. */}
      <div className="w-full shrink-0 space-y-2 md:w-64 xl:w-72">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-9 w-full" />
      </div>

      {/* The section being edited: a heading, a paragraph, then a table. */}
      <div className="w-full min-w-0 space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full max-w-prose" />
        <Skeleton className="h-4 w-3/4 max-w-prose" />
        <Skeleton className="h-72 w-full" />
      </div>
    </SkeletonPanel>
  )
}

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
        <div className="mr-auto grid justify-items-start gap-0.5">
          {/* Pulled left by the button's own padding so its label starts on the
              same vertical as the heading under it, rather than indented from
              it by an amount that reads as a mistake. */}
          <BackLink className="-ml-2.5" />
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

/**
 * The way back to the public tool.
 *
 * On every state of this page, including the working one. It was once only on
 * the dead ends -- refused, failed to load -- on the reasoning that /admin is a
 * URL somebody reached deliberately and the browser's back button undoes that.
 * Back does not, reliably: the two ways in are a link from the account menu and
 * a redirect after the dev sign-in, and after a publish or a reload the entry
 * that button goes to is somewhere in the middle of an editing session rather
 * than the tool. An exit a reader has to guess at is not an exit, and the
 * account page has carried the same link all along.
 */
function BackLink({ className }: { className?: string }) {
  return (
    <Button size="sm" variant="ghost" className={className} render={<a href="/" />}>
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
