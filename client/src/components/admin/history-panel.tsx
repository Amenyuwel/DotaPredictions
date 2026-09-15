import { useQuery } from "@tanstack/react-query"
import { History } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loading } from "@/components/ui/spinner"
import { getHistory } from "@/lib/admin-api"

/**
 * Every published version, newest first.
 *
 * The list is append-only and the documents behind it are immutable, so this is
 * a record of decisions in order rather than a stack that can be rewound.
 * "Load" puts an old document into the DRAFT: it can then be read against the
 * run currently being served before anyone commits to it, and making it live
 * afterwards mints a NEW version with its own note and author.
 *
 * That is slower than a one-click rollback, on purpose. A configuration that
 * was correct three weeks ago is not automatically correct against this week's
 * run -- the roster moves, the sample columns move -- and a rollback that
 * skipped the check would be the same silent mistake in the other direction.
 */
export function HistoryPanel({
  tournamentId,
  stage,
  currentVersion,
  onLoad,
}: {
  tournamentId: string
  stage: string
  currentVersion: number | null
  onLoad: (version: number) => void
}) {
  const query = useQuery({
    queryKey: ["admin-history", tournamentId, stage],
    queryFn: () => getHistory(tournamentId, stage),
    staleTime: 0,
    retry: false,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History aria-hidden className="size-4" />
          History
        </CardTitle>
        <p className="text-muted-foreground mt-1 text-xs">
          Loading a version puts it in the draft, where it can be checked against the run
          being served now. Publishing it from there creates a new version rather than
          rewinding to the old one.
        </p>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Loading>Reading the version history…</Loading>
        ) : query.error ? (
          <p className="text-destructive text-sm">Could not read the history.</p>
        ) : query.data && query.data.versions.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>By</TableHead>
                <TableHead>When</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.versions.map((version) => (
                <TableRow key={version.version}>
                  <TableCell className="whitespace-nowrap">
                    v{version.version}
                    {version.version === currentVersion ? (
                      <Badge className="ml-1.5">live</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-96">{version.note}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {version.authorEmail || "unknown"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(version.publishedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => onLoad(version.version)}
                    >
                      Load into draft
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">
            Nothing published yet for this stage. The run is being served exactly as the
            engine made it.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
