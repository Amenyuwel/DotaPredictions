import { Info } from "lucide-react"

/**
 * The model's own limits, next to the number they qualify.
 *
 * Required output, not decoration. Users cannot audit the engine, so anything
 * it knows it cannot see -- an emblem carrying a stat with no data, a duo with
 * forty joint games and a truncated ceiling -- has to travel with the answer.
 * In the panel, never in a footnote.
 */
export function Caveats({ items }: { items: string[] }) {
  if (items.length === 0) return null

  return (
    <section aria-label="Caveats" className="bg-muted/40 rounded-lg border p-4">
      <h3 className="font-heading mb-2 flex items-center gap-1.5 text-sm font-medium">
        <Info className="size-4" aria-hidden />
        What this answer cannot see
      </h3>
      <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
        {items.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </section>
  )
}
