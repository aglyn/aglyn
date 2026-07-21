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
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_TYPE_LABELS,
  type NotificationCategory,
} from '@aglyn/aglyn'
import { mdiBellOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Button,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import manageNavTabItems from '../../../../constants/manage-nav-tabs'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useNotificationAlertPrefs from '../../../../hooks/use-notification-prefs'
import useHostSubdomains from '../../../../hooks/use-host-subdomains'
import useOrgHosts from '../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import {
  desktopNotificationPermission,
  playNotificationChime,
  requestDesktopNotifications,
  showDesktopNotification,
} from '../../../../utils/notification-alerts'
import { normalizeNotificationLink } from '../../../../utils/notification-links'

const PAGE_SIZE = 25

/**
 * Notifications page (AGL-260): the full, cursor-paginated feed behind
 * the app-bar dropdown's "View all".
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
  // Per-device alert settings (AGL-650) — separate from the category mutes
  // below, which are account-wide on the user doc.
  const [alertPrefs, setAlertPrefs] = useNotificationAlertPrefs()
  const { enqueueSnackbar } = useSnackbar()
  const [permission, setPermission] = useState<
    NotificationPermission | 'unsupported'
  >('default')
  useEffect(() => {
    setPermission(desktopNotificationPermission())
  }, [])
  // ---- TEMPORARY test affordance (AGL-650) — delete this block and the
  // "Test alerts" button below to remove. Exists because there is otherwise
  // no way to hear the chime or confirm the desktop permission without
  // waiting for a real notification to arrive.
  const handleTestAlerts = useCallback(async () => {
    playNotificationChime()
    let current = desktopNotificationPermission()
    if (current === 'default') current = await requestDesktopNotifications()
    setPermission(current)
    if (current === 'granted') {
      // force: the tab is focused by definition when you click Test, and
      // desktop alerts are otherwise hidden-tab-only.
      showDesktopNotification({
        title: 'Aglyn notifications are on',
        body: 'This is what a notification looks like.',
        tag: 'aglyn-test',
        force: true,
      })
      setAlertPrefs({ desktop: true })
    }
    enqueueSnackbar(
      current === 'granted'
        ? 'Played the chime and sent a test notification.'
        : current === 'denied'
          ? 'Chime played. Desktop notifications are blocked for this site — re-allow them in your browser settings.'
          : 'Chime played. Desktop notifications were not granted.',
      { variant: current === 'granted' ? 'success' : 'info', persist: false },
    )
  }, [setAlertPrefs, enqueueSnackbar])
  // ---- end temporary test affordance

  const handleDesktopToggle = useCallback(async () => {
    if (alertPrefs.desktop) {
      setAlertPrefs({ desktop: false })
      return
    }
    // The prompt only works from a user gesture, which is why this lives on
    // the toggle rather than firing on page load.
    let current = desktopNotificationPermission()
    if (current === 'default') current = await requestDesktopNotifications()
    setPermission(current)
    setAlertPrefs({ desktop: current === 'granted' })
  }, [alertPrefs.desktop, setAlertPrefs])
  const { hosts } = useOrgHosts(firestore, uid, currentOrg?.$id ?? undefined)
  const [rows, setRows] = useState<any[]>([])
  const indexedSubdomains = useHostSubdomains(
    useMemo(() => rows.map((row) => row.hostId), [rows]),
  )
  const [cursors, setCursors] = useState<QueryDocumentSnapshot[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadPage = useCallback(
    async (targetPage: number, cursor?: QueryDocumentSnapshot) => {
      if (!uid) return
      setLoading(true)
      try {
        const snapshot = await getDocs(
          query(
            collection(firestore, 'users', uid, 'notifications'),
            orderBy('createdAt', 'desc'),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(PAGE_SIZE + 1),
          ),
        )
        const docs = snapshot.docs.slice(0, PAGE_SIZE)
        setRows(docs.map((entry) => ({ $id: entry.id, ...entry.data() })))
        setHasMore(snapshot.docs.length > PAGE_SIZE)
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
    [firestore, uid],
  )

  useEffect(() => {
    void loadPage(0)
  }, [loadPage])

  // Preferences (AGL-267): category mutes on users/{uid}.notificationPrefs.
  const [prefs, setPrefs] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!uid) return
    let active = true
    void (async () => {
      try {
        const snapshot = await getDoc(doc(firestore, 'users', uid))
        if (active) {
          setPrefs(
            (snapshot.get('notificationPrefs') as Record<string, boolean>) ??
              {},
          )
        }
      } catch {
        // Defaults (everything on) when the doc is unreadable.
      }
    })()
    return () => {
      active = false
    }
  }, [firestore, uid])
  const togglePref = (category: NotificationCategory) => {
    if (!uid) return
    const next = { ...prefs, [category]: prefs[category] === false }
    setPrefs(next)
    void setDoc(
      doc(firestore, 'users', uid),
      { notificationPrefs: next },
      { merge: true },
    ).catch(console.error)
  }

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
          batch.update(entry.ref, { readAt: serverTimestamp() })
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

  const handleOpen = (notification: any) => {
    if (!uid) return
    if (!notification.readAt) {
      void updateDoc(
        doc(firestore, 'users', uid, 'notifications', notification.$id),
        { readAt: serverTimestamp() },
      ).catch(console.error)
    }
    const target = normalizeNotificationLink(notification.link, {
      // The notification's own org, not the one currently open (AGL-644).
      orgSlug:
        (notification.orgId
          ? (orgs ?? []).find((org) => org.$id === notification.orgId)?.slug
          : null) ?? orgSlug,
      hostId: notification.hostId,
      // `hosts` only covers the org currently open; hostIndex covers the
      // rest, so cross-org notifications resolve too (AGL-672).
      hostSubdomain: notification.hostId
        ? ((hosts ?? []).find((host) => host.$id === notification.hostId)
            ?.subdomain ?? indexedSubdomains.get(notification.hostId))
        : undefined,
    })
    if (target) void router.push(target)
  }

  return (
    <>
      <NextPageTitle screen={'Notifications'} />
      <DashboardLayout
        navTabItems={manageNavTabItems()}
        activeTab={buildRoute(Route.MANAGE_NOTIFICATIONS)}
        breadcrumbItems={[
          {
            children: 'Notifications',
            href: buildRoute(Route.MANAGE_NOTIFICATIONS),
          },
        ]}
        header={{
          children: 'Notifications',
          icon: { path: mdiBellOutline.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay
            header={'All notifications'}
            help={docsHelp('consoleTour', {
              anchor: '#workspace-settings--notifications',
              excerpt:
                'Every console notification, newest first — mark all read ' +
                "and mute the categories you don't want.",
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
                  color="secondary"
                  disabled={markingAll}
                  onClick={() => void handleMarkAllRead()}
                >
                  {markingAll ? 'Marking…' : 'Mark all read'}
                </Button>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 'auto' }}
                >
                  {'Mute categories:'}
                </Typography>
                {(
                  Object.entries(NOTIFICATION_CATEGORY_LABELS) as Array<
                    [NotificationCategory, string]
                  >
                ).map(([category, label]) => (
                  <FormControlLabel
                    key={category}
                    control={
                      <Switch
                        size="small"
                        checked={prefs[category] !== false}
                        onChange={() => togglePref(category)}
                      />
                    }
                    label={label}
                    slotProps={{ typography: { variant: 'caption' } }}
                  />
                ))}
              </Stack>
              <Stack
                direction="row"
                spacing={1}
                sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}
              >
                <Typography variant="caption" color="text.secondary">
                  {'Alerts on this device:'}
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={alertPrefs.tabBadge}
                      onChange={() =>
                        setAlertPrefs({ tabBadge: !alertPrefs.tabBadge })
                      }
                    />
                  }
                  label="Unread count in tab title"
                  slotProps={{ typography: { variant: 'caption' } }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={alertPrefs.sound}
                      onChange={() =>
                        setAlertPrefs({ sound: !alertPrefs.sound })
                      }
                    />
                  }
                  label="Sound"
                  slotProps={{ typography: { variant: 'caption' } }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={alertPrefs.desktop}
                      disabled={
                        permission === 'unsupported' || permission === 'denied'
                      }
                      onChange={() => void handleDesktopToggle()}
                    />
                  }
                  label="Desktop notifications"
                  slotProps={{ typography: { variant: 'caption' } }}
                />
                {/* TEMPORARY (AGL-650): delete with the handler above. */}
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void handleTestAlerts()}
                >
                  {'Test alerts'}
                </Button>
                {permission === 'denied' || permission === 'unsupported' ? (
                  <Typography variant="caption" color="text.secondary">
                    {permission === 'denied'
                      ? 'Blocked for this site — re-allow notifications in your ' +
                        'browser settings to switch this on.'
                      : 'This browser does not support desktop notifications.'}
                  </Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {'Shown only while this tab is in the background.'}
                  </Typography>
                )}
              </Stack>
              {rows.length === 0 && !loading ? (
                <Typography variant="body2" color="text.secondary">
                  {"You're all caught up."}
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Notification'}</TableCell>
                      <TableCell>{'Type'}</TableCell>
                      <TableCell>{'When'}</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((notification) => (
                      <TableRow
                        key={notification.$id}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => handleOpen(notification)}
                      >
                        <TableCell>
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
                          {notification.body ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {notification.body}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={
                              (NOTIFICATION_TYPE_LABELS as any)[
                                notification.type
                              ] ?? notification.type
                            }
                          />
                        </TableCell>
                        <TableCell>
                          {notification.createdAt
                            ?.toDate?.()
                            .toLocaleString() ?? ''}
                        </TableCell>
                        <TableCell align="right">
                          {notification.readAt ? null : (
                            <Chip size="small" color="secondary" label="New" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button
                  size="small"
                  color="secondary"
                  disabled={loading || page === 0}
                  onClick={() => loadPage(page - 1, cursors[page - 2])}
                >
                  {'Previous'}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {`Page ${page + 1}`}
                </Typography>
                <Button
                  size="small"
                  color="secondary"
                  disabled={loading || !hasMore}
                  onClick={() => loadPage(page + 1, cursors[page])}
                >
                  {'Next'}
                </Button>
              </Stack>
            </Stack>
          </CardDisplay>
        </Container>
      </DashboardLayout>
    </>
  )
}
ManageNotifications.displayName = 'Page:ManageNotifications'

export default ManageNotifications
