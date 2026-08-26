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

import { AppLink, CardDisplay, type HelpTipContent } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Button,
  Link,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  activityHref,
  activityPrimaryText,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { pluginDocsHelp } from '@aglyn/aglyn'

export interface HostActivityCardProps {
  hostId: string
  /** Show only entries for this target id (e.g. a screen detail page). */
  targetId?: string
  /** Entries rendered after filtering/sorting. */
  max?: number
  header?: string
  /** When set, a "View all activity" link renders under the list (AGL-249). */
  viewAllHref?: string
  /** Overrides the default help affordance on the card header. */
  help?: HelpTipContent
}

/** Rows fetched before the client-side sort/slice. */
const WINDOW = 200

/**
 * Recent user activity (AGL-118): newest-first feed from
 * `hosts/{hostId}/activity`, optionally filtered to one target so detail
 * pages show just their own history.
 *
 * ## The "Page Activity" card reported nothing on a page that had changed
 *
 * This is AGL-2292 — fixed in the sibling `OrgActivityCard`, never applied
 * here. The query was `limit(200)` with NO `orderBy`. Firestore then returns
 * documents in DOCUMENT-ID order, `useHostActivityLogger` appends with
 * `addDoc()`, so the ids are effectively random: the window was a
 * pseudo-random SAMPLE of the collection rather than its newest page, and the
 * client sort below dutifully ordered that sample and sliced the top off it —
 * which made the result look right and be wrong.
 *
 * Measured on the production host that reported the bug: 996 activity
 * documents, so the window covered the ~200 lexicographically-lowest ids and
 * ended at `ClSZ…`. The screen Zach was looking at had FIVE real entries, ids
 * beginning `Y`, `h`, `j`, `k`, `t` — every one of them past the boundary. The
 * card fetched 200 rows, matched 0, and said "No activity yet" about a page
 * whose SEO had been changed that morning.
 *
 * ## Why the targeted query filters SERVER-side
 *
 * Adding `orderBy` alone is not the fix here, and the difference only shows up
 * on the per-target card. The window is host-wide, so 200 newest host-wide
 * entries still have to contain the target's own. On that same host it would
 * have surfaced 1 of the screen's 5 entries, and 40 of the 108 targets with
 * real activity would STILL have rendered "No activity yet" — a quieter
 * version of the same lie. A target that has not been touched recently is
 * exactly the one whose history you open the card to read.
 *
 * So `targetId` becomes a `where` and spends the window on the target instead
 * of on the host. That predicate needs no new index: an equality filter with
 * no `orderBy` is served by the automatic single-field index, which is
 * deliberate — a composite (`target.id` ASC, `createdAt` DESC) would be
 * FILE-ONLY until someone ran `firebase deploy --only firestore:indexes` by
 * hand, and every read in between would throw `failed-precondition`. The
 * ordering is done by the client sort below, which is safe at this size: the
 * busiest target in production holds 55 entries against a 200-row window.
 *
 * The un-targeted (dashboard) query has no such excuse and takes the AGL-2292
 * one-liner: `orderBy('createdAt', 'desc')`, single-field, no config change.
 *
 * ## "Found nothing" vs "could not look"
 *
 * Both used to render the empty state, and so did the first paint before any
 * snapshot arrived. A refused or failed listen now says so and offers a retry
 * (the `used-by-card` shape), because an audit feed that invents a confident
 * zero is worse than one that admits it is blind.
 */
