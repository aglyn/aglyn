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
  mdiCogOutline,
  mdiInboxOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  Popover,
  Stack,
  Tab,
  Tabs,
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
import useHostSubdomains from '../hooks/use-host-subdomains'
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
  // Inbox = unread, Archive = already read (AGL-874) — a click marks-read,
  // moving a notification from Inbox to Archive.
  const [tab, setTab] = useState<'inbox' | 'archive'>('inbox')
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

  // `useOrgHosts` above only covers the org currently open, so a notification
  // from any other org had no subdomain and fell through to its stored
  // `/{hostDocId}/…` link — a dead route (AGL-672). `hostIndex` resolves
  // hosts in every org the user can see.
  const indexedSubdomains = useHostSubdomains(
    useMemo(() => (recent ?? []).map((item) => item.hostId), [recent]),
  )

  const resolveLink = useCallback(
    (notification: AglynNotification) =>
      normalizeNotificationLink(notification.link, {
        orgSlug:
          (notification.orgId ? slugByOrgId.get(notification.orgId) : null) ??
          orgSlug,
        hostId: notification.hostId,
        hostSubdomain: notification.hostId
          ? (subdomainByHostId.get(notification.hostId) ??
            indexedSubdomains.get(notification.hostId))
          : undefined,
      }),
    [orgSlug, slugByOrgId, subdomainByHostId, indexedSubdomains],
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

  const list = (recent ?? []) as Array<AglynNotification & { $id: string }>
  const inbox = list.filter((item) => !item.readAt)
  const archive = list.filter((item) => Boolean(item.readAt))
  const shown = tab === 'inbox' ? inbox : archive
  const close = () => setAnchor(null)
  const goto = (href: string) => {
    close()
    void router.push(href)
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
            color="primary"
            badgeContent={unreadCount > 99 ? '99+' : unreadCount}
            invisible={unreadCount === 0}
          >
            <MdiIcon path={mdiBellOutline.path} />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              width: 380,
              maxWidth: '92vw',
              mt: 0.75,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              backgroundColor: 'surface.main',
              backgroundImage: 'none',
              boxShadow: '0px 8px 24px rgba(0,0,0,0.18)',
              overflow: 'hidden',
            },
          },
        }}
      >
        {/* Inbox / Archive tabs + settings gear. */}
        <Stack
          direction="row"
          sx={{ alignItems: 'center', pl: 1, pr: 0.5, pt: 0.5 }}
        >
          <Tabs
            value={tab}
            onChange={(_event, value) => setTab(value)}
            sx={{ flex: 1, minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}
          >
            <Tab
              value="inbox"
              label="Inbox"
              sx={{ textTransform: 'none', minWidth: 0, px: 1.5 }}
            />
            <Tab
              value="archive"
              label="Archive"
              sx={{ textTransform: 'none', minWidth: 0, px: 1.5 }}
            />
          </Tabs>
          <Tooltip title="Notification settings">
            <IconButton
              size="small"
              aria-label="Notification settings"
              onClick={() => goto(buildRoute(Route.MANAGE_NOTIFICATIONS))}
            >
              <MdiIcon path={mdiCogOutline.path} fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Divider />

        <Box sx={{ maxHeight: 380, overflowY: 'auto' }}>
          {shown.length === 0 ? (
            <Stack
              sx={{
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.5,
                py: 6,
                px: 2,
              }}
            >
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  bgcolor: 'action.hover',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MdiIcon
                  path={mdiInboxOutline.path}
                  sx={{ color: 'text.secondary', fontSize: 24 }}
                />
              </Box>
              <Typography variant="body2" color="text.secondary">
                {tab === 'inbox'
                  ? 'No new notifications'
                  : 'No archived notifications'}
              </Typography>
            </Stack>
          ) : (
            shown.map((notification) => (
              <Box
                key={notification.$id}
                onClick={() => handleOpenItem(notification)}
                sx={{
                  display: 'flex',
                  gap: 1.25,
                  px: 2,
                  py: 1.25,
                  cursor: 'pointer',
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:hover': { backgroundColor: 'action.hover' },
                }}
              >
                <Box
                  sx={{
                    width: 8,
                    flexShrink: 0,
                    display: 'flex',
                    justifyContent: 'center',
                    pt: 0.75,
                  }}
                >
                  {notification.readAt ? null : (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: 'secondary.main',
                      }}
                    />
                  )}
                </Box>
                <Stack sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: notification.readAt ? 400 : 600 }}
                  >
                    {notification.title}
                  </Typography>
                  {notification.body ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {notification.body}
                    </Typography>
                  ) : null}
                  <Typography variant="caption" color="text.secondary">
                    {(NOTIFICATION_TYPE_LABELS as any)[notification.type] ??
                      notification.type}
                    {' · '}
                    {notification.createdAt?.toDate?.().toLocaleString() ?? ''}
                  </Typography>
                </Stack>
              </Box>
            ))
          )}
        </Box>

        <Divider />
        <Stack direction="row" sx={{ alignItems: 'center', p: 1, gap: 1 }}>
          {tab === 'inbox' && inbox.length > 0 ? (
            <Button
              size="small"
              startIcon={
                <MdiIcon path={mdiCheckAll.path} sx={{ fontSize: '1rem' }} />
              }
              onClick={handleMarkAll}
            >
              {'Mark all read'}
            </Button>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            color="primary"
            onClick={() => goto(buildRoute(Route.MANAGE_NOTIFICATIONS))}
          >
            {'View all'}
          </Button>
        </Stack>
      </Popover>
    </>
  )
}
NotificationsMenu.displayName = 'NotificationsMenu'

export default NotificationsMenu
