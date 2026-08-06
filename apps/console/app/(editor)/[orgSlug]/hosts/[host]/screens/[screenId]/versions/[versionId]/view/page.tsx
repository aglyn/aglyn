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
  composeScreenRoutePath,
  findScreenIdByRoutePath,
  HostScreenVisibility,
  nameSearchKey,
  normalizeScreenSlug,
  screenRoutePathToUrl,
  type ScreenRouteNode,
  type ScreenUid,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_BESIGNER,
  ICON_VARIANT_DATE_TIME,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_PRIMARY_KEY,
  ICON_VARIANT_SYMBOL_SECURE,
  ICON_VARIANT_TEXT,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteField,
  doc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import ScreenAnalyticsCard from '../../../../../../../../../../components/analytics/screen-analytics-card.component'
import AuthenticatedLayout from '../../../../../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../../../../../components/layouts/main.layout'
import SecondaryNavBarComponent from '../../../../../../../../../../components/secondary-nav-bar.component'
import revalidateLivePages from '../../../../../../../../../../utils/revalidate-live-pages'
import HostDisplayNameComponent from '../../../../../../../../../../components/host-display-name.component'
import { hasEntitlement } from '../../../../../../../../../../constants/entitlements'
import { buildRoute, Route } from '../../../../../../../../../../constants/route-links'
import { useHostId, useHostSubdomain } from '../../../../../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../../../../../hooks/use-org-scope'
import { buildScreenLiveUrl } from '../../../../../../../../../../constants/tenant-links'
import {
  publishScreenRoute,
  unpublishScreenRoute,
} from '../../../../../../../../../../constants/screen-publishing'
import PluginWidgetSlot from '../../../../../../../../../../components/plugin-widget-slot.component'
import { CONTENT_MAX_WIDTH } from '../../../../../../../../../../constants/shared'
import { docsHelp } from '../../../../../../../../../../constants/docs-links'
import {
  collectionTemplatePublishMessage,
  collectionTemplateRoutesSummary,
} from '../../../../../../../../../../constants/collection-templates'
import useCollectionTemplates from '../../../../../../../../../../hooks/use-collection-templates'
import useCurrentOrg from '../../../../../../../../../../hooks/use-current-org'
import useFirestoreCollection from '../../../../../../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../../../../../../hooks/use-firestore-doc'
import useHostActivityLogger from '../../../../../../../../../../hooks/use-host-activity-logger'

const whiteSpace = '--'

/** Visibility options (page permissions, AGL-113). Members/password rows
 * explain where enforcement lives so the select never overpromises.
 *
 * Every hint now says what the choice does to SEARCH (AGL-1263), because it
 * always did and nothing said so. `Public` is the only indexable value — the
 * other three are excluded from the sitemap and carry `noindex` — and
 * "Reachable by URL only" was the whole of what an author was told before
 * picking the option that quietly de-indexes a page. This is the per-page
 * half of the site-wide switch in Setup → SEO. */
const VISIBILITY_OPTIONS = [
  {
    value: HostScreenVisibility.PUBLIC,
    label: 'Public',
    hint: 'Anyone with the link; listed in navigation and offered to search engines.',
  },
  {
    value: HostScreenVisibility.UNLISTED,
    label: 'Unlisted',
    hint: 'Reachable by URL only — kept out of search results and the sitemap.',
  },
  {
    value: HostScreenVisibility.PASSWORD,
    label: 'Password protected',
    hint: 'Visitors must enter the page password; kept out of search results.',
  },
  {
    value: HostScreenVisibility.AUTHENTICATED,
    label: 'Members only',
    hint: 'Requires site membership (enforced once site sign-in ships); kept out of search results.',
  },
]

/**
 * Ceiling on the app-wide loading overlay this page raises while its screen
 * document loads (AGL-1261). See the effect that uses it.
 */
const SCREEN_LOAD_OVERLAY_MAX_MS = 12000

