import { useEffect, useState } from "react"
import { KeyRound, ShieldAlert } from "lucide-react"

import { SiteFooter } from "@/components/site-footer"
import { ThemeMenu } from "@/components/theme-menu"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Loading } from "@/components/ui/spinner"
import { devLogin, devLoginAvailable } from "@/lib/admin-api"

/**
 * The local development sign-in.
 *
 * This page exists because getting a Supabase session needs a completed OAuth
 * round trip, which needs redirect URIs registered with a provider -- correct
 * for a deployed tool, and a wall in front of somebody who only wants to see
 * whether the editor works on their own machine.
 *
 * What it is NOT is a password checked in the browser. The pair is posted to
 * `POST /api/admin/login`, compared there against values held in the server's
 * environment, and exchanged for a signed token with an expiry. Every admin
 * request then carries that token and is verified server-side, exactly as a
 * Supabase session would be. A form that decided locally that it was satisfied
 * would ship the password in the bundle AND still be refused on save, which is
 * the worst of both.
 *
 * The page renders nothing usable unless the server says this door exists. A
 * build pointed at a deployment using Supabase auth is sent back to the tool
 * rather than shown a login that cannot succeed.
 */
export function AdminLoginPage() {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void devLoginAvailable().then((ok) => {
      if (live) setAvailable(ok)
    })
    return () => {
      live = false
    }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await devLogin(username, password)
      // A full navigation rather than a state change: the editor is a separate
      // entry point that reads the session on mount, and landing on it the same
      // way a bookmark would is one code path instead of two.
      window.location.assign("/admin")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPending(false)
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-md gap-4 px-4 py-6">
      <header className="flex items-center justify-end">
        <ThemeMenu />
      </header>

      {available === null ? (
        <Loading>Checking how this deployment signs administrators in…</Loading>
      ) : !available ? (
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertTitle>There is no password sign-in here</AlertTitle>
          <AlertDescription>
            This deployment signs administrators in through Supabase. Use the account menu
            on the main page. <a className="underline" href="/">Back to the tool</a>
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound aria-hidden className="size-4" />
              Configuration sign-in
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              Local development access to the configuration editor.
            </p>
          </CardHeader>

          <CardContent>
            {/* A real form: submits on Enter, and the browser can offer to fill
                it. Two labelled fields with the right autocomplete hints is the
                whole accessibility story here, and skipping it would make the
                one page that gates everything else the least usable one. */}
            <form onSubmit={submit} className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="admin-username" className="text-sm font-medium">
                  Username
                </label>
                <Input
                  id="admin-username"
                  name="username"
                  autoComplete="username"
                  autoFocus
                  required
                  value={username}
                  onChange={(event) => setUsername(event.currentTarget.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <label htmlFor="admin-password" className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id="admin-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                />
              </div>

              {/* Announced rather than merely drawn: somebody who submitted with
                  Enter is not looking at the space under the button. */}
              <p role="alert" aria-live="polite" className="text-destructive min-h-5 text-xs">
                {error}
              </p>

              <Button type="submit" disabled={pending}>
                {pending ? <Loading>Signing in…</Loading> : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {available ? (
        <Alert>
          <ShieldAlert aria-hidden />
          <AlertTitle>This is a development shortcut</AlertTitle>
          <AlertDescription>
            It replaces the Supabase session and the <code>public.admins</code> check with a
            username and password from the server's environment. The server refuses to start
            with it enabled and <code>NODE_ENV=production</code>, so it cannot reach a
            deployment by accident - but anyone who can reach this page and knows the pair
            can rewrite the scoring table every projection is computed from.
          </AlertDescription>
        </Alert>
      ) : null}

      <SiteFooter />
    </div>
  )
}
