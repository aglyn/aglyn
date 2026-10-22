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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert, Button, Stack } from '@mui/material'
import {
  collection,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { getDocsBounded, STALE_READ_NOTICE } from '@aglyn/tenant-feature-instance/hooks/firebase/firestore-bounded-read'
import NotificationsTable from '../../../../../components/notifications-table.component'
import { docsHelp } from '../../../../../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../../../../../constants/shared'
import useHostIndexEntries from '../../../../../hooks/use-host-index-entries'
import {
  markAllNotificationsReadFor,
  markNotificationRead,
} from '../../../../../hooks/use-notification-feed'
import { isNotificationRead } from '../../../../../utils/notification-feed'
import useOrgHosts from '../../../../../hooks/use-org-hosts'
import { useInviteReview } from '../../../../../hooks/use-pending-invites'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'
import {
  normalizeNotificationLink,
  resolveNotificationOrgSlug,
  resolveNotificationWorkspace,
} from '../../../../../utils/notification-links'
import {
  NOTIFICATION_FILTER_FIELDS,
  NOTIFICATION_FILTER_HEADERS,
  NOTIFICATION_FILTER_OPTIONS,
  NOTIFICATION_DEFAULT_SORT,
  planNotificationFilters,
} from '../../../../../utils/notification-filters'

/**
 * The notifications feed (AGL-260): the full, cursor-paginated list behind
 * the app-bar dropdown's "View all".
 *
 * The page chrome — the header, the breadcrumb and the section rail — belongs
 * to the sections layout beside it (AGL-3230), so this renders its card and
 * nothing around it.
 */
const ManageNotifications: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const router = useRouter()
  const { review: reviewInvite } = useInviteReview()
  const uid = (user as any)?.uid as string | undefined
  // Links are normalized when followed (AGL-644) — stored ones predate the
  // org-slug/subdomain routes and can't be migrated in place.
  const orgSlug = useOrgSlug()
  const { currentOrg, orgs } = useOrgScope()
  const { hosts } = useOrgHosts(firestore, uid, currentOrg?.$id ?? undefined)
  const [rows, setRows] = useState<any[]>([])
  // The console's shared default and shared menu (AGL-2501); this list used to
  // pick 25 for itself and offer no way to change it.
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  // `hostIndex` carries the owning org alongside the subdomain, so a
  // notification resolves its OWN workspace rather than the open one
  // (AGL-1773).
  const indexedHosts = useHostIndexEntries(
    useMemo(() => rows.map((row) => row.hostId), [rows]),
  )
  const [cursors, setCursors] = useState<QueryDocumentSnapshot[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  /**
   * The server did not answer in time and the page is the cache's
   * (AGL-3373). Said out loud, because the rows may be out of date.
   */
  const [stale, setStale] = useState(false)
  /** The last read failed outright, so an empty page is not "caught up". */
  const [failed, setFailed] = useState(false)
  /** Only the newest read may write the page; a filter change supersedes. */
  const requestRef = useRef(0)
  /*
   * Type and Status, served by the feed's query (AGL-3321). A new set of
   * clauses is a new feed, so the cursors of the old one are dropped and the
   * reader starts on its first page.
   */
  const gridFilter = useListGridFilter({ selectFields: ['type', 'readAt'] })
  /*
   * The header order (AGL-3680), on the same query: a new order is a new
   * feed too, so it starts again at page one.
   */
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(NOTIFICATION_DEFAULT_SORT)
  const filterPlan = useMemo(
    () => planNotificationFilters(gridFilter.clauses, askedSort),
    [gridFilter.clauses, askedSort],
  )
  const { wheres, orderBy: feedOrder } = filterPlan

  const loadPage = useCallback(
    async (targetPage: number, cursor?: QueryDocumentSnapshot) => {
      if (!uid) return
      const requestId = ++requestRef.current
      setLoading(true)
      /*
       * Bounded (AGL-3373). A bare `getDocs` waits for the server whenever
       * the client believes it is online, and when that belief is stale —
       * a multi-tab cache whose primary tab died — it never settles, so
       * `loading` never cleared and the table read "no matches" for ten
       * minutes. This settles from the cache after a few seconds, asks the
       * client to recover, and swaps in the server's page when it arrives.
       */
      const apply = (snapshot: QuerySnapshot) => {
        const docs = snapshot.docs.slice(0, pageSize)
        /*
         * `estimate` (AGL-3720): a row this client just marked read carries a
         * readAt at once, where a pending server timestamp reads as null and
         * left the row "New" until the write was acknowledged.
         */
        setRows(
          docs.map((entry) => ({
            $id: entry.id,
            ...entry.data({ serverTimestamps: 'estimate' }),
          })),
        )
        setHasMore(snapshot.docs.length > pageSize)
        setPage(targetPage)
        setCursors((previous) => {
          const next = previous.slice(0, targetPage)
          const last = docs[docs.length - 1]
          if (last) next[targetPage] = last
          return next
        })
      }
      try {
        const read = await getDocsBounded(
          query(
            collection(firestore, 'users', uid, 'notifications'),
            ...wheres.map(([path, op, value]) => where(path, op, value)),
            orderBy(feedOrder.path, feedOrder.direction),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(pageSize + 1),
          ),
        )
        if (requestRef.current !== requestId) return
        apply(read.snapshot)
        setStale(read.stale)
        setFailed(false)
        void read.fresh?.then((fresh) => {
          if (!fresh || requestRef.current !== requestId) return
          apply(fresh)
          setStale(false)
        })
      } catch (error) {
        console.error(error)
        if (requestRef.current !== requestId) return
        setFailed(true)
        setStale(false)
      } finally {
        if (requestRef.current === requestId) setLoading(false)
      }
    },
    [firestore, uid, pageSize, wheres, feedOrder],
  )

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  /*
   * A row read here reads as read AT ONCE (AGL-3720). Mark read needed two
   * presses: the first wrote `readAt: serverTimestamp()` without waiting and
   * re-read the page, where the pending timestamp reads back as null — so the
   * row stayed "New" until the second press found the first one landed. The
   * row now flips locally and the table reads `read` before `readAt`.
   */
  const markRowsRead = useCallback((ids: ReadonlySet<string> | 'all') => {
    setRows((current) =>
      current.map((row) =>
        (ids === 'all' || ids.has(row.$id)) && !isNotificationRead(row)
          ? { ...row, read: true, readAt: row.readAt ?? { toDate: () => new Date() } }
          : row,
      ),
    )
  }, [])

  // Mark EVERY unread read (AGL-267, AGL-3720): the whole `read == false`
  // query in batches of 500, not the newest 200.
  const [markingAll, setMarkingAll] = useState(false)
  const handleMarkAllRead = async () => {
    if (!uid || markingAll) return
    setMarkingAll(true)
    markRowsRead('all')
    try {
      await markAllNotificationsReadFor(firestore, uid)
      await loadPage(page, cursors[page - 1])
    } catch (error) {
      console.error(error)
    } finally {
      setMarkingAll(false)
    }
  }

  /**
   * Which workspace a row is ABOUT, for the feed's column (AGL-3249).
   *
   * The same two sources the link rewrite walks, and deliberately NOT its
   * third: `resolveNotificationWorkspace` refuses to fall back to the open
   * workspace, so a row that recorded no org reads as unattributed instead of
   * borrowing whichever one happens to be selected.
   *
   * `orgName` comes off the membership row the console already holds, so the
   * column costs no read of its own.
   */
  const workspaceOf = useCallback(
    (notification: any) =>
      resolveNotificationWorkspace(notification, {
        nameForOrgId: (orgId) => {
          const org = (orgs ?? []).find((entry) => entry.$id === orgId)
          return org?.orgName ?? org?.slug
        },
        indexedOrgId: notification.hostId
          ? indexedHosts.get(notification.hostId)?.orgId
          : undefined,
      }),
    [orgs, indexedHosts],
  )

  const handleOpen = (notification: any) => {
    if (!uid) return
    if (!isNotificationRead(notification)) {
      markRowsRead(new Set([notification.$id]))
      void markNotificationRead(firestore, uid, notification.$id).catch(
        console.error,
      )
    }
    // The invitee's own invitation opens the accept/decline dialog
    // (AGL-3402), as it does from the bell.
    if (notification.inviteId && notification.orgId) {
      reviewInvite({
        orgId: notification.orgId,
        inviteId: notification.inviteId,
      })
      return
    }
    const target = normalizeNotificationLink(notification.link, {
      // The notification's own org, not the one currently open (AGL-644).
      // Host notifications carry no `orgId` of their own before AGL-1773, so
      // `hostIndex` answers for the whole stored backlog.
      orgSlug: resolveNotificationOrgSlug(notification, {
        slugForOrgId: (orgId) =>
          (orgs ?? []).find((org) => org.$id === orgId)?.slug,
        indexedOrgId: notification.hostId
          ? indexedHosts.get(notification.hostId)?.orgId
          : undefined,
        currentOrgSlug: orgSlug,
      }),
      hostId: notification.hostId,
      // `hosts` only covers the org currently open; hostIndex covers the
      // rest, so cross-org notifications resolve too (AGL-672).
      hostSubdomain: notification.hostId
        ? ((hosts ?? []).find((host) => host.$id === notification.hostId)
            ?.subdomain ?? indexedHosts.get(notification.hostId)?.subdomain)
        : undefined,
    })
    if (target) void router.push(target)
  }

  return (
    <CardDisplay
      header={'All notifications'}
      help={docsHelp('consoleTour', { anchor: '#all-notifications' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        <Stack
          useFlexGap
          direction="row"
          spacing={1}
          sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}
        >
          <Button
            size="small"
            color="primary"
            disabled={markingAll}
            onClick={() => void handleMarkAllRead()}
          >
            {markingAll ? 'Marking…' : 'Mark all read'}
          </Button>
        </Stack>
        {stale ? <Alert severity="warning">{STALE_READ_NOTICE}</Alert> : null}
        {failed && !stale ? (
          <Alert severity="error">
            {"Notifications couldn't be loaded. Check your connection and reload the page."}
          </Alert>
        ) : null}
        <ListQueryNotices
          refused={listQueryRefusals(filterPlan.refused, {
            fields: NOTIFICATION_FILTER_FIELDS,
            headers: NOTIFICATION_FILTER_HEADERS,
            options: NOTIFICATION_FILTER_OPTIONS,
          })}
          notices={filterPlan.notices}
        />
        <NotificationsTable
          rows={rows}
          onOpen={handleOpen}
          workspaceOf={workspaceOf}
          page={page}
          pageSize={pageSize}
          hasMore={hasMore}
          loading={loading}
          failed={failed}
          // `cursors[i]` is the LAST row of page i, so page i+1 resumes
          // after `cursors[i]` and page i resumes after `cursors[i - 1]`.
          onPageChange={(next) =>
            void loadPage(next, next > page ? cursors[page] : cursors[next - 1])
          }
          onPageSizeChange={setPageSize}
          gridFilter={gridFilter}
          sort={askedSort}
          onSortChange={setAskedSort}
          orderBy={feedOrder}
        />
      </Stack>
    </CardDisplay>
  )
}
ManageNotifications.displayName = 'Page:ManageNotifications'

export default ManageNotifications
