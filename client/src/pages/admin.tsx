import { useState } from "react"
import { ArrowLeft, LogOut, ShieldAlert } from "lucide-react"

import { AccountMenu } from "@/components/account-menu"
import { HistoryPanel } from "@/components/admin/history-panel"
import { PublishBar } from "@/components/admin/publish-bar"
import { RosterEditor } from "@/components/admin/roster-editor"
import { ScoringEditor } from "@/components/admin/scoring-editor"
import { SiteFooter } from "@/components/site-footer"
import { StageSwitcher } from "@/components/stage-switcher"
import { ThemeMenu } from "@/components/theme-menu"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loading } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAdmin } from "@/hooks/use-admin"
import { useDraft } from "@/hooks/use-draft"
import { useSession, type AuthState } from "@/hooks/use-session"
import { devLogout, exportYaml } from "@/lib/admin-api"
import { devSession } from "@/lib/dev-session"
import type { Stage } from "@/types/run"

/**
 * The configuration editor.
 *
 * Every International moves the numbers -- new tiers, new trait bonuses, a stat
 * revalued, a roster that changed between the qualifier and the event -- and
 * until now each of those was a YAML edit plus a full re-crawl. That is the
 * right price when the MEASUREMENTS change and a needless one when only the
 * table does, so this page exists to pay the smaller price.
 *
 * It can do that because of a fact about the server rather than a decision made
 * here: scores are computed per request from the scoring table against raw
 * per-game values, so the table can be replaced between requests and the
 * measurements cannot be replaced at all.
 *
 * Which means the page is also the most direct route this project has to a
 * confidently wrong number, and it is built accordingly. Nothing typed here is
 * public until it is published; publishing needs a saved draft, a clean
 * server-side validation against the run being served, and a written reason;
 * and every published version is immutable, numbered and attributed.
 */
