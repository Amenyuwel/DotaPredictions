import { useQueries } from "@tanstack/react-query"
import {
  ArrowLeft,
  Bookmark,
  LogOut,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react"

import { ThemeMenu } from "@/components/theme-menu"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton, SkeletonPanel } from "@/components/ui/skeleton"
import { useAdmin } from "@/hooks/use-admin"
import { runQueryOptions } from "@/hooks/use-run"
import { useAllSavedBanners, useDeleteBanner } from "@/hooks/use-saved-banners"
import { useAllSavedRosters, useDeleteRoster } from "@/hooks/use-saved-rosters"
import { displayName, useSession, type AuthState } from "@/hooks/use-session"
import { timestamp } from "@/lib/format"
import { ROLE_LABEL, ROLE_ORDER, STAGE_LABEL, tournamentLabel } from "@/lib/labels"
import { signOut, type SavedBanner, type SavedRoster } from "@/lib/supabase"
import type { CurrentRun, Stage } from "@/types/run"

/**
 * Everything an account is, on one page.
 *
 * The tool itself is deliberately run-scoped: the sidebar shows what you saved
 * for the stage on screen, because a Group Stage banner offered inside a Main
 * Event would load three emblems into five slots and score as though it
 * belonged there. That scoping is correct, and it leaves a hole -- work saved
 * against a stage that has since ended becomes unreachable, and therefore
 * undeletable, the moment the switcher stops offering that stage.
 *
 * This page is that hole's answer and nothing more. It lists across every
 * tournament and stage, which is the one question the scoped lists cannot be
 * asked, and it does not offer to LOAD anything: loading needs the run on
 * screen to be the run the banner belongs to, and the only honest place to make
 * that true is the switcher. A "load" button here would either silently change
 * which stage the tool is answering about or drop a banner into the wrong one,
 * and both are this project's expensive failure -- a confident answer to a
 * question nobody asked.
 *
 * It is not an authorisation surface either. The configuration link appears for
 * an admin and the server re-checks that on every request behind it, so a
 * forged answer here buys a link and a 403.
 */
export function AccountPage() {
  const auth = useSession()

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <Button size="sm" variant="ghost" render={<a href="/" />}>
          <ArrowLeft aria-hidden />
          Back to the tool
        </Button>
        <ThemeMenu />
      </header>

      {auth.status === "loading" ? (
        // The identity card is what resolves into this space, so that is the
        // shape held open. The page has nothing else above the fold.
        <SkeletonPanel label="Checking your sign-in…" className="space-y-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </SkeletonPanel>
      ) : auth.status === "unavailable" ? (
        <Alert>
          <ShieldAlert aria-hidden />
          <AlertTitle>This deployment has no sign-in</AlertTitle>
          <AlertDescription>
            Rankings work exactly the same without one. Nothing can be saved, so there is
            no account to show.
          </AlertDescription>
        </Alert>
      ) : auth.status === "guest" ? (
        <Alert>
          <ShieldAlert aria-hidden />
          <AlertTitle>You are not signed in</AlertTitle>
          <AlertDescription>
            Rankings work exactly the same as a guest - the model does not know or care who
            is asking. Signing in buys one thing: banners and rosters that survive closing
            the tab. Use the sign-in button on{" "}
            <a className="underline" href="/">
              the tool
            </a>
            .
          </AlertDescription>
        </Alert>
      ) : (
        <SignedIn auth={auth} />
      )}
    </div>
  )
}