export function HostActivityCard(props: HostActivityCardProps) {
  const {
    hostId,
    targetId,
    max = 20,
    header = 'Recent Activity',
    viewAllHref,
    help = pluginDocsHelp('consoleTour', {
      anchor: '#a-sites-dashboard',
      excerpt:
        'Changes made to this site from the console — publishes, media ' +
        'saves, member changes — newest first.',
    }),
  } = props
  const { orgSlug, host } = useParams<{ orgSlug: string; host: string }>()
  const firestore = useFirestore()
  const [attempt, setAttempt] = useState(0)
  const { data: entries, status } = useFirestoreCollection<any>(
    () => {
      // `strictNullChecks` is off repo-wide, so an absent hostId would reach
      // `collection()` as a falsy path segment. Refuse to build the query
      // instead, and report it as unreadable below — never as "no activity".
      if (!hostId) return null
      const base = collection(firestore, 'hosts', hostId, 'activity')
      return targetId
        ? query(base, where('target.id', '==', targetId), limit(WINDOW))
        : query(base, orderBy('createdAt', 'desc'), limit(WINDOW))
    },
    [firestore, hostId, targetId, attempt],
    { idField: '$id' },
  )
  /*
   * The client sort survives the server-side ordering rather than being
   * replaced by it. It is what orders the TARGETED query (which cannot carry
   * an `orderBy` without a composite index — see above), and on the
   * un-targeted one it still catches a just-written entry whose timestamp the
   * local snapshot has not resolved. Sorting 200 items costs nothing.
   */
  /**
   * Paging is FREE here, which is why it is a slice and not a second query
   * (AGL-2486). The read above already fetches `WINDOW` rows and this then
   * threw all but `max` of them away — 180 documents paid for and discarded
   * on every render of this card. Showing more of what is already in hand
   * costs nothing; only running past `WINDOW` would cost a read, and the
   * "View all" link exists for that.
   */
  const sorted = useMemo(
    () =>
      [...(entries ?? [])].sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      ),
    [entries],
  )
  const [shown, setShown] = useState(max)
  // Re-collapse when the card is pointed at a different target, or the page
  // that mounts it asks for a different page size — otherwise a previous
  // screen's "show more" silently sets the size for the next one.
  useEffect(() => setShown(max), [max, targetId, hostId])
  const items = useMemo(() => sorted.slice(0, shown), [sorted, shown])
  const more = Math.min(sorted.length - shown, max)
  // Three states, not two: a read that never happened must not be reported as
  // an empty history.
  const unreadable = status === 'error' || !hostId

  return (
    <CardDisplay
      header={header}
      help={help}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {unreadable ? (
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Alert severity="warning" sx={{ width: '100%' }}>
            {'Could not read the activity log. This is NOT the same as ' +
              'nothing having happened — do not treat this as a record ' +
              'that the page is unchanged.'}
          </Alert>
          <Button size="small" onClick={() => setAttempt((n) => n + 1)}>
            {'Try again'}
          </Button>
        </Stack>
      ) : status === 'loading' ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading activity…'}
        </Typography>
      ) : items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No activity yet — changes made in the console appear here.'}
        </Typography>
      ) : (
        <>
          <List dense disablePadding>
            {items.map((entry) => {
              const href = activityHref(entry, { orgSlug, host })
              const label = activityPrimaryText(entry)
              return (
                <ListItem key={entry.$id} disableGutters dense>
                  <ListItemText
                    primary={
                      href ? (
                        <AppLink href={href} color="inherit" underline="hover">
                          {label}
                        </AppLink>
                      ) : (
                        label
                      )
                    }
                    secondary={
                      `${entry.actorEmail ?? 'Someone'} · ${
                        entry.createdAt?.toDate?.().toLocaleString() ?? ''
                      }` +
                      // Run-log entries carry duration (wave v6).
                      (entry.durationMs != null
                        ? ` · ${entry.durationMs}ms`
                        : '')
                    }
                    slotProps={
                      entry.status === 'error'
                        ? { primary: { color: 'error' } }
                        : undefined
                    }
                  />
                </ListItem>
              )
            })}
          </List>
          {/* Free paging: these rows are already fetched — see `sorted`. */}
          {more > 0 ? (
            <Button
              size="small"
              onClick={() => setShown((count) => count + max)}
              sx={{ alignSelf: 'flex-start', mt: 1 }}
            >
              {`Show ${more} more`}
            </Button>
          ) : null}
        </>
      )}
      {viewAllHref ? (
        <Typography variant="body2" sx={{ mt: 1 }}>
          <Link href={viewAllHref} color="primary" underline="hover">
            {'View all activity'}
          </Link>
        </Typography>
      ) : null}
    </CardDisplay>
  )
}
HostActivityCard.displayName = 'HostActivityCard'

export default HostActivityCard