export function AdminPage() {
  const session = useSession()
  const admin = useAdmin(session)
  const [selected, setSelected] = useState<{ tournamentId: string; stage: Stage } | null>(null)
  const draft = useDraft(selected?.tournamentId, selected?.stage)
  // Present only when the local password door was used. Read once per render
  // rather than held in state: it is a `sessionStorage` lookup, and state would
  // be a second copy that can disagree with the one the API client reads.
  const local = devSession()

  if (session.status === "loading" || admin.status === "loading") {
    return (
      <Shell session={session}>
        <Loading>Checking whether you can edit the configuration…</Loading>
      </Shell>
    )
  }

  if (admin.status !== "admin") {
    // One page for "not signed in", "signed in and not an admin" and "this
    // deployment has no auth". They are different situations but the same
    // answer, and spelling out which one applies to a stranger turns this page
    // into a way of finding out who the admins are.
    return (
      <Shell session={session}>
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
          {/* Offered without checking whether the door exists: the login page
              asks that itself and says so plainly, which is one place holding
              the answer instead of two that can disagree. */}
          <Button size="sm" variant="outline" render={<a href="/admin/login" />}>
            Sign in with a username
          </Button>
          <Back />
        </div>
      </Shell>
    )
  }

  if (draft.isLoading) {
    return (
      <Shell session={session}>
        <Loading>Loading the published run and the current draft…</Loading>
      </Shell>
    )
  }

  if (draft.error || !draft.config) {
    return (
      <Shell session={session}>
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertTitle>The configuration could not be loaded</AlertTitle>
          <AlertDescription>
            {draft.error instanceof Error ? draft.error.message : "Unknown error."}
          </AlertDescription>
        </Alert>
        <Back />
      </Shell>
    )
  }

  const { config } = draft
  const preview = config.preview

  // The effective tables come from the server's own apply, and only once the
  // draft has been saved. While there are unsaved edits the form shows the last
  // CHECKED state rather than a browser-side guess at what the edits would do --
  // a second implementation of `applyOverlay` in here is exactly the thing whose
  // disagreement with the first would be invisible.
  const effective = !draft.dirty && preview?.ok ? preview : undefined

  return (
    <Shell session={session}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto grid gap-0.5">
          <h1 className="font-heading text-xl font-semibold">Configuration</h1>
          <p className="text-muted-foreground text-xs">
            Signed in as {local?.email ?? (session.status === "user" ? session.session.user.email : "an admin")}
          </p>
        </div>
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
        <Back />
      </div>

      <Alert>
        <ShieldAlert aria-hidden />
        <AlertTitle>What this page can and cannot change</AlertTitle>
        <AlertDescription>
          <p>
            The scoring table is read on every request, so editing it takes effect without a
            re-crawl: stats, emblem tiers, traits, the palette and the slot-colour rule. The
            emblem catalog is not edited directly - it is the cross product of stats, tiers
            and traits, and is regenerated whenever any of those move.
          </p>
          <p className="mt-1">
            Measurements are not editable at all. A player's per-game stat lines and a team's
            simulated schedule come from the crawler, so a player added here is carried
            through the tool as having no data until the next{" "}
            <code>python -m scripts.publish</code>.
          </p>
        </AlertDescription>
      </Alert>

      <PublishBar
        config={config}
        preview={preview}
        dirty={draft.dirty}
        saving={draft.saving}
        publishing={draft.publishing}
        onSave={draft.save}
        onPublish={draft.publish}
        onDiscard={draft.discard}
        onExport={() => void download(config.scope.tournamentId, config.scope.stage)}
      />

      {draft.actionError ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertTitle>That did not go through</AlertTitle>
          <AlertDescription>
            {draft.actionError instanceof Error ? draft.actionError.message : "Unknown error."}
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

      <Tabs defaultValue="scoring">
        <TabsList>
          <TabsTrigger value="scoring">Scoring</TabsTrigger>
          <TabsTrigger value="roster">Teams and players</TabsTrigger>
          <TabsTrigger value="catalog">Emblem catalog</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="scoring" className="mt-4">
          <ScoringEditor
            config={config}
            doc={draft.doc}
            onChange={draft.setDoc}
            effective={effective?.scoring}
          />
        </TabsContent>

        <TabsContent value="roster" className="mt-4">
          <RosterEditor
            config={config}
            doc={draft.doc}
            onChange={draft.setDoc}
            effective={effective}
          />
        </TabsContent>

        <TabsContent value="catalog" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Emblem catalog</CardTitle>
              <p className="text-muted-foreground mt-1 text-xs">
                Read-only, and deliberately so. The catalog is every stat x tier x trait the
                client can produce, so it is not an input - it is the product of the three
                tables on the Scoring tab. An emblem list edited beside them would be a
                second source of truth that disagrees the moment either side moves.
              </p>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              <p>
                Published run: <strong>{config.published.emblemCount.toLocaleString()}</strong>{" "}
                emblems.
              </p>
              {effective ? (
                <p>
                  With this draft:{" "}
                  <strong>{effective.emblemCount.toLocaleString()}</strong> emblems
                  {" "}
                  ({Object.keys(effective.scoring.stats).length} stats x{" "}
                  {Object.keys(effective.scoring.quality).length} tiers x{" "}
                  {Object.keys(effective.scoring.traits).length} traits).
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Save the draft to see what it would generate.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryPanel
            tournamentId={config.scope.tournamentId}
            stage={config.scope.stage}
            currentVersion={config.live?.version ?? null}
            onLoad={draft.loadVersion}
          />
        </TabsContent>
      </Tabs>
    </Shell>
  )
}

function Shell({
  children,
  session,
}: {
  children: React.ReactNode
  session: AuthState
}) {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6">
      <header className="flex items-center justify-end gap-2">
        <ThemeMenu />
        <AccountMenu state={session} />
      </header>
      {children}
      <SiteFooter />
    </div>
  )
}

function Back() {
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