function SignedIn({ auth }: { auth: Extract<AuthState, { status: "user" }> }) {
  const admin = useAdmin(auth)
  const user = auth.session.user

  const banners = useAllSavedBanners(true)
  const rosters = useAllSavedRosters(true)

  // One group per run something was saved against, newest activity first. Built
  // from the rows rather than from the published run list on purpose: a stage
  // nobody publishes any more is exactly the case this page exists for, and it
  // would be absent from any list the server offers.
  const groups = groupSaved(banners.data ?? [], rosters.data ?? [])

  // Each group's run, for the names. A roster row holds player ids and a banner
  // row holds emblem ids, because ids are what survives a re-publish; the words
  // for them live in the run. The same query options the tool uses, so this
  // shares its cache rather than fetching a second copy of a payload it holds.
  const runs = useQueries({
    queries: groups.map((group) => runQueryOptions(group.tournamentId, group.stage as Stage)),
  })

  const pending = banners.isPending || rosters.isPending
  const failure = banners.error ?? rosters.error

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{displayName(auth.session)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Fact label="Email" value={user.email ?? "Not shared by the provider"} />
            <Fact label="Signed in with" value={providersOf(auth)} />
            <Fact
              label="Account created"
              value={user.created_at ? timestamp(user.created_at) : "Unknown"}
            />
            <Fact
              label="This session began"
              value={user.last_sign_in_at ? timestamp(user.last_sign_in_at) : "Unknown"}
            />
          </dl>

          <Separator />

          <div className="flex flex-wrap gap-2">
            {admin.status === "admin" ? (
              <Button size="sm" variant="outline" render={<a href="/admin" />}>
                <SlidersHorizontal aria-hidden />
                Configuration
              </Button>
            ) : null}
            {/* A full navigation rather than a state change: signing out changes
                who the whole page is for, and landing back on the tool the way a
                bookmark would is one code path instead of two. `finally`, not
                `then`, because a sign-out that failed to reach the network has
                still cleared the local session and must not strand the page on
                an account it can no longer act as. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void signOut().finally(() => window.location.assign("/"))}
            >
              <LogOut aria-hidden />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

      {pending ? (
        <SavedCard>
          <SkeletonPanel label="Loading everything you have saved…">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </SkeletonPanel>
        </SavedCard>
      ) : failure ? (
        <SavedCard>
          <p className="text-destructive text-xs">
            Could not load what you have saved: {failure.message}
          </p>
        </SavedCard>
      ) : groups.length === 0 ? (
        <SavedCard>
          <p className="text-muted-foreground text-xs">
            Nothing saved yet. Finish a banner or pick a roster in the tool, name it, and it
            is listed here.
          </p>
        </SavedCard>
      ) : (
        groups.map((group, index) => (
          <GroupCard
            key={group.key}
            group={group}
            run={runs[index]?.data as CurrentRun | undefined}
          />
        ))
      )}
    </>
  )
}

function SavedCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Saved work</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** One run something was saved against, with everything saved against it. */
interface Group {
  key: string
  tournamentId: string
  stage: string
  banners: SavedBanner[]
  rosters: SavedRoster[]
  /** The newest row in the group, which is what the list is ordered by. */
  lastSavedAt: string
}

function GroupCard({ group, run }: { group: Group; run: CurrentRun | undefined }) {
  const removeBanner = useDeleteBanner()
  const removeRoster = useDeleteRoster()

  // Both maps are built from the run when there is one. When there is not --
  // the stage is no longer published, or the fetch failed -- the id is printed
  // AS an id rather than dressed up as a name. A row that cannot be resolved
  // still has to be deletable, which is most of why this page exists, so a
  // missing run costs the words and never the row.
  const emblemName = new Map((run?.emblems ?? []).map((e) => [e.emblemId, e.displayName]))
  const playerName = new Map((run?.players ?? []).map((p) => [p.playerId, p.nick]))

  const stageLabel = STAGE_LABEL[group.stage as Stage] ?? group.stage
  const removalError = removeBanner.error ?? removeRoster.error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {tournamentLabel(group.tournamentId)} {stageLabel}
        </CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          Last saved {timestamp(group.lastSavedAt)}
          {run ? "" : " · this stage is not published now, so only the ids are known"}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {group.banners.length > 0 ? (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-medium">
              <Bookmark aria-hidden className="size-3.5" />
              Banners
            </h3>
            <ul className="space-y-3">
              {group.banners.map((banner) => (
                <li key={banner.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {banner.label || `${ROLE_LABEL[banner.role]} banner`}{" "}
                      <span className="text-muted-foreground text-xs">
                        · {ROLE_LABEL[banner.role]}
                      </span>
                    </p>
                    {/* Numbered, because the order IS the banner: Vampiric
                        charges each neighbour and Benevolent pays each, so the
                        same five emblems in another order are a different one. */}
                    <ol className="text-muted-foreground mt-0.5 text-xs">
                      {banner.emblemIds.map((emblemId, slot) => (
                        <li key={`${emblemId}-${slot}`} className="truncate">
                          {slot + 1}. {emblemName.get(emblemId) ?? <code>{emblemId}</code>}
                        </li>
                      ))}
                    </ol>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      Saved {timestamp(banner.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${banner.label || "saved banner"}`}
                    disabled={removeBanner.isPending}
                    onClick={() => removeBanner.mutate(banner.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {group.banners.length > 0 && group.rosters.length > 0 ? <Separator /> : null}

        {group.rosters.length > 0 ? (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-medium">
              <Users aria-hidden className="size-3.5" />
              Rosters
            </h3>
            <ul className="space-y-3">
              {group.rosters.map((roster) => (
                <li key={roster.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{roster.label || "Roster"}</p>
                    <dl className="text-muted-foreground mt-0.5 grid gap-x-3 text-xs sm:grid-cols-3">
                      {ROLE_ORDER.map((role) => (
                        <div key={role} className="truncate">
                          <dt className="inline">{ROLE_LABEL[role]}: </dt>
                          <dd className="inline">
                            {playerName.get(roster.players[role]) ?? (
                              <code>#{roster.players[role]}</code>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      Saved {timestamp(roster.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${roster.label || "saved roster"}`}
                    disabled={removeRoster.isPending}
                    onClick={() => removeRoster.mutate(roster.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {removalError ? (
          <p role="alert" className="text-destructive text-xs">
            Could not delete: {removalError.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  )
}

/**
 * Which providers this account can sign in with.
 *
 * `identities` rather than the session's single provider claim, because linking
 * is the thing a reader comes here to check: an account that signed up with
 * Google and later authorised GitHub is ONE user with one id, and the page
 * should say both rather than name whichever provider minted this session.
 */
function providersOf(auth: Extract<AuthState, { status: "user" }>): string {
  const names = (auth.session.user.identities ?? []).map((identity) => identity.provider)
  return names.length > 0 ? names.join(", ") : "Unknown"
}

/**
 * Saved rows, gathered into the runs they were saved against.
 *
 * Grouped rather than listed in two flat lists because a banner and a roster
 * saved for the same stage are two answers about one run, and two separate
 * headings would make a reader check whether the stages under them matched.
 */
function groupSaved(banners: SavedBanner[], rosters: SavedRoster[]): Group[] {
  const groups = new Map<string, Group>()

  const groupFor = (tournamentId: string, stage: string): Group => {
    const key = `${tournamentId}:${stage}`
    const existing = groups.get(key)
    if (existing) return existing
    const created: Group = {
      key,
      tournamentId,
      stage,
      banners: [],
      rosters: [],
      lastSavedAt: "",
    }
    groups.set(key, created)
    return created
  }

  for (const banner of banners) {
    const group = groupFor(banner.tournamentId, banner.stage)
    group.banners.push(banner)
    if (banner.createdAt > group.lastSavedAt) group.lastSavedAt = banner.createdAt
  }
  for (const roster of rosters) {
    const group = groupFor(roster.tournamentId, roster.stage)
    group.rosters.push(roster)
    if (roster.createdAt > group.lastSavedAt) group.lastSavedAt = roster.createdAt
  }

  // Newest activity first. Postgres hands back fixed-width UTC ISO-8601, so
  // string order is time order and nothing has to construct a Date to sort by.
  return [...groups.values()].sort((a, b) => b.lastSavedAt.localeCompare(a.lastSavedAt))
}
