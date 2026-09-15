import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  discardDraft,
  getAdminConfig,
  publishDraft,
  revertTo,
  saveDraft,
} from "@/lib/admin-api"
import type { AdminConfig, ConfigOverlay } from "@/types/admin"

/**
 * The draft being edited, and the four things that can happen to it.
 *
 * The document lives in this hook rather than in the server's copy of it,
 * because editing is a sequence of small changes and a round trip per keystroke
 * would make the form unusable. What that buys has to be paid for somewhere, so
 * two rules hold it together:
 *
 *   - The PREVIEW is never computed here. What an overlay does is decided by
 *     `applyOverlay` on the server, and a browser-side approximation of it would
 *     be a second implementation of the thing whose correctness is the entire
 *     point. So a save is what refreshes the preview, and an unsaved document is
 *     shown as unsaved rather than as validated.
 *   - Publishing always publishes the SAVED draft, never what is on screen. The
 *     button is disabled while there are unsaved edits, so "publish" cannot mean
 *     a document nobody has checked.
 */

const EMPTY: ConfigOverlay = { schemaVersion: 1 }

export interface DraftState {
  config: AdminConfig | undefined
  isLoading: boolean
  error: unknown
  /** The document as edited here. */
  doc: ConfigOverlay
  setDoc: (next: ConfigOverlay) => void
  /** Edits that have not been saved, and therefore have not been checked. */
  dirty: boolean
  note: string
  setNote: (note: string) => void
  save: () => void
  publish: (note: string) => void
  discard: () => void
  loadVersion: (version: number) => void
  saving: boolean
  publishing: boolean
  /** The last thing that failed, for the one place that renders it. */
  actionError: unknown
  lastSavedAt: string | null
}

export function useDraft(tournamentId?: string, stage?: string): DraftState {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ["admin-config", tournamentId ?? "latest", stage ?? "latest"],
    queryFn: () => getAdminConfig(tournamentId, stage),
    // Nothing about this is cacheable: it is the editing surface for a value
    // somebody else may be editing too, and a stale form is how two admins
    // overwrite each other while both believe they are looking at reality.
    staleTime: 0,
    retry: false,
  })

  const [doc, setDocState] = useState<ConfigOverlay>(EMPTY)
  const [note, setNote] = useState("")
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)

  // Which scope the local document belongs to. Without this, switching stage
  // carries one stage's edits into the other's form -- and they would look like
  // edits somebody made to THAT stage.
  const loadedScope = useRef<string | null>(null)
  const scopeKey = query.data ? `${query.data.scope.tournamentId}/${query.data.scope.stage}` : null

  useEffect(() => {
    if (!query.data || !scopeKey) return
    if (loadedScope.current === scopeKey) return
    loadedScope.current = scopeKey
    setDocState(query.data.draft?.doc ?? EMPTY)
    setNote(query.data.draft?.note ?? "")
    setDirty(false)
    setLastSavedAt(query.data.draft?.updatedAt ?? null)
  }, [query.data, scopeKey])

  const setDoc = useCallback((next: ConfigOverlay) => {
    setDocState(next)
    setDirty(true)
  }, [])

  const scope = useMemo(
    () => ({
      tournamentId: query.data?.scope.tournamentId ?? "",
      stage: query.data?.scope.stage ?? "",
    }),
    [query.data],
  )

  const saveMutation = useMutation({
    mutationFn: () => saveDraft({ ...scope, doc, note }),
    onSuccess: (result) => {
      setDirty(false)
      setLastSavedAt(result.savedAt)
      // The preview comes back with the save and is the authoritative one, so
      // the cached config is patched rather than refetched: a second round trip
      // would only re-derive what this response already carries.
      queryClient.setQueryData<AdminConfig>(
        ["admin-config", tournamentId ?? "latest", stage ?? "latest"],
        (old) =>
          old
            ? {
                ...old,
                draft: { doc, note, updatedAt: result.savedAt, authorEmail: old.draft?.authorEmail ?? "" },
                preview: result.preview,
              }
            : old,
      )
    },
  })

  const publishMutation = useMutation({
    mutationFn: (publishNote: string) => publishDraft({ ...scope, note: publishNote }),
    onSuccess: () => {
      // A publish changes what the PUBLIC page is being served, so everything
      // the browser holds about a run is now potentially describing the
      // previous configuration.
      void queryClient.invalidateQueries({ queryKey: ["admin-config"] })
      void queryClient.invalidateQueries({ queryKey: ["admin-history"] })
      void queryClient.invalidateQueries({ queryKey: ["run"] })
    },
  })

  const discardMutation = useMutation({
    mutationFn: () => discardDraft(scope),
    onSuccess: () => {
      setDocState(EMPTY)
      setNote("")
      setDirty(false)
      setLastSavedAt(null)
      void queryClient.invalidateQueries({ queryKey: ["admin-config"] })
    },
  })

  const revertMutation = useMutation({
    mutationFn: (version: number) => revertTo({ ...scope, version }),
    onSuccess: (result, version) => {
      // Lands in the editor rather than going live. Publishing it afterwards is
      // what makes it real, and that mints a new version with its own note.
      loadedScope.current = null
      setNote(`Loaded from version ${version}`)
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: ["admin-config"] })
      void result
    },
  })

  return {
    config: query.data,
    isLoading: query.isLoading,
    error: query.error,
    doc,
    setDoc,
    dirty,
    note,
    setNote,
    save: () => saveMutation.mutate(),
    publish: (publishNote: string) => publishMutation.mutate(publishNote),
    discard: () => discardMutation.mutate(),
    loadVersion: (version: number) => revertMutation.mutate(version),
    saving: saveMutation.isPending,
    publishing: publishMutation.isPending,
    actionError:
      saveMutation.error ?? publishMutation.error ?? discardMutation.error ?? revertMutation.error,
    lastSavedAt,
  }
}