function ScreenDetails() {
  const params = useParams<{
    hostId: string
    screenId: string
    versionId: string
  }>()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const hostId = useHostId()
  const screenId = params?.screenId as string
  const versionId = params?.versionId as string
  const router = useRouter()
  const firestore = useFirestore()
  const { queueLoading, loading } = useLoading()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org } = useCurrentOrg()
  const logActivity = useHostActivityLogger(hostId)

  const screenRef = doc(firestore, 'hosts', hostId, 'screens', screenId)
  const { status, data: screen } = useFirestoreDoc<any>(
    () => screenRef,
    [firestore, hostId, screenId],
    { idField: '$id' },
  )
  const { data: hostData } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: versionDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'screens', screenId, 'versions'),
        limit(50),
      ),
    [firestore, hostId, screenId],
    { idField: '$id' },
  )
  const versions = useMemo(
    () =>
      [...(versionDocs ?? [])].sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      ),
    [versionDocs],
  )

  // A collection's list/entry template is published so the compose pipeline
  // picks it up, but it is not a page of the site (AGL-1267) — so nothing
  // here may name the slug it was published under (AGL-1269).
  const { templateScreenIds, routesByScreenId } = useCollectionTemplates(hostId)
  const isCollectionTemplate = templateScreenIds.has(screenId)
  const templateRoutes = collectionTemplateRoutesSummary(
    routesByScreenId.get(screenId),
  )
  const routingMap = hostData?.screens as Record<ScreenUid, string> | undefined
  // AGL-374: buildScreenLiveUrl normalizes the slug into a path and knows
  // custom domains + preview consoles.
  const liveUrl = buildScreenLiveUrl(hostData, screenId)
  const publishedPath = routingMap?.[screenId]
  const isRoutePublished = publishedPath != null
  const screensById = useMemo(() => {
    const map: Record<ScreenUid, ScreenRouteNode> = {}
    for (const item of screenDocs ?? []) {
      map[item.$id] = { slug: item.slug, parentId: item.parentId }
    }
    return map
  }, [screenDocs])

  /**
   * The screen read holds the GLOBAL loading overlay — bounded (AGL-1261).
   *
   * `queueLoading()` renders an app-wide modal backdrop with no dismiss and
   * no message. Tying it to `status === 'loading'` with no ceiling means that
   * whenever this listener never emits — a stale session denying every server
   * read while `persistentLocalCache` keeps other pages looking fine
   * (AGL-1062), an offline tab, a wedged transport — the whole console sits
   * under an un-dismissable spinner with the page dimmed behind it, and the
   * only way out is a reload. That is the "clicking view detail spins
   * forever" report.
   *
   * After the ceiling, drop the overlay and let the page render its own
   * state. A visible page that is honest about what it does not have beats a
   * modal that says nothing at all.
   */
  const [loadStalled, setLoadStalled] = useState(false)
  useEffect(() => {
    if (status !== 'loading') {
      setLoadStalled(false)
      return undefined
    }
    const dequeue = queueLoading()
    const timer = setTimeout(() => {
      setLoadStalled(true)
      dequeue && dequeue()
    }, SCREEN_LOAD_OVERLAY_MAX_MS)
    return () => {
      clearTimeout(timer)
      dequeue && dequeue()
    }
  }, [status, queueLoading])

  useEffect(() => {
    if (!loadStalled) return
    enqueueSnackbar(
      "This screen is taking longer than usual to load. If it doesn't " +
        'appear, your session may need refreshing — sign out and back in.',
      { variant: 'warning', persist: true, allowDuplicate: true },
    )
  }, [loadStalled, enqueueSnackbar])

  // "Not Found" is only true once the read has SETTLED. While it is still in
  // flight the honest answer is that we do not know yet (AGL-1261).
  const displayName =
    screen?.displayName || (status === 'loading' ? 'Loading…' : 'Not Found')
  const schedule =
    screen?.publishSchedule?.status === 'pending'
      ? screen.publishSchedule
      : undefined
  // A schedule that came due on a plan without `scheduledPublishing` (AGL-1185).
  // Shown rather than dropped: it silently stopped being pending, and a screen
  // whose scheduled publish simply vanished is indistinguishable from one that
  // was never scheduled. Dismissing clears the field like any other cancel.
  const skippedSchedule =
    screen?.publishSchedule?.status === 'skipped-unentitled'
      ? screen.publishSchedule
      : undefined

  // --- Edit details dialog ---------------------------------------------
  const [editor, setEditor] = useState<{
    displayName: string
    description: string
  } | null>(null)
  const handleEditSave = useCallback(async () => {
    if (!editor?.displayName.trim()) return
    await updateDoc(screenRef, {
      displayName: editor.displayName.trim(),
      // Keep the name-search key in sync on rename (AGL-835) so the switcher's
      // prefix query finds the screen under its new name.
      nameLower: nameSearchKey(editor.displayName.trim()),
      description: editor.description.trim(),
      updatedAt: Timestamp.now(),
    })
      .then(() => {
        enqueueSnackbar('Screen updated', { variant: 'success', persist: false })
        logActivity('Updated screen details', {
          type: 'screen',
          id: screenId,
          name: editor.displayName.trim(),
        })
        setEditor(null)
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [editor, screenRef, enqueueSnackbar, logActivity, screenId])

  // --- Delete -----------------------------------------------------------
  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Delete this screen?',
      description:
        `"${displayName}" is removed from the site and its published ` +
        'path stops resolving.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    const dequeue = queueLoading()
    try {
      await Promise.all([
        updateDoc(screenRef, { deletedAt: Timestamp.now() }),
        unpublishScreenRoute(firestore, { hostId, screenId }),
      ])
      enqueueSnackbar('Screen deleted', { variant: 'success', persist: false })
      logActivity('Deleted screen', {
        type: 'screen',
        id: screenId,
        name: displayName,
      })
      router.push(buildRoute(Route.HOST_SCREENS, { orgSlug,  host }))
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      dequeue()
    }
  }, [
    confirm,
    displayName,
    queueLoading,
    screenRef,
    firestore,
    hostId,
    screenId,
    enqueueSnackbar,
    router,
    logActivity,
  ])

  // --- Publish / unpublish the route ------------------------------------
  const [slugInput, setSlugInput] = useState<string | null>(null)
  const slugValue = slugInput ?? screen?.slug ?? ''
  const handlePublishRoute = useCallback(async () => {
    if (loading) return
    const slug = normalizeScreenSlug(slugValue)
    if (!slug && slugValue.trim() !== '/') {
      return enqueueSnackbar('Enter a slug ("/" for the home page)', {
        variant: 'warning',
        persist: false,
      })
    }
    const composed = composeScreenRoutePath(screenId, {
      ...screensById,
      [screenId]: { ...screensById[screenId], slug },
    })
    const owner = composed
      ? findScreenIdByRoutePath(routingMap, composed)
      : undefined
    if (owner && owner !== screenId) {
      return enqueueSnackbar(
        `Another screen is already published at ${screenRoutePathToUrl(composed as string)}`,
        { variant: 'warning', persist: false },
      )
    }
    const dequeue = queueLoading()
    try {
      await publishScreenRoute(
        firestore,
        { hostId, screenId },
        slug,
        composed ?? slug,
      )
      enqueueSnackbar(
        collectionTemplatePublishMessage(routesByScreenId.get(screenId), {
          isTemplateScreen: isCollectionTemplate,
        }) ?? `Published at ${screenRoutePathToUrl(composed ?? slug)}`,
        { variant: 'success', persist: false },
      )
      logActivity(
        `Published route ${screenRoutePathToUrl(composed ?? slug)}`,
        { type: 'screen', id: screenId, name: displayName },
      )
      setSlugInput(null)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      dequeue()
    }
  }, [
    loading,
    slugValue,
    screenId,
    screensById,
    routingMap,
    queueLoading,
    firestore,
    hostId,
    enqueueSnackbar,
    displayName,
    logActivity,
    isCollectionTemplate,
    routesByScreenId,
  ])

  const handleUnpublishRoute = useCallback(async () => {
    const dequeue = queueLoading()
    try {
      await unpublishScreenRoute(firestore, { hostId, screenId })
      enqueueSnackbar('Screen unpublished', {
        variant: 'success',
        persist: false,
      })
      logActivity('Unpublished screen', {
        type: 'screen',
        id: screenId,
        name: displayName,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      dequeue()
    }
  }, [queueLoading, firestore, hostId, screenId, enqueueSnackbar, displayName, logActivity])

  /**
   * Drop the published page's cached HTML (AGL-1150).
   *
   * Publishing writes a pointer; the live page is ISR-cached, so without this
   * the change waits out the revalidate window and then STILL serves stale to
   * the next visitor while Next regenerates behind them. Publish, refresh, see
   * nothing, refresh again, see it.
   *
   * Deliberately fire-and-forget AFTER the snackbar. The publish has already
   * succeeded by this point — a cache hint that fails must not turn a
   * successful publish into an error, and the revalidate window is still
   * underneath as the backstop.
   */
  const { data: user } = useUser()
  // Shared with the besigner's versions panel (AGL-1150). This was the only
  // publish site that dropped a cache; keeping the call in one helper is what
  // stops the next publish surface from quietly forgetting it.
  //
  // No shortfall snackbar here, unlike that panel (AGL-1239): publishing a
  // SCREEN fans out to exactly one path, so neither the tenant's path cap nor
  // the console's dependent scan can bite. A warning that cannot fire is worse
  // than none — it reads as coverage.
  const revalidateLivePage = useCallback(
    () => revalidateLivePages({ user, hostId, screenId }),
    [user, hostId, screenId],
  )

  // --- Version publish-now ----------------------------------------------
  const handlePublishVersion = useCallback(
    (id: string) => async () => {
      await updateDoc(screenRef, { versionId: id, updatedAt: Timestamp.now() })
        .then(() => {
          enqueueSnackbar('Version is now live', {
            variant: 'success',
            persist: false,
          })
          logActivity('Published version', {
            type: 'screen',
            id: screenId,
            name: displayName,
          })
          void revalidateLivePage()
        })
        .catch(() =>
          enqueueSnackbar('An error has occurred', { variant: 'error' }),
        )
    },
    [screenRef, enqueueSnackbar, displayName, logActivity, screenId, revalidateLivePage],
  )

  // --- Schedule publish / unpublish (AGL-113; Business tier like AGL-61) --
  const [scheduler, setScheduler] = useState<{
    action: 'publish' | 'unpublish'
    versionId: string
    at: string
  } | null>(null)
  const openScheduler = useCallback(
    (action: 'publish' | 'unpublish', presetVersionId?: string) => () => {
      if (!hasEntitlement('scheduled-publishing', org)) {
        return enqueueSnackbar(
          'Scheduled publishing requires a Business plan — see Billing',
          { variant: 'warning', persist: false },
        )
      }
      const initial = new Date(Date.now() + 60 * 60 * 1000)
      initial.setMinutes(0, 0, 0)
      const pad = (value: number) => String(value).padStart(2, '0')
      setScheduler({
        action,
        versionId:
          presetVersionId ?? screen?.versionId ?? versions[0]?.$id ?? '',
        at:
          `${initial.getFullYear()}-${pad(initial.getMonth() + 1)}-` +
          `${pad(initial.getDate())}T${pad(initial.getHours())}:${pad(initial.getMinutes())}`,
      })
    },
    [org, enqueueSnackbar, screen, versions],
  )
  const handleScheduleConfirm = useCallback(async () => {
    if (!scheduler?.at) return
    const publishAt = new Date(scheduler.at)
    if (Number.isNaN(publishAt.getTime()) || publishAt <= new Date()) {
      return enqueueSnackbar('Pick a future date/time', {
        variant: 'warning',
        persist: false,
      })
    }
    if (scheduler.action === 'publish' && !scheduler.versionId) return
    await updateDoc(screenRef, {
      publishSchedule: {
        action: scheduler.action,
        ...(scheduler.action === 'publish'
          ? { versionId: scheduler.versionId }
          : {}),
        publishAt: Timestamp.fromDate(publishAt),
        status: 'pending',
        createdAt: Timestamp.now(),
      },
    })
      .then(() => {
        enqueueSnackbar(
          `Scheduled to ${scheduler.action} ${publishAt.toLocaleString()}`,
          { variant: 'success', persist: false },
        )
        logActivity(
          `Scheduled ${scheduler.action} for ${publishAt.toLocaleString()}`,
          { type: 'screen', id: screenId, name: displayName },
        )
        setScheduler(null)
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [scheduler, screenRef, enqueueSnackbar, displayName, logActivity, screenId])
  const handleScheduleCancel = useCallback(async () => {
    await updateDoc(screenRef, { publishSchedule: deleteField() })
      .then(() =>
        enqueueSnackbar('Schedule canceled', {
          variant: 'success',
          persist: false,
        }),
      )
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [screenRef, enqueueSnackbar])

  // --- Access / permissions ----------------------------------------------
  const visibilityValue = screen?.visibility ?? HostScreenVisibility.PUBLIC
  const handleVisibilityChange = useCallback(
    async (value: number) => {
      const update: Record<string, unknown> = { visibility: value }
      // Leaving password mode drops the stored hash so protection does not
      // silently linger (org enforces on the hash, not the mode).
      if (
        value !== HostScreenVisibility.PASSWORD &&
        screen?.protection?.passwordHash
      ) {
        update.protection = deleteField()
      }
      await updateDoc(screenRef, update)
        .then(() => {
          enqueueSnackbar('Page access updated', {
            variant: 'success',
            persist: false,
          })
          logActivity('Changed page access', {
            type: 'screen',
            id: screenId,
            name: displayName,
          })
        })
        .catch(() =>
          enqueueSnackbar('An error has occurred', { variant: 'error' }),
        )
    },
    [screen, screenRef, enqueueSnackbar, displayName, logActivity, screenId],
  )
  const [password, setPassword] = useState('')
  const handlePasswordSave = useCallback(async () => {
    const value = password.trim()
    let update: Record<string, unknown>
    if (!value) {
      update = { protection: deleteField() }
    } else {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(value),
      )
      const passwordHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      update = { protection: { passwordHash } }
    }
    await updateDoc(screenRef, update)
      .then(() => {
        enqueueSnackbar(
          value ? 'Password protection enabled' : 'Password protection removed',
          { variant: 'success', persist: false },
        )
        setPassword('')
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [password, screenRef, enqueueSnackbar])

  // --- SEO (AGL-117): screen fields override host defaults on the org --
  const [seoDraft, setSeoDraft] = useState<{
    title: string
    description: string
    image: string
  } | null>(null)
  const seoValue = {
    title: seoDraft?.title ?? screen?.seo?.title ?? '',
    description: seoDraft?.description ?? screen?.seo?.description ?? '',
    image: seoDraft?.image ?? screen?.seo?.image ?? '',
  }
  const setSeoField = (field: 'title' | 'description' | 'image') =>
    (event: { target: { value: string } }) =>
      setSeoDraft({ ...seoValue, [field]: event.target.value })
  const handleSeoSave = useCallback(async () => {
    if (!seoDraft) return
    const seo: Record<string, string> = {}
    if (seoDraft.title.trim()) seo.title = seoDraft.title.trim()
    if (seoDraft.description.trim())
      seo.description = seoDraft.description.trim()
    if (seoDraft.image.trim()) seo.image = seoDraft.image.trim()
    await updateDoc(
      screenRef,
      Object.keys(seo).length
        ? { seo, updatedAt: Timestamp.now() }
        : { seo: deleteField(), updatedAt: Timestamp.now() },
    )
      .then(() => {
        enqueueSnackbar('SEO saved', { variant: 'success', persist: false })
        logActivity('Updated SEO', {
          type: 'screen',
          id: screenId,
          name: displayName,
        })
        setSeoDraft(null)
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [seoDraft, screenRef, enqueueSnackbar, displayName, logActivity, screenId])

  const details = [
    {
      key: 'id',
      primary: 'Screen ID:',
      secondary: screen?.$id,
      icon: { path: ICON_VARIANT_PRIMARY_KEY.path },
    },
    {
      key: 'displayName',
      primary: 'Display name:',
      secondary: screen?.displayName,
      icon: { path: ICON_VARIANT_TEXT.path },
    },
    {
      key: 'description',
      primary: 'Description:',
      secondary: screen?.description,
      icon: { path: ICON_VARIANT_TEXT.path },
    },
    {
      key: 'dateCreated',
      primary: 'Date created:',
      secondary: screen?.createdAt?.toDate?.()?.toLocaleString(),
      icon: { path: ICON_VARIANT_DATE_TIME.path },
    },
    {
      key: 'datePublished',
      primary: 'Date published:',
      // Present only while the route is live (cleared on unpublish); '--'
      // otherwise via the ListItemText fallback below.
      secondary: screen?.publishedAt?.toDate?.()?.toLocaleString(),
      icon: { path: ICON_VARIANT_DATE_TIME.path },
    },
    {
      key: 'dateUpdated',
      primary: 'Last updated:',
      secondary: screen?.updatedAt?.toDate?.()?.toLocaleString(),
      icon: { path: ICON_VARIANT_DATE_TIME.path },
    },
  ]

  return (
    <MainLayout>
      {/*
        This page sits in the full-screen `(editor)` group but wants the normal
        console chrome, so it mounts MainLayout itself — and, since AGL-755
        moved the secondary bar into the `(app)` layout this route never sees,
        it mounts that itself too.
      */}
      <SecondaryNavBarComponent />
      <DashboardLayout
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
          },
          {
            children: 'Screens',
            href: buildRoute(Route.HOST_SCREENS, { orgSlug,  host }),
          },
          {
            children: displayName,
          },
        ]}
        help="screens"
        header={{
          children: displayName,
          icon: { path: ICON_VARIANT_PAGES.path },
        }}
        headerRight={
          <Stack direction="row" spacing={1}>
            {liveUrl ? (
              <AppLink
                componentVariant="button"
                size="small"
                variant="outlined"
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
              >
                {'View'}
              </AppLink>
            ) : null}
            <Button
              size="small"
              variant="outlined"
              onClick={() =>
                setEditor({
                  displayName: screen?.displayName ?? '',
                  description: screen?.description ?? '',
                })
              }
            >
              {'Edit'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={handleDelete}
            >
              {'Delete'}
            </Button>
            <AppLink
              size="small"
              variant="contained"
              componentVariant="button"
              href={buildRoute(Route.SCREEN_BESIGNER, { orgSlug, 
                host,
                screenId,
                versionId,
              })}
              title={'Open with besigner'}
              disabled={status !== 'success' || !screen}
              startIcon={
                <MdiIcon color="inherit" path={ICON_VARIANT_BESIGNER.path} />
              }
            >
              Open Besigner
            </AppLink>
          </Stack>
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12, md: 6, lg: 4 },
                children: (
                  <CardDisplay
                    header={'Basic Details'}
                    help={docsHelp('screens', { anchor: '#screens--routing', excerpt: 'A screen\u2019s name, slug, and where it sits in your site\u2019s routing hierarchy.' })}
                    contentGutterY
                    contentBordered="all"
                  >
                    <List dense disablePadding>
                      {details.map(
                        ({ primary, secondary, icon, key: itemKey }) => (
                          <ListItem
                            key={itemKey}
                            alignItems="flex-start"
                            dense
                          >
                            <ListItemIcon
                              sx={{
                                border: `1px solid`,
                                borderColor: 'divider',
                                padding: 1,
                                borderRadius: 1,
                                minWidth: 'unset',
                                marginRight: 2,
                                color: 'secondary.main',
                              }}
                            >
                              <MdiIcon {...icon} />
                            </ListItemIcon>
                            <ListItemText
                              primary={primary || whiteSpace}
                              secondary={secondary || whiteSpace}
                            />
                          </ListItem>
                        ),
                      )}
                    </List>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 6, lg: 4 },
                children: (
                  <CardDisplay
                    header={'Publishing'}
                    help={docsHelp('screens', { anchor: '#versions--scheduled-publishing', excerpt: 'Publish this screen live now or schedule a version to go live at a set time.' })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={1.5}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Chip
                          label={isRoutePublished ? 'Published' : 'Unpublished'}
                          color={isRoutePublished ? 'success' : 'default'}
                          size="small"
                        />
                        {isRoutePublished ? (
                          <Typography variant="body2" color="text.secondary">
                            {isCollectionTemplate
                              ? templateRoutes
                                ? `Renders ${templateRoutes}`
                                : 'Collection template — no path of its own'
                              : screenRoutePathToUrl(publishedPath as string)}
                          </Typography>
                        ) : null}
                        {schedule ? (
                          <Chip
                            label={
                              `${schedule.action === 'unpublish' ? 'Unpublishes' : 'Publishes'} ` +
                              `${schedule.publishAt?.toDate?.().toLocaleString() ?? ''}`
                            }
                            color="info"
                            size="small"
                            variant="outlined"
                            onDelete={handleScheduleCancel}
                          />
                        ) : null}
                        {skippedSchedule ? (
                          <Tooltip
                            title={
                              'Scheduled publishing is a Business feature. ' +
                              'This schedule came due on a plan without it, ' +
                              'so it was not applied — and it will not run ' +
                              'later if you upgrade. Schedule it again to ' +
                              'publish.'
                            }
                          >
                            <Chip
                              label={
                                `Did not ${
                                  skippedSchedule.action === 'unpublish'
                                    ? 'unpublish'
                                    : 'publish'
                                } — plan does not include scheduling`
                              }
                              color="warning"
                              size="small"
                              variant="outlined"
                              onDelete={handleScheduleCancel}
                            />
                          </Tooltip>
                        ) : null}
                      </Stack>
                      <TextField
                        size="small"
                        label="Slug"
                        value={slugValue}
                        onChange={(event) => setSlugInput(event.target.value)}
                        helperText={
                          'Path the screen is served at ("/" for the home page).'
                        }
                      />
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ flexWrap: 'wrap', rowGap: 1 }}
                      >
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          onClick={handlePublishRoute}
                        >
                          {isRoutePublished ? 'Update route' : 'Publish'}
                        </Button>
                        <Button
                          size="small"
                          disabled={!isRoutePublished}
                          onClick={handleUnpublishRoute}
                        >
                          {'Unpublish'}
                        </Button>
                        <Tooltip title="Make a version live at a date/time">
                          <span>
                            <Button
                              size="small"
                              color="primary"
                              onClick={openScheduler('publish')}
                              startIcon={
                                <MdiIcon
                                  fontSize="inherit"
                                  path={ICON_VARIANT_DATE_TIME.path}
                                />
                              }
                            >
                              {'Schedule publish'}
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title="Take the page offline at a date/time">
                          <span>
                            <Button
                              size="small"
                              color="primary"
                              disabled={!isRoutePublished}
                              onClick={openScheduler('unpublish')}
                              startIcon={
                                <MdiIcon
                                  fontSize="inherit"
                                  path={ICON_VARIANT_DATE_TIME.path}
                                />
                              }
                            >
                              {'Schedule unpublish'}
                            </Button>
                          </span>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 6, lg: 4 },
                children: (
                  <CardDisplay
                    header={'Page Access'}
                    help={docsHelp('siteProtection', { anchor: '#per-screen-passwords', excerpt: 'Control who can view this screen \u2014 members-only gating or a password.' })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={1.5}>
                      <TextField
                        select
                        size="small"
                        label="Visibility"
                        value={visibilityValue}
                        onChange={(event) =>
                          handleVisibilityChange(Number(event.target.value))
                        }
                      >
                        {VISIBILITY_OPTIONS.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Typography variant="caption" color="text.secondary">
                        {
                          VISIBILITY_OPTIONS.find(
                            (option) => option.value === visibilityValue,
                          )?.hint
                        }
                      </Typography>
                      {visibilityValue === HostScreenVisibility.PASSWORD ? (
                        <Stack direction="row" spacing={1}>
                          <TextField
                            size="small"
                            type="password"
                            label="Page password"
                            value={password}
                            onChange={(event) =>
                              setPassword(event.target.value)
                            }
                            helperText={
                              screen?.protection?.passwordHash
                                ? 'A password is set — save a new one to change it.'
                                : 'Save a password to protect this page.'
                            }
                          />
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            onClick={handlePasswordSave}
                            sx={{ alignSelf: 'flex-start' }}
                            startIcon={
                              <MdiIcon
                                fontSize="inherit"
                                path={ICON_VARIANT_SYMBOL_SECURE.path}
                              />
                            }
                          >
                            {'Save'}
                          </Button>
                        </Stack>
                      ) : null}
                      <Typography variant="caption" color="text.secondary">
                        {'Per-user editor permissions arrive with the team ' +
                          'user manager.'}
                      </Typography>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 6, lg: 4 },
                children: (
                  <CardDisplay
                    header={'SEO'}
                    help={docsHelp('seo', { anchor: '#per-screen-seo', excerpt: 'Per-screen search title, description, and social share image \u2014 overrides the site defaults.' })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={1.5}>
                      <TextField
                        size="small"
                        label="Title"
                        value={seoValue.title}
                        onChange={setSeoField('title')}
                        helperText={`${seoValue.title.length}/60 — overrides the host title on this page`}
                        error={seoValue.title.length > 60}
                      />
                      <TextField
                        size="small"
                        label="Description"
                        value={seoValue.description}
                        onChange={setSeoField('description')}
                        multiline
                        minRows={2}
                        helperText={`${seoValue.description.length}/155`}
                        error={seoValue.description.length > 155}
                      />
                      <TextField
                        size="small"
                        label="Social image URL"
                        value={seoValue.image}
                        onChange={setSeoField('image')}
                        helperText="Shown as the og:image preview when the page is shared."
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        disabled={!seoDraft}
                        onClick={handleSeoSave}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        {'Save SEO'}
                      </Button>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12, md: 6, lg: 8 },
                children: (
                  <PluginWidgetSlot
                    slot="hostActivity"
                    hostId={hostId}
                    targetId={screenId}
                    header={'Page Activity'}
                  />
                ),
              },
              {
                size: { xs: 12 },
                children: (
                  <CardDisplay
                    header={'Versions'}
                    help={docsHelp('screens', { anchor: '#versions--scheduled-publishing', excerpt: 'Every publish is a version you can view, restore, or schedule.' })}
                    contentBordered="all"
                  >
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{'Version'}</TableCell>
                          <TableCell>{'Created'}</TableCell>
                          <TableCell align="right">{'Actions'}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {versions.map((version) => {
                          const isLive = version.$id === screen?.versionId
                          return (
                            <TableRow key={version.$id} hover>
                              <TableCell>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ alignItems: 'center' }}
                                >
                                  <span>
                                    {version.displayName ?? version.$id}
                                  </span>
                                  {isLive ? (
                                    <Chip
                                      label="Live"
                                      color="success"
                                      size="small"
                                    />
                                  ) : null}
                                  {schedule?.versionId === version.$id &&
                                  schedule?.action !== 'unpublish' ? (
                                    <Chip
                                      label="Scheduled"
                                      color="info"
                                      size="small"
                                      variant="outlined"
                                    />
                                  ) : null}
                                </Stack>
                              </TableCell>
                              <TableCell>
                                {version.createdAt
                                  ?.toDate?.()
                                  .toLocaleString() ?? whiteSpace}
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{ whiteSpace: 'nowrap' }}
                              >
                                <Button
                                  size="small"
                                  color="primary"
                                  disabled={isLive}
                                  onClick={handlePublishVersion(version.$id)}
                                >
                                  {'Publish now'}
                                </Button>
                                <Tooltip
                                  title={
                                    isLive
                                      ? 'This version is already live'
                                      : 'Make this version live at a date/time'
                                  }
                                >
                                  <span>
                                    <Button
                                      size="small"
                                      color="primary"
                                      disabled={isLive}
                                      onClick={openScheduler(
                                        'publish',
                                        version.$id,
                                      )}
                                    >
                                      {'Schedule'}
                                    </Button>
                                  </span>
                                </Tooltip>
                                <AppLink
                                  size="small"
                                  componentVariant="button"
                                  href={buildRoute(Route.SCREEN_PREVIEW, { orgSlug, 
                                    host,
                                    screenId,
                                    versionId: version.$id,
                                  })}
                                >
                                  {'Preview'}
                                </AppLink>
                                <AppLink
                                  size="small"
                                  componentVariant="button"
                                  href={buildRoute(Route.SCREEN_BESIGNER, { orgSlug, 
                                    host,
                                    screenId,
                                    versionId: version.$id,
                                  })}
                                >
                                  {'Besigner'}
                                </AppLink>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </CardDisplay>
                ),
              },
              {
                size: { xs: 12 },
                children: (
                  <CardDisplay
                    header={'Raw JSON'}
                    help={docsHelp('screens', { excerpt: 'The screen document as stored \u2014 a read-only developer view of its structure.' })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <pre
                      style={{
                        margin: 0,
                        maxHeight: 360,
                        overflow: 'auto',
                      }}
                    >
                      {JSON.stringify(screen, null, 2)}
                    </pre>
                  </CardDisplay>
                ),
              },
            ]}
          />
          {/* Per-screen traffic (AGL-152). */}
          <div style={{ marginTop: 24 }}>
            <ScreenAnalyticsCard hostId={hostId} screenId={screenId} />
          </div>
        </Container>
      </DashboardLayout>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Edit screen'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Display name"
            value={editor?.displayName ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, displayName: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Description"
            value={editor?.description ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!editor?.displayName.trim()}
            onClick={handleEditSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(scheduler)}
        onClose={() => setScheduler(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {scheduler?.action === 'unpublish'
            ? 'Schedule unpublish'
            : 'Schedule publication'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <DialogContentText variant="body2">
            {scheduler?.action === 'unpublish'
              ? 'The page goes offline once the time passes (applied on the ' +
                'next site refresh). Only one pending schedule exists per page.'
              : 'The selected version becomes the live version at the chosen ' +
                'time (applied on the next site refresh after it passes). ' +
                'Only one pending schedule exists per page.'}
          </DialogContentText>
          {scheduler?.action === 'publish' ? (
            <TextField
              select
              size="small"
              label="Version"
              value={scheduler.versionId}
              onChange={(event) =>
                setScheduler((prev) =>
                  prev ? { ...prev, versionId: event.target.value } : prev,
                )
              }
            >
              {versions.map((version) => (
                <MenuItem key={version.$id} value={version.$id}>
                  {version.displayName ?? version.$id}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <TextField
            size="small"
            type="datetime-local"
            label={scheduler?.action === 'unpublish' ? 'Unpublish at' : 'Publish at'}
            value={scheduler?.at ?? ''}
            onChange={(event) =>
              setScheduler((prev) =>
                prev ? { ...prev, at: event.target.value } : prev,
              )
            }
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScheduler(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              !scheduler?.at ||
              (scheduler?.action === 'publish' && !scheduler?.versionId)
            }
            onClick={handleScheduleConfirm}
          >
            {'Schedule'}
          </Button>
        </DialogActions>
      </Dialog>
    </MainLayout>
  )
}
ScreenDetails.displayName = 'Page:ScreenDetails'

export default ScreenDetails
