/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use client'

import { Stack, Typography } from '@mui/material'

/**
 * One thread's posts, for BOTH Support channels (AGL-1158).
 *
 * Splitting tickets and the forum into separate pages would otherwise fork
 * this rendering in two, and the halves would drift: they already differ in
 * ways that are accidental rather than meaningful — the ticket thread labels
 * its own messages "You" while the forum names every author, and only the
 * forum showed a staff badge on the opening post. Both are the same object,
 * an authored post with a time, so both render here.
 *
 * The one REAL difference is kept as a prop: a ticket is a private
 * conversation with Aglyn, where "who sent this" is only ever you or staff,
 * so naming yourself on your own message is noise. A forum thread is public
 * to subscribers and every name matters.
 */

export interface SupportPost {
  $id?: string
  authorName?: string
  staff?: boolean
  body?: string
  createdAt?: number | null
}

export interface SupportMessagesProps {
  posts: readonly SupportPost[]
  /**
   * Render the caller's own posts as "You" rather than by name.
   *
   * True for tickets (a two-party thread), false for the forum. Deliberately
   * a prop rather than a lookup of the signed-in uid: the tickets payload has
   * never carried author names, so there is nothing to fall back to there,
   * and the forum has never carried the flag.
   */
  anonymizeSelf?: boolean
}

/**
 * `null`/`0` renders as no time at all, never as 1 January 1970.
 *
 * The type check is not paranoia and not decoration: these payloads are `any`
 * off the wire, `strictNullChecks` is off repo-wide, and a Firestore timestamp
 * that was never converted arrives as `{_seconds, _nanoseconds}` — truthy, and
 * `new Date(object)` renders the literal string "Invalid Date" at the user.
 * Anything that is not a finite number has no time to show.
 */
export function formatWhen(ms: unknown): string {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toLocaleString()
    : ''
}

/** The byline: who wrote it, whether they are staff, and when. */
export function postByline(
  post: SupportPost,
  anonymizeSelf: boolean | undefined,
): string {
  const who = anonymizeSelf
    ? post.staff
      ? 'Aglyn staff'
      : 'You'
    : `${post.authorName ?? 'member'}${post.staff ? ' · Aglyn staff' : ''}`
  const when = formatWhen(post.createdAt)
  return when ? `${who} · ${when}` : who
}

export function SupportMessages(props: SupportMessagesProps) {
  const { posts, anonymizeSelf } = props
  return (
    <>
      {posts.map((post, index) => (
        <Stack key={post.$id ?? index} spacing={0.25}>
          <Typography variant="caption" color="text.secondary">
            {postByline(post, anonymizeSelf)}
          </Typography>
          {/* `pre-wrap` because the body is plain text typed into a textarea —
              paragraph breaks are the only formatting it has. */}
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {post.body}
          </Typography>
        </Stack>
      ))}
    </>
  )
}
SupportMessages.displayName = 'SupportMessages'

export default SupportMessages
