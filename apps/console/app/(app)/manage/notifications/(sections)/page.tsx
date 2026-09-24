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
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Button, Stack } from '@mui/material'
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import NotificationsTable from '../../../../../components/notifications-table.component'
import { docsHelp } from '../../../../../constants/docs-links'
import { TABLE_PAGE_SIZE_DEFAULT } from '../../../../../constants/shared'
import useHostIndexEntries from '../../../../../hooks/use-host-index-entries'
import useOrgHosts from '../../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'
import {
  normalizeNotificationLink,
  resolveNotificationOrgSlug,
  resolveNotificationWorkspace,
} from '../../../../../utils/notification-links'
import { notificationFilterWheres } from '../../../../../utils/notification-filters'

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
  /*
   * Type and Status, served by the feed's query (AGL-3321). A new set of
   * clauses is a new feed, so the cursors of the old one are dropped and the
   * reader starts on its first page.
   */
  const gridFilter = useListGridFilter({ selectFields: ['type', 'readAt'] })
  const wheres = useMemo(
    () => notificationFilterWheres(gridFilter.clauses),
    [gridFilter.clauses],
  )

  const loadPage = useCallback(
    async (targetPage: number, cursor?: QueryDocumentSnapshot) => {
      if (!uid) return
      setLoading(true)
      try {
        const snapshot = await getDocs(
          query(
            collection(firestore, 'users', uid, 'notifications'),
            ...wheres.map(([path, op, value]) => where(path, op, value)),
            orderBy('createdAt', 'desc'),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(pageSize + 1),
          ),
        )
        const docs = snapshot.docs.slice(0, pageSize)
        setRows(docs.map((entry) => ({ $id: entry.id, ...entry.data() })))
        setHasMore(snapshot.docs.length > pageSize)
        setPage(targetPage)
        setCursors((previous) => {
          const next = previous.slice(0, targetPage)
          const last = docs[docs.length - 1]
          if (last) next[targetPage] = last
          return next
        })
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    },
    [firestore, uid, pageSize, wheres],
  )

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  // Mark ALL unread read (AGL-267): the latest 200, batched.
  const [markingAll, setMarkingAll] = useState(false)
  const handleMarkAllRead = async () => {
    if (!uid || markingAll) return
    setMarkingAll(true)
    try {
      const snapshot = await getDocs(
        query(
          collection(firestore, 'users', uid, 'notifications'),
          orderBy('createdAt', 'desc'),
          limit(200),
        ),
      )
      const batch = writeBatch(firestore)
      let count = 0
      snapshot.forEach((entry) => {
        if (!entry.get('readAt')) {
          batch.update(entry.ref, { read: true, readAt: serverTimestamp() })
          count += 1
        }
      })
      if (count > 0) await batch.commit()
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
    if (!notification.readAt) {
      void updateDoc(
        doc(firestore, 'users', uid, 'notifications', notification.$id),
        { read: true, readAt: serverTimestamp() },
      ).catch(console.error)
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
      help={docsHelp('consoleTour', {
        anchor: '#workspace-settings--notifications',
        excerpt:
          'Every console notification, newest first. What arrives here, ' +
          'and what also reaches your inbox, is set in Notification ' +
          'settings.',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        <Stack
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
        <NotificationsTable
          rows={rows}
          onOpen={handleOpen}
          workspaceOf={workspaceOf}
          page={page}
          pageSize={pageSize}
          hasMore={hasMore}
          loading={loading}
          // `cursors[i]` is the LAST row of page i, so page i+1 resumes
          // after `cursors[i]` and page i resumes after `cursors[i - 1]`.
          onPageChange={(next) =>
            void loadPage(next, next > page ? cursors[page] : cursors[next - 1])
          }
          onPageSizeChange={setPageSize}
          gridFilter={gridFilter}
        />
      </Stack>
    </CardDisplay>
  )
}
ManageNotifications.displayName = 'Page:ManageNotifications'

export default ManageNotifications
