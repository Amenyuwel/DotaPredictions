/**
 * What a list of overlapping intervals is allowed to say about itself.
 *
 * Both directions of the tool rank something — units through a fixed banner,
 * banners for a fixed unit — and both hit the same wall: on this evidence the
 * top few usually cannot be separated. The sentence is here once so the two
 * lists cannot end up describing that differently, because a reader who sees
 * "tied" on one screen and a confident 1-2-3 on the other would reasonably
 * conclude the second screen knows more.
 */
export function TieNote({ tied }: { tied: number }) {
  if (tied === 0) return null
  return (
    <p className="text-muted-foreground text-sm">
      {tied + 1} results cannot be separated at this sample size. They are shown as tied,
      in no meaningful order.
    </p>
  )
}
