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

import {
  NOTIFICATION_TYPE_LABELS,
  type AglynNotification,
} from '@aglyn/aglyn'
import {
  mdiBellOutline,
  mdiCheckAll,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useNotificationAlertPrefs from '../hooks/use-notification-prefs'
import useOrgHosts from '../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../hooks/use-org-scope'
import {
  playNotificationChime,
  showDesktopNotification,
  unreadBadge,
} from '../utils/notification-alerts'
import { normalizeNotificationLink } from '../utils/notification-links'

/**
 * App-bar notifications dropdown (AGL-260): unread badge over the 10 most
 * recent notifications, mark-read on click / mark-all, and a "view all"
 * link to the paginated page.
 */
export function NotificationsMenu() {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const router = useRouter()
  const uid = (user as any)?.uid as string | undefined
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  // Stored links predate the org-slug/subdomain routes (AGL-644), so they are
  // normalized when followed. Resolving a host's subdomain needs the current
  // org's sites; a notification for another org simply won't resolve and the
  // link degrades to its stored value rather than a wrong destination.
  const orgSlug = useOrgSlug()
  const { currentOrg, orgs } = useOrgScope()
  const { hosts } = useOrgHosts(firestore, uid, currentOrg?.$id ?? undefined)
  const subdomainByHostId = useMemo(() => {
    const map = new Map<string, string>()
    for (const host of hosts ?? []) {
      const subdomain = (host as { subdomain?: string }).subdomain
      if (subdomain) map.set(host.$id, subdomain)
    }
    return map
  }, [hosts])
  // Resolve against the notification's OWN org, not the one currently open —
  // otherwise a billing alert for org A, clicked while viewing org B, would
  // rewrite to org B's billing page.
  const slugByOrgId = useMemo(() => {
    const map = new Map<string, string>()
    for (const org of orgs ?? []) {
      if (org.slug) map.set(org.$id, org.slug)
    }
    return map
  }, [orgs])

  const { data: recent } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'users', uid ?? '-none-', 'notifications'),
        orderBy('createdAt', 'desc'),
        limit(10),
      ),
    [firestore, uid],
    { idField: '$id' },
  )
  const { data: unreadDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'users', uid ?? '-none-', 'notifications'),
        where('readAt', '==', null),
        limit(100),
      ),
    [firestore, uid],
    { idField: '$id' },
  )
  // Emitters omit readAt entirely, and Firestore can't query for a
  // missing field — count unread from the recent window instead when the
  // null-query comes back empty.
  const unreadCount = useMemo(() => {
    const explicit = unreadDocs?.length ?? 0
    const implicit = (recent ?? []).filter((item) => !item.readAt).length
    return Math.max(explicit, implicit)
  }, [unreadDocs, recent])

  // ---- Alerts (AGL-650): sound, desktop notification, tab badge ----------
  const [alertPrefs] = useNotificationAlertPrefs()

  const resolveLink = useCallback(
    (notification: AglynNotification) =>
      normalizeNotificationLink(notification.link, {
        orgSlug:
          (notification.orgId ? slugByOrgId.get(notification.orgId) : null) ??
          orgSlug,
        hostId: notification.hostId,
        hostSubdomain: notification.hostId
          ? subdomainByHostId.get(notification.hostId)
          : undefined,
      }),
    [orgSlug, slugByOrgId, subdomainByHostId],
  )

  // Detect arrivals by DIFFING DOCUMENT IDS, not by watching the count.
  // Two traps make the count useless as a trigger: emitters never write
  // `readAt`, so the unread figure is only an approximation of a 10-doc
  // window; and `useFirestoreCollection` clears `data` to [] on every dep
  // change, so the count legitimately drops to 0 and back on re-subscribe.
  // Keyed on ids, a re-subscribe is a no-op.
  const seenIdsRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    const list = (recent ?? []) as Array<AglynNotification & { $id: string }>
    // An empty snapshot is the hook resetting, never a real state — ignoring
    // it also stops a re-subscribe from re-alerting the whole window.
    if (list.length === 0) return
    const ids = new Set(list.map((item) => item.$id))
    if (seenIdsRef.current === null) {
      // First real snapshot: everything in it predates this session.
      seenIdsRef.current = ids
      return
    }
    const arrived = list.filter(
      (item) => !seenIdsRef.current?.has(item.$id) && !item.readAt,
    )
    seenIdsRef.current = ids
    if (arrived.length === 0) return

    if (alertPrefs.sound) playNotificationChime()
    if (alertPrefs.desktop) {
      // One notification for a burst — a batch write (an org-wide broadcast,
      // say) should not stack N toasts.
      const [newest] = arrived
      const extra = arrived.length - 1
      showDesktopNotification({
        title: newest.title,
        body:
          extra > 0
            ? `${newest.body ?? ''}${newest.body ? ' ' : ''}(+${extra} more)`
            : newest.body,
        tag: newest.$id,
        onActivate: () => {
          const target = resolveLink(newest)
          if (target) router.push(target)
        },
      })
    }
  }, [recent, alertPrefs.sound, alertPrefs.desktop, resolveLink, router])

  // Unread badge in the tab title.
  //
  // This writes `document.title` directly and re-applies under a
  // MutationObserver. The obvious route — the shared page-title controller —
  // does nothing here: it renders through `next/head`, which is inert in the
  // App Router, so the console's title is fixed by static metadata (it never
  // changes per page today). Next also rewrites the title on navigation, so a
  // one-shot write would be dropped; observing the head catches that whether
  // Next mutates the <title> node or replaces it.
  //
  // `apply` is idempotent and strips any existing badge first, so reacting to
  // our own write neither loops nor compounds `(1) (1) …`.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const badge = alertPrefs.tabBadge ? unreadBadge(unreadCount) : ''
    const apply = () => {
      const base = document.title.replace(/^\(\d+\+?\)\s+/, '')
      const next = badge ? `${badge} ${base}` : base
      if (document.title !== next) document.title = next
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => {
      observer.disconnect()
      document.title = document.title.replace(/^\(\d+\+?\)\s+/, '')
    }
  }, [unreadCount, alertPrefs.tabBadge])

  if (!uid) return null

  const markRead = (notification: AglynNotification & { $id: string }) => {
    void updateDoc(
      doc(firestore, 'users', uid, 'notifications', notification.$id),
      { readAt: serverTimestamp() },
    ).catch(console.error)
  }

  const handleOpenItem = (
    notification: AglynNotification & { $id: string },
  ) => {
    if (!notification.readAt) markRead(notification)
    setAnchor(null)
    const target = resolveLink(notification)
    if (target) void router.push(target)
  }

  const handleMarkAll = () => {
    for (const notification of recent ?? []) {
      if (!notification.readAt) markRead(notification)
    }
  }

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          color="inherit"
          aria-label="notifications"
          onClick={(event) => setAnchor(event.currentTarget)}
        >
          <Badge
            color="secondary"
            badgeContent={unreadCount > 99 ? '99+' : unreadCount}
            invisible={unreadCount === 0}
          >
            <MdiIcon path={mdiBellOutline.path} />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { width: 360, maxWidth: '90vw' } } }}
      >
        <Stack
          direction="row"
          sx={{ px: 2, py: 0.5, alignItems: 'center' }}
        >
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {'Notifications'}
          </Typography>
          <Tooltip title="Mark all read">
            <IconButton
              size="small"
              onClick={handleMarkAll}
              disabled={unreadCount === 0}
            >
              <MdiIcon path={mdiCheckAll.path} sx={{ fontSize: '1rem' }} />
            </IconButton>
          </Tooltip>
        </Stack>
        <Divider />
        {(recent ?? []).length === 0 ? (
          <Box sx={{ px: 2, py: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {"You're all caught up."}
            </Typography>
          </Box>
        ) : (
          (recent ?? []).map((notification) => (
            <MenuItem
              key={notification.$id}
              onClick={() => handleOpenItem(notification)}
              sx={{ whiteSpace: 'normal', alignItems: 'flex-start' }}
            >
              <Stack sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: notification.readAt
                      ? 'fontWeightRegular'
                      : 'fontWeightMedium',
                  }}
                >
                  {notification.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {(NOTIFICATION_TYPE_LABELS as any)[notification.type] ??
                    notification.type}
                  {' · '}
                  {notification.createdAt?.toDate?.().toLocaleString() ?? ''}
                </Typography>
              </Stack>
            </MenuItem>
          ))
        )}
        <Divider />
        <Box sx={{ px: 1, py: 0.5 }}>
          <Button
            fullWidth
            size="small"
            color="secondary"
            onClick={() => {
              setAnchor(null)
              void router.push(buildRoute(Route.MANAGE_NOTIFICATIONS))
            }}
          >
            {'View all'}
          </Button>
        </Box>
      </Menu>
    </>
  )
}
NotificationsMenu.displayName = 'NotificationsMenu'

export default NotificationsMenu
