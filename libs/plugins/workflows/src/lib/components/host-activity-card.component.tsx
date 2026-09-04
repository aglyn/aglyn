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
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
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
  ceilingedWindow,
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
  header?: string
  /** When set, a "View all activity" link renders under the list (AGL-249). */
  viewAllHref?: string
  /** Overrides the default help affordance on the card header. */
  help?: HelpTipContent
}

/**
 * Rows fetched before the client-side sort and page slice.
 *
 * A CEILING, and the read asks for one document more than it so the card can
 * say when the window was not the whole story — `length >= WINDOW` is wrong at
 * exactly the collection size that equals the ceiling.
 */
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
 * Measured on a production host: 996 activity documents, so a 200-row window
 * covers the lexicographically-lowest ids and ends at `ClSZ…`. A screen whose
 * five entries have ids beginning `Y`, `h`, `j`, `k`, `t` has every one of
 * them past that boundary — the card fetches 200 rows, matches 0, and says
 * "No activity yet" about a page edited that morning.
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
 *
 * ## Why the "Show N more" expander became the shared footer
 *
 * It was a FOURTH pagination grammar for the same act — beside the `DataGrid`
 * footer, the shared `ListPagination`, and the "Load more" the DAM grid keeps —
 * and it escaped the guard that exists to stop exactly that, on spelling: the
 * check looks for the literal `'Load more'` and this button said
 * `Show ${more} more`.
 *
 * On its own terms it was also the weakest of the four. It only ever grew, so
 * a reader who opened forty rows could not get back to ten without remounting
 * the card; it offered no size control, which made it one of the two grammars
 * that never let a reader choose; it could not state a total even though every
 * row was already in hand; and it said nothing when `WINDOW` bit, so a busy
 * target read as though two hundred entries were all there were.
 *
 * The footer answers all four, and the rows stay a client SLICE — see `sorted`,
 * where paging is free because the window is already fetched.
 */
export function HostActivityCard(props: HostActivityCardProps) {
  const {
    hostId,
    targetId,
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
      // `WINDOW + 1` on both: the extra document is the PROBE, and it is what
      // turns "there may be more" into a fact the card can state. It is never
      // rendered — `ceilingedWindow` drops it below.
      return targetId
        ? query(base, where('target.id', '==', targetId), limit(WINDOW + 1))
        : query(base, orderBy('createdAt', 'desc'), limit(WINDOW + 1))
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
   * threw all but a page of them away — 190 documents paid for and discarded
   * on every render of this card. Showing more of what is already in hand
   * costs nothing; only running past `WINDOW` would cost a read, and the
   * "View all" link exists for that.
   *
   * Sorting is safe here in a way it is not on a server-paged list: these rows
   * are the whole window, not a slice of one.
   */
  const { rows: windowRows, truncated } = ceilingedWindow<any>(entries, WINDOW)
  const sorted = useMemo(
    () =>
      [...windowRows].sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      ),
    // `windowRows` is a fresh array each render; the snapshot behind it is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries],
  )
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  // Back to the first page when the card is pointed at a different subject —
  // otherwise a previous screen's page three opens the next one three pages
  // in, over a history that may not have three.
  useEffect(() => setPage(0), [targetId, hostId])
  const items = useMemo(
    () => sorted.slice(page * pageSize, page * pageSize + pageSize),
    [sorted, page, pageSize],
  )
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
      ) : sorted.length === 0 ? (
        /*
         * The WINDOW's length, not the page's. A page past the end of a
         * history that shrank while it was open holds no rows and is not an
         * empty history, and this card must never confuse the two.
         */
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
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={items.length}
            // The window the card HOLDS, which it knows exactly. `truncated`
            // below is what says the history is larger than that.
            count={sorted.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
          {truncated ? (
            <Typography variant="caption" color="text.secondary">
              {/*
               * Two different sentences because the two queries answer
               * differently. The un-targeted one carries `orderBy('createdAt')`
               * and its window really is the newest entries; the targeted one
               * has no `orderBy` — deliberately, so it needs no composite
               * index — so its window is a document-id SAMPLE of the target's
               * history, and calling it "most recent" would be the same lie
               * AGL-2292 was.
               */}
              {targetId
                ? `Showing ${WINDOW} entries for this item. It has more — ` +
                  'these are not necessarily the newest; open the full ' +
                  'activity log for the ordered history.'
                : `Showing this site’s ${WINDOW} most recent entries. There ` +
                  'is more history than that — open the full activity log to ' +
                  'read further back.'}
            </Typography>
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
