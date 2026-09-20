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
  CAMPAIGN_MEMBERSHIP_FIELD,
  campaignMembershipUnchanged,
  campaignMembershipValue,
  composeScreenRoutePath,
  findScreenIdByRoutePath,
  HostScreenVisibility,
  nameSearchKey,
  normalizeScreenSlug,
  readCampaignIds,
  reservedScreenRouteMessage,
  reservedScreenRouteSegment,
  screenRoutePathToUrl,
  SCREEN_SLUG_PATH_SEPARATOR_MESSAGE,
  screenSlugHasPathSeparator,
  type ConsoleSeoFieldValues,
  type ScreenRouteNode,
  type ScreenUid,
} from '@aglyn/aglyn'
import {
  SCREEN_SEO_LISTING_FIELDS,
  SCREEN_SEO_CARD_TEXT_FIELDS,
  SEO_LISTING_FIELDS,
  seoListingFieldCount,
  seoListingFieldTooLong,
  type ScreenSeoCardTextField,
} from '@aglyn/aglyn/app-utils/seo-listing-fields'
import {
  hasSeoTitleVariables,
  resolveSeoTitleVariables,
  SEO_TITLE_VARIABLES,
} from '@aglyn/aglyn/app-utils/seo-title-variables'
import {
  ICON_VARIANT_BESIGNER,
  ICON_VARIANT_DATE_TIME,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_PRIMARY_KEY,
  ICON_VARIANT_SYMBOL_SECURE,
  ICON_VARIANT_TEXT,
} from '@aglyn/shared-data-enums'
import { mdiChevronDown, mdiChevronUp } from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  Container,
  GridItems,
  MdiIcon,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { VariableTextField } from '@aglyn/shared-ui-jsx/components/variable-text-field.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
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
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useHostCampaigns,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import CampaignPicker from '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component'
import ScreenAnalyticsCard from '../../../../../../../../../../components/analytics/screen-analytics-card.component'
import AuthenticatedLayout from '../../../../../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../../../../../components/layouts/main.layout'
import SecondaryNavBarComponent from '../../../../../../../../../../components/secondary-nav-bar.component'
import ScreenSocialImageField, {
  type ScreenSocialImageDraft,
} from '../../../../../../../../../../components/screen-social-image-field.component'
import revalidateLivePages, {
  describeRevalidateShortfall,
} from '../../../../../../../../../../utils/revalidate-live-pages'
import HostDisplayNameComponent from '../../../../../../../../../../components/host-display-name.component'
import { hasEntitlement } from '../../../../../../../../../../constants/entitlements'
import { buildScreenSeoUpdate } from '../../../../../../../../../../constants/screen-seo'
import { buildRoute, Route } from '../../../../../../../../../../constants/route-links'
import { useHostId, useHostSubdomain } from '../../../../../../../../../../components/host-id-provider'
import DocumentPresenceLive from '../../../../../../../../../../components/document-presence-live.component'
import { useOrgSlug } from '../../../../../../../../../../hooks/use-org-scope'
import { resolveScreenLiveUrl } from '../../../../../../../../../../constants/tenant-links'
import {
  publishScreenRoute,
  unpublishScreenRoute,
} from '../../../../../../../../../../constants/screen-publishing'
import { announceLiveScreenChange } from '../../../../../../../../../../constants/screen-live-announce'
import PluginWidgetSlot from '../../../../../../../../../../components/plugin-widget-slot.component'
import {
  CONTENT_MAX_WIDTH,
  TABLE_PAGE_SIZE_DEFAULT,
} from '../../../../../../../../../../constants/shared'
import { docsHelp } from '../../../../../../../../../../constants/docs-links'
import UsedByCard from '../../../../../../../../../../components/used-by-card.component'
import ArtifactDeleteConfirmDescription, {
  fetchArtifactUsage,
} from '../../../../../../../../../../components/artifacts/artifact-delete-confirm.component'
import {
  collectionTemplatePublishMessage,
  collectionTemplateRoutesSummary,
} from '../../../../../../../../../../constants/collection-templates'
import useCollectionTemplates from '../../../../../../../../../../hooks/use-collection-templates'
import useCurrentOrg from '../../../../../../../../../../hooks/use-current-org'
import useFirestoreCollection from '../../../../../../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../../../../../../hooks/use-firestore-doc'
import useHostActivityLogger from '../../../../../../../../../../hooks/use-host-activity-logger'
import useHostRole from '../../../../../../../../../../hooks/use-host-role'
import { useDeclareDocumentSubject } from '../../../../../../../../../../components/document-subject'

const whiteSpace = '--'

/** Visibility options (page permissions, AGL-113). Members/password rows
 * Explain where enforcement lives so the select never overpromises.
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

/**
 * The two card widths in the detail band, as `GridItems masonry` reads them
 * (AGL-2486).
 *
 * The band is three columns wide at `lg` and the two columns are NOT equal.
 * `masonry` buckets items by their `size`, so these two values ARE the
 * arrangement: every `CARD_WIDE` card stacks in one column two thirds across,
 * every `CARD_NARROW` card stacks in the other. Each column is a flex stack at
 * natural heights, so a short card is never stretched to match a tall
 * neighbor.
 *
 * ## The assignment favors legibility over packing, on purpose
 *
 * `Basic Details`, `Publishing` and `Page Access` are narrow, in that order;
 * `SEO` and `Versions` are wide; `Page Activity` is full width in a band of
 * its own.
 *
 * On packing alone that is the wrong way round, and the measurements are
 * recorded here so nobody "corrects" it back with a tape measure. `SEO` gets
 * TALLER as it widens — measured on this page in Chrome, 738px at a 354px
 * column, 764px at 480px, 857px at 732px, 989px at 984px — because it is
 * dominated by a fixed-aspect social-image preview that scales with the card,
 * so putting it in the wide column costs band height. It stays wide anyway: a
 * cramped image preview and truncated form fields read worse than a taller
 * band does. Shortening the band by narrowing `SEO` is not a fix.
 *
 * ORDER inside a bucket is source order, so the authored order of the three
 * narrow items IS the rendered column order. Moving one changes the layout.
 *
 * The widths collapse with the viewport, so nothing ever spans more columns
 * than exist: two equal columns at `md`, one at `xs`, where the cards read in
 * the authored order.
 */
const CARD_WIDE = { xs: 12, md: 6, lg: 8 } as const
const CARD_NARROW = { xs: 12, md: 6, lg: 4 } as const

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
  const { org, orgId, ready: orgReady } = useCurrentOrg()
  const logActivity = useHostActivityLogger(hostId)
  /**
   * The `author` host role edits content and may NOT publish it (AGL-2334).
   * The rules have always refused it; this page invited the click anyway and
   * answered with a raw `permission-denied`. Controls are DISABLED with a
   * reason rather than hidden — a button that vanishes reads as a bug, and
   * `canPublishHost` exists precisely "so the console can say no with a
   * message".
   */
  const { canPublish, loaded: hostRoleLoaded } = useHostRole(hostId)
  const publishBlock = hostRoleLoaded
    ? 'Your role on this site can edit content but not publish it'
    : 'Checking your access…'

  const screenRef = doc(firestore, 'hosts', hostId, 'screens', screenId)
  const {
    status,
    data: screen,
    /**
     * The screen doc both editors below are seeded from is unconfirmed by the
     * server (AGL-1358). The rename writes `description` on every save even
     * when only the name was retyped, and the SEO panel writes the whole
     * `seo` MAP — a nested map value replaces atomically, so `updateDoc`
     * protects the screen's other fields and nothing inside `seo`. The
     * carried-forward `image`, `imageWidth`, `imageHeight` and `breadcrumb`
     * come off this same seed (AGL-1337), so a cached read reinstates that
     * snapshot's social card while the author thought they were editing a
     * title.
     */
    fromCache: screenFromCache,
  } = useFirestoreDoc<any>(
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
        /*
         * ORDERED, and the `limit` is a cap on that order (AGL-2501's rule,
         * the eighth time this shape has come up).
         *
         * `limit(50)` alone is not "the fifty newest": Firestore answers it in
         * document-id order and a version id is generated, so the window was a
         * pseudo-random fifty of the collection which the `useMemo` below then
         * sorted. The rows looked right — a believable descending list — and
         * were simply the wrong rows, with the missing ones leaving no gap to
         * notice. Paging the card is what would have made that visible, on a
         * screen with more than fifty versions.
         *
         * Safe to add: every one of the 248 screen version documents in the
         * estate carries `createdAt`, and a document missing an `orderBy`
         * field is one Firestore drops from the answer entirely.
         */
        orderBy('createdAt', 'desc'),
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

  /*
   * A PAGE of versions, on the console's own pagination control.
   *
   * The card drew all fifty — the query's own ceiling — as one unbroken run of
   * rows, each with four actions on it. A screen that has been edited for a
   * year is a card taller than everything else on the page put together, and
   * the reader's way to the oldest version was the scrollbar.
   *
   * Sliced here rather than in the query: fifty documents are already read and
   * already on this client for the restore picker below, so paging the read
   * would cost a round trip to hide rows we are holding anyway.
   *
   * `ListPagination` is the one footer (AGL-2501) — same page sizes, same
   * count line and same rows-per-page menu as every other list in the console.
   */
  const [versionsPage, setVersionsPage] = useState(0)
  const [versionsPageSize, setVersionsPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const pagedVersions = useMemo(
    () =>
      versions.slice(
        versionsPage * versionsPageSize,
        versionsPage * versionsPageSize + versionsPageSize,
      ),
    [versions, versionsPage, versionsPageSize],
  )
  // Publishing or deleting a version can leave a reader standing past the last
  // page, which renders as an empty table and no way to read that it is empty
  // because the rows moved rather than because there are none.
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(versions.length / versionsPageSize) - 1)
    if (versionsPage > lastPage) setVersionsPage(lastPage)
  }, [versions.length, versionsPage, versionsPageSize])

  // A collection's list/entry template is published so the compose pipeline
  // picks it up, but it is not a page of the site (AGL-1267) — so nothing
  // here may name the slug it was published under (AGL-1269).
  const { templateScreenIds, routesByScreenId } = useCollectionTemplates(hostId)
  const isCollectionTemplate = templateScreenIds.has(screenId)
  const templateRoutes = collectionTemplateRoutesSummary(
    routesByScreenId.get(screenId),
  )
  const routingMap = hostData?.screens as Record<ScreenUid, string> | undefined
  // AGL-374: slug→path normalization, custom domains, preview links;
  // AGL-1271: templates resolve through the collection that renders them.
  const { url: liveUrl, unavailableReason: liveUnavailableReason } =
    resolveScreenLiveUrl(hostData, screenId, {
      isTemplate: templateScreenIds.has(screenId),
      routes: routesByScreenId.get(screenId),
    })
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
  // flight the honest answer is that we do not know yet (AGL-1261) — and a
  // read the server REFUSED has not settled either, it has been declined, so
  // it must not be reported as an absent screen (AGL-1066).
  const displayName =
    screen?.displayName || (status === 'success' ? 'Not Found' : 'Loading…')
  // The browser tab names THIS document, not just its site (AGL-2486).
  // The server put the id in the title; this swaps in the loaded name.
  useDeclareDocumentSubject(screenId, screen?.displayName)
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
  // A publish that came due on a screen the executor could not give an
  // address to (AGL-1589). Surfaced for the same reason as the one above, and
  // it is the more actionable of the two: the fix is the Slug field directly
  // below this chip.
  const unroutableSchedule =
    screen?.publishSchedule?.status === 'skipped-unroutable'
      ? screen.publishSchedule
      : undefined

  /**
   * The signed-in user, for the id token the where-used scan and the live-page
   * cache drops need.
   *
   * Declared HERE, above the first callback that names it: a `useCallback`
   * dependency array is evaluated during render, so a `const` further down
   * the component is read in its temporal dead zone and throws on the way in
   * — the same trap AGL-2501 hit with `screenQuota` on the screens list.
   */
  const { data: user } = useUser()

  // --- Edit details dialog ---------------------------------------------
  const [editor, setEditor] = useState<{
    displayName: string
    description: string
  } | null>(null)
  const handleEditSave = useCallback(async () => {
    if (!editor?.displayName.trim()) return
    /**
     * Refuse a rename whose seed the server never confirmed (AGL-1358).
     *
     * `description` is written on every save, seeded from the listener, so a
     * pure rename against a cached read rolls it back. The dialog only ever
     * opens on the stored screen, so there is no create path to exempt.
     *
     * The guard WRAPS the write — an early return is a shape you can keep
     * while losing the protection.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'screen details',
        unreadable: status === 'error',
        fromCache: screenFromCache,
      },
      async () => {
        await updateDoc(screenRef, {
          displayName: editor.displayName.trim(),
          // Keep the name-search key in sync on rename (AGL-835) so the
          // switcher's prefix query finds the screen under its new name.
          nameLower: nameSearchKey(editor.displayName.trim()),
          description: editor.description.trim(),
          updatedAt: Timestamp.now(),
        })
          .then(() => {
            enqueueSnackbar('Screen updated', {
              variant: 'success',
              persist: false,
            })
            logActivity('Updated screen details', {
              type: 'screen',
              id: screenId,
              name: editor.displayName.trim(),
            })
            setEditor(null)
            // Not internal-only: the live page's `<title>` falls back to the
            // name, and its meta description to the description, whenever
            // the screen's SEO leaves them blank.
            announceLiveScreenChange({
              user,
              hostId,
              screenId,
              livePath: publishedPath,
              notify: enqueueSnackbar,
            })
          })
          .catch(() =>
            enqueueSnackbar('An error has occurred', { variant: 'error' }),
          )
      },
    )
    // A refusal keeps the dialog open with both typed values.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
  }, [
    editor,
    screenRef,
    enqueueSnackbar,
    logActivity,
    screenId,
    status,
    screenFromCache,
    user,
    hostId,
    publishedPath,
  ])

  // --- Delete -----------------------------------------------------------
  const handleDelete = useCallback(async () => {
    /*
      The scan starts here and the dialog opens in the same tick (AGL-703) —
      the old sentence said what happens to THIS screen and nothing about the
      nav links pointing at it, or a collection rendering its pages through it.
    */
    const scan = (async () =>
      fetchArtifactUsage({
        hostId,
        kind: 'screen',
        id: screenId,
        user,
      }))()
    const confirmed = await confirm({
      title: 'Delete this screen?',
      description: (
        <ArtifactDeleteConfirmDescription
          kind="screen"
          name={displayName}
          scan={scan}
        />
      ),
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
        unpublishScreenRoute(firestore, { hostId, screenId, user }),
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
    user,
    orgSlug,
    host,
  ])

  // --- Publish / unpublish the route ------------------------------------
  const [slugInput, setSlugInput] = useState<string | null>(null)
  const slugValue = slugInput ?? screen?.slug ?? ''
  const handlePublishRoute = useCallback(async () => {
    if (loading) return
    // A `/` typed INSIDE the value (AGL-2572). This field holds the screen's
    // OWN segment — the composed path below adds the ancestors — and
    // `normalizeScreenSlug` reaches one segment by deleting the separator, so
    // `alternatives/webflow` would publish as `alternativeswebflow`. Asked
    // before normalizing, because after it the `/` is gone.
    if (screenSlugHasPathSeparator(slugValue)) {
      return enqueueSnackbar(SCREEN_SLUG_PATH_SEPARATOR_MESSAGE, {
        variant: 'warning',
        persist: false,
      })
    }
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
    // An address the published site cannot answer (AGL-2076). Checked on the
    // COMPOSED path, not the raw slug: `search` under a parent is `docs/search`
    // and serves fine, and only a first segment collides.
    const reserved = reservedScreenRouteSegment(composed ?? slug)
    if (reserved) {
      return enqueueSnackbar(reservedScreenRouteMessage(reserved), {
        variant: 'warning',
        persist: false,
      })
    }
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
        { hostId, screenId, user },
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
    user,
  ])

  const handleUnpublishRoute = useCallback(async () => {
    const dequeue = queueLoading()
    try {
      await unpublishScreenRoute(firestore, { hostId, screenId, user })
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
  }, [
    queueLoading,
    firestore,
    hostId,
    screenId,
    enqueueSnackbar,
    displayName,
    logActivity,
    user,
  ])

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
  // Shared with the besigner's versions panel (AGL-1150). This was the only
  // publish site that dropped a cache; keeping the call in one helper is what
  // stops the next publish surface from quietly forgetting it.
  //
  // Neither the tenant's path cap nor the console's dependent scan can bite on
  // a SCREEN publish, which fans out to exactly one path — but a REFUSED drop
  // can, and that is the case where the live page stays stale for the rest of
  // its window rather than for a moment (AGL-1483). `describeRevalidateShortfall`
  // covers both, so the caller reports whichever applies instead of deciding
  // in advance that nothing can.
  const revalidateLivePage = useCallback(
    async () => {
      const result = await revalidateLivePages({ user, hostId, screenId })
      const shortfall = describeRevalidateShortfall(result)
      if (shortfall) {
        enqueueSnackbar(shortfall, { variant: 'warning', persist: false })
      }
      return result
    },
    [user, hostId, screenId, enqueueSnackbar],
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
      // AGL-1380: `hasEntitlement` on an undefined org answers NO, and `org`
      // is undefined both while the billing doc is in flight and while the
      // read is failing. Clicking inside that window told a Business org
      // that scheduled publishing is not on its plan. Pending declines.
      if (!orgReady) {
        return enqueueSnackbar('Checking your plan — try again in a moment', {
          variant: 'info',
          persist: false,
        })
      }
      if (!hasEntitlement('scheduledPublishing', org)) {
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
    [org, orgReady, enqueueSnackbar, screen, versions],
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
          // Access is decided when the tenant RENDERS the page, from its
          // cached copy of this document: members-only withholds the content,
          // anything but public adds `noindex`, and leaving password mode
          // removes the hash above. The cached page carries the old answer to
          // all three until it is dropped.
          announceLiveScreenChange({
            user,
            hostId,
            screenId,
            livePath: publishedPath,
            notify: enqueueSnackbar,
          })
        })
        .catch(() =>
          enqueueSnackbar('An error has occurred', { variant: 'error' }),
        )
    },
    [
      screen,
      screenRef,
      enqueueSnackbar,
      displayName,
      logActivity,
      screenId,
      user,
      hostId,
      publishedPath,
    ],
  )
  /*==========================================
   * WHICH CAMPAIGNS THIS SCREEN IS PART OF.
   *
   * A landing page belongs to the push it was built for, and often to the
   * next one as well — the same page is re-run for the follow-up rather than
   * copied — so the field is an array and the picker is a multi-select.
   *
   * It is an ASSIGNMENT and not a claim about traffic. What a campaign sent
   * people to is observed from the click reports of its own emails, and that
   * section goes on saying what it says whatever is picked here; nothing in
   * this control credits a visit, a conversion or a sale to a campaign.
   *
   * The write is guarded by the seed for the reason the rename beside it is:
   * the value starts from the stored array, so a cached read could hand back
   * a list that another tab has already added to and the save would drop the
   * addition. A single scalar the author typed does not have that problem; an
   * array they edited does.
   *=========================================*/
  const siteCampaigns = useHostCampaigns(hostId, { enabled: Boolean(screen) })
  const storedCampaignIds = useMemo(
    () => readCampaignIds(screen as Record<string, unknown>),
    [screen],
  )
  const [savingCampaigns, setSavingCampaigns] = useState(false)
  const handleCampaignsChange = useCallback(
    async (next: string[]) => {
      if (campaignMembershipUnchanged(storedCampaignIds, next)) return
      setSavingCampaigns(true)
      const verdict = await writeGuardedBySeed(
        {
          subject: 'campaigns',
          unreadable: status === 'error',
          fromCache: screenFromCache,
        },
        async () => {
          await updateDoc(screenRef, {
            [CAMPAIGN_MEMBERSHIP_FIELD]: campaignMembershipValue(next),
            updatedAt: Timestamp.now(),
          })
          enqueueSnackbar(
            next.length
              ? 'Campaigns updated'
              : 'This screen is no longer in any campaign',
            { variant: 'success', persist: false },
          )
          logActivity('Changed screen campaigns', {
            type: 'screen',
            id: screenId,
            name: displayName,
          })
        },
      ).catch(() => {
        enqueueSnackbar('An error has occurred', { variant: 'error' })
        return { ok: true as const, message: '' }
      })
      setSavingCampaigns(false)
      if (!verdict.ok) {
        enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
      }
    },
    [
      storedCampaignIds,
      screenRef,
      status,
      screenFromCache,
      enqueueSnackbar,
      logActivity,
      screenId,
      displayName,
    ],
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
        // The tenant withholds a protected page's content when it RENDERS
        // the page, from a cached copy of this document, and checks passwords
        // against that same copy — so until this drops them, a page protected
        // just now keeps serving publicly and an old password keeps working.
        announceLiveScreenChange({
          user,
          hostId,
          screenId,
          livePath: publishedPath,
          notify: enqueueSnackbar,
        })
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [password, screenRef, enqueueSnackbar, user, hostId, screenId, publishedPath])

  // --- SEO (AGL-117): screen fields override host defaults on the org --
  const [seoDraft, setSeoDraft] = useState<Record<
    ScreenSeoCardTextField,
    string
  > | null>(null)
  const seoValue: Record<ScreenSeoCardTextField, string> = {
    title: seoDraft?.title ?? screen?.seo?.title ?? '',
    description: seoDraft?.description ?? screen?.seo?.description ?? '',
    breadcrumb: seoDraft?.breadcrumb ?? screen?.seo?.breadcrumb ?? '',
  }
  const setSeoValue = (field: ScreenSeoCardTextField, value: string) =>
    setSeoDraft({ ...seoValue, [field]: value })
  const setSeoField = (field: ScreenSeoCardTextField) =>
    (event: { target: { value: string } }) => setSeoValue(field, event.target.value)

  /**
   * The title as the live page will render it (AGL-3197).
   *
   * A written title may name variables, so what the author typed and what a
   * search result shows are two different strings — and the one worth counting
   * against sixty characters is the second. Resolved against THIS host's own
   * site title and separator, which is the whole reason the variables are
   * worth having: the preview is where an author sees that `{{site.name}}` is
   * forty-nine characters on this site before they publish a title that runs
   * off the end of a search result.
   */
  const resolvedSeoTitle = resolveSeoTitleVariables(seoValue.title, {
    'page.name': screen?.displayName ?? '',
    'site.name': hostData?.seo?.title ?? hostData?.displayName ?? '',
    'site.separator': hostData?.seo?.separator ?? '',
  })
  const titleHelperText = hasSeoTitleVariables(seoValue.title)
    ? `${seoListingFieldCount('title', resolvedSeoTitle)} — renders as “${resolvedSeoTitle}”`
    : `${seoListingFieldCount('title', seoValue.title)} — published verbatim; the site title is not appended. Add a variable to keep it in step with Host setup → SEO.`
  /**
   * Staged social image (AGL-1368); `null` = untouched, `''` = cleared. Kept
   * separate from `seoDraft` so picking an image does not stage the title and
   * description as edits, and so either can be saved on its own.
   */
  const [seoImage, setSeoImage] = useState<ScreenSocialImageDraft | null>(null)
  /** The social image the card shows: the staged pick, else the stored one. */
  const seoImageRef = seoImage != null ? seoImage.image : (screen?.seo?.image ?? '')

  /**
   * Values a `seoFields` widget proposes (AGL-2910), staged exactly as typing
   * would stage them: the text fields into the draft, the image description
   * into the image group — which moves as one, so it is staged beside the
   * reference and size the card already shows, and only when there is an
   * image to describe. Nothing is written; Save SEO is still the write.
   */
  const proposeSeoValues = useCallback(
    (values: ConsoleSeoFieldValues) => {
      const text: Partial<Record<ScreenSeoCardTextField, string>> = {}
      for (const field of SCREEN_SEO_CARD_TEXT_FIELDS) {
        if (typeof values[field] === 'string') text[field] = values[field]
      }
      if (Object.keys(text).length) {
        setSeoDraft((prior) => ({
          title: prior?.title ?? screen?.seo?.title ?? '',
          description: prior?.description ?? screen?.seo?.description ?? '',
          breadcrumb: prior?.breadcrumb ?? screen?.seo?.breadcrumb ?? '',
          ...text,
        }))
      }
      if (typeof values.imageAlt === 'string') {
        setSeoImage((prior) => {
          const image = prior != null ? prior.image : (screen?.seo?.image ?? '')
          if (!image) return prior
          return {
            image,
            imageWidth: prior != null ? prior.imageWidth : (screen?.seo?.imageWidth ?? 0),
            imageHeight: prior != null ? prior.imageHeight : (screen?.seo?.imageHeight ?? 0),
            imageAlt: values.imageAlt,
          }
        })
      }
    },
    [screen],
  )

  /**
   * View of the stored document — useful, but it was several hundred pixels of
   * machine text sitting between the reader and the bottom of the page.
   *
   * Deliberately NOT persisted. Nothing else in the console remembers a card's
   * open state, and a preference store nobody asked for is not what to add the
   * day before freeze. Every load starts closed.
   */
  const [rawJsonOpen, setRawJsonOpen] = useState(false)
  const handleSeoSave = useCallback(async () => {
    if (!seoDraft && !seoImage) return
    /**
     * Carry forward everything this panel does not edit (AGL-1337), now
     * shared with the besigner's SEO panel (AGL-1437).
     *
     * This used to build a fresh `seo` map from its own three fields and
     * write it whole — so saving a title here silently deleted `breadcrumb`,
     * and would now also delete the `imageWidth`/`imageHeight` the social
     * image picker stores beside the reference, leaving a card that names an
     * image but cannot say how big it is. A panel that edits two fields must
     * write two fields.
     *
     * The rules moved into `buildScreenSeoUpdate` because the besigner's copy
     * of this handler did NOT follow them: it defaulted the social-image
     * triple to `''`/`0`/`0` and invented three keys on every description
     * save. One function is what keeps the two from drifting again.
     */
    const seo = buildScreenSeoUpdate(screen?.seo as Record<string, unknown>, {
      title: seoDraft?.title,
      description: seoDraft?.description,
      breadcrumb: seoDraft?.breadcrumb,
      image: seoImage,
    })
    /**
     * Refuse a save whose seed the server never confirmed (AGL-1358).
     *
     * AGL-1337 fixed the half of this that was unconditional — the panel no
     * longer builds a fresh map — but carrying `existing` forward is exactly
     * what makes it this issue's shape: `existing` is `screen?.seo` off the
     * same listener, and `updateDoc` REPLACES a nested map, so a cached read
     * reinstates that snapshot's `image`, `imageWidth`, `imageHeight` and
     * `breadcrumb` while the author thought they were editing a title. The
     * empty branch is worse still: `seo: deleteField()` removes the map.
     *
     * The guard WRAPS the write — an early return is a shape you can keep
     * while losing the protection.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'SEO settings',
        unreadable: status === 'error',
        fromCache: screenFromCache,
      },
      async () => {
        await updateDoc(
          screenRef,
          seo
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
            setSeoImage(null)
            // The live page's head is rendered from this document, and the
            // tenant caches both — so the old title and description stay in
            // the served HTML until this drops them.
            announceLiveScreenChange({
              user,
              hostId,
              screenId,
              livePath: publishedPath,
              notify: enqueueSnackbar,
            })
          })
          .catch(() =>
            enqueueSnackbar('An error has occurred', { variant: 'error' }),
          )
      },
    )
    // A refusal leaves the staged title, description and image where they
    // are, with Save SEO still live.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
  }, [
    seoDraft,
    seoImage,
    screen,
    screenRef,
    enqueueSnackbar,
    displayName,
    logActivity,
    screenId,
    status,
    screenFromCache,
    user,
    hostId,
    publishedPath,
  ])

  /**
   * ONE Save SEO control, rendered in two places on its card — the header's
   * action slot and the foot of the content.
   *
   * Written once rather than twice because the two must never disagree about
   * whether there is anything staged: `!seoDraft && !seoImage` is also
   * `handleSeoSave`'s own early return, so a second copy that drifted would
   * offer a live-looking button that does nothing.
   */
  const seoSaveButton = (
    <Button
      size="small"
      variant="outlined"
      color="primary"
      disabled={!seoDraft && !seoImage}
      onClick={handleSeoSave}
      sx={{ alignSelf: 'flex-start' }}
    >
      {'Save SEO'}
    </Button>
  )

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
        help={{
          topic: 'versionsAndPublishing',
        }}
        header={{
          children: displayName,
          icon: { path: ICON_VARIANT_PAGES.path },
        }}
        // Presence leads the actions, beside the button that would join the
        // is made. This page WATCHES without announcing: a detail page that
        // joined on arrival would report everybody browsing as an editor and
        // destroy the signal it exists to give.
        //
        // Unlike the other four detail pages, this one's version comes
        // straight from the route, so the room it watches is exactly the one
        // Open Besigner opens — no resolution, no guess.
        headerRight={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <DocumentPresenceLive
              hostId={hostId}
              docType="screen"
              docId={screenId}
              versionId={versionId}
            />
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
            ) : liveUnavailableReason ? (
              <Tooltip title={liveUnavailableReason}>
                {/* span: a disabled button emits no events for the tooltip */}
                <span>
                  <Button size="small" variant="outlined" disabled>
                    {'View'}
                  </Button>
                </span>
              </Tooltip>
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
              disabled={!screen}
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
          {/* MASONRY (AGL-2486). Without `masonry` this is a twelve-column
              flex ROW, in which every item is as tall as the tallest one
              beside it — measured here, `Page Activity` sits in a 741px row
              cell carrying a 278px card, a 463px hole, and the two rows
              together waste 898px. With it, each width becomes a COLUMN that
              stacks its own cards at their natural heights, and a short card
              beside a tall one costs nothing.

              `CARD_WIDE`/`CARD_NARROW` above are the whole arrangement: two
              thirds and one third of a three-column band, with the widths
              chosen from measured card behavior. `Versions` and `Raw JSON`
              declare a full width, which `masonry` gives a band of its own —
              so they stay full width BELOW the band rather than being pulled
              into a column, and the authored reading order survives. */}
          <GridItems
            spacing={3}
            masonry
            items={[
              {
                size: CARD_NARROW,
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
                size: CARD_NARROW,
                children: (
                  <CardDisplay
                    header={'Publishing'}
                    help={docsHelp('versionsAndPublishing', { anchor: '#scheduled-publishing', excerpt: 'Publish this screen live now or schedule a version to go live at a set time.' })}
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
                        {unroutableSchedule ? (
                          <Tooltip
                            title={
                              'The scheduled publish ran, but this screen has ' +
                              'no address it could be published at — its slug ' +
                              "(or a parent page's) is missing, or another " +
                              'screen is already published at that path. Set ' +
                              'the slug below, publish or fix the parent, ' +
                              'then schedule it again.'
                            }
                          >
                            <Chip
                              label="Did not publish — no available address"
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
                        <Tooltip title={canPublish ? '' : publishBlock}>
                          <span>
                            <Button
                              size="small"
                              variant="contained"
                              color="primary"
                              disabled={!canPublish}
                              onClick={handlePublishRoute}
                            >
                              {isRoutePublished ? 'Update route' : 'Publish'}
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip title={canPublish ? '' : publishBlock}>
                          <span>
                            <Button
                              size="small"
                              disabled={!isRoutePublished || !canPublish}
                              onClick={handleUnpublishRoute}
                            >
                              {'Unpublish'}
                            </Button>
                          </span>
                        </Tooltip>
                        <Tooltip
                          title={
                            canPublish
                              ? 'Make a version live at a date/time'
                              : publishBlock
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              color="primary"
                              disabled={!canPublish}
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
                size: CARD_NARROW,
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
                // What breaks if this screen goes (AGL-703). On demand, like
                // the media library's own audit: the scan reads every screen,
                // layout and component on the site, which is not a cost to
                // pay on every visit to a detail page.
                size: CARD_NARROW,
                children: (
                  <UsedByCard
                    hostId={hostId}
                    kind="screen"
                    id={screenId}
                    noun="screen"
                  />
                ),
              },
              {
                size: CARD_NARROW,
                children: (
                  <CardDisplay
                    header={'Campaigns'}
                    help={docsHelp('emailCampaigns', {
                      anchor: '#what-belongs-to-a-campaign',
                      excerpt:
                        'A campaign groups the landing pages, forms and ' +
                        'contacts a push runs across, as well as its emails.',
                    })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                  >
                    <Stack spacing={1.5}>
                      <CampaignPicker
                        options={siteCampaigns.options}
                        value={storedCampaignIds}
                        onChange={(next) => void handleCampaignsChange(next)}
                        disabled={savingCampaigns}
                        helperText="The campaigns this page is part of. It does not change how visits are credited."
                        empty={
                          siteCampaigns.ready && !siteCampaigns.options.length
                        }
                      />
                      {/*
                        Said here because the picker is the place somebody
                        would expect it to be otherwise. Filing a page under a
                        campaign groups it; what a campaign is CREDITED with
                        is read from the links its own emails carried, and
                        nothing on this card changes that reading.
                      */}
                      <Typography variant="caption" color="text.secondary">
                        {'Assignment only. A campaign’s traffic and revenue ' +
                          'are credited from the links its emails carried, ' +
                          'not from this list.'}
                      </Typography>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: CARD_WIDE,
                children: (
                  <CardDisplay
                    header={'SEO'}
                    help={docsHelp('seo', { anchor: '#per-screen-seo', excerpt: 'Per-screen search title, description, and social share image \u2014 overrides the site defaults.' })}
                    contentGutterX
                    contentGutterY
                    contentBordered="all"
                    /* The same save, in the header's action slot as well as at
                       the foot of the card. This card is tall \u2014 six inputs, a
                       social image picker and the Write-with-AI panel \u2014 so
                       from the top of it the only control that commits any of
                       it is off screen, and the AI panel's own "Write SEO"
                       button is the one in view. Both render the same
                       `seoSaveButton`, so they cannot disagree about whether
                       there is anything to save. */
                    HeaderProps={{ action: seoSaveButton }}
                  >
                    <Stack spacing={1.5}>
                      {/* The inputs and their lengths come from the one SEO
                          field catalog (AGL-2910), which the besigner's panel
                          and every proposer read too. */}
                      {SCREEN_SEO_CARD_TEXT_FIELDS.map((field) =>
                        /*
                         * The title takes variables (AGL-3197), so it is the
                         * one field with an insert control and a preview. The
                         * rest are plain: a description is prose, and a
                         * breadcrumb label is a word.
                         */
                        field === 'title' ? (
                          <VariableTextField
                            key={field}
                            size="small"
                            label={SEO_LISTING_FIELDS[field].label}
                            value={seoValue[field]}
                            onChange={(next) => setSeoValue(field, next)}
                            variables={SEO_TITLE_VARIABLES}
                            insertLabel="Insert a variable"
                            helperText={titleHelperText}
                            // The RESOLVED length, because that is what a
                            // search result truncates. `{{site.name}}` is
                            // thirteen characters of written title and however
                            // many the site is called; counting the written
                            // form would flag a title that fits and pass one
                            // that does not.
                            error={seoListingFieldTooLong(field, resolvedSeoTitle)}
                          />
                        ) : (
                          <TextField
                            key={field}
                            size="small"
                            label={SEO_LISTING_FIELDS[field].label}
                            value={seoValue[field]}
                            onChange={setSeoField(field)}
                            multiline={SEO_LISTING_FIELDS[field].multiline}
                            minRows={SEO_LISTING_FIELDS[field].multiline ? 2 : undefined}
                            helperText={
                              field === 'breadcrumb'
                                ? `${seoListingFieldCount(field, seoValue[field])} — the page’s name in a breadcrumb trail`
                                : seoListingFieldCount(field, seoValue[field])
                            }
                            error={seoListingFieldTooLong(field, seoValue[field])}
                          />
                        ),
                      )}
                      {/* The same field the besigner's Screen Properties ▸
                          SEO panel uses (AGL-1368), not a second one: the
                          docs have always sent people here for all three
                          fields, and this is where they look. A media PICK,
                          not a URL you type (AGL-1337) — the reference is
                          stored by identity so it survives a folder move, and
                          the picker records the asset's dimensions alongside
                          it so the head can emit `og:image:width`/`height`. */}
                      <ScreenSocialImageField
                        hostId={hostId}
                        saved={screen?.seo?.image}
                        // The alt and the dimensions travel WITH the
                        // reference (AGL-2417): editing the description
                        // restages the whole group, so the field needs the
                        // stored size or a save would drop it.
                        savedAlt={screen?.seo?.imageAlt}
                        savedWidth={screen?.seo?.imageWidth}
                        savedHeight={screen?.seo?.imageHeight}
                        value={seoImage}
                        onChange={setSeoImage}
                      />
                      {/* Plugin zone (AGL-2910): a widget here proposes values
                          for the fields above and never writes them — what it
                          proposes is staged like typing, and Save SEO below is
                          still the only write. */}
                      <PluginWidgetSlot
                        slot="seoFields"
                        hostId={hostId}
                        orgId={orgId}
                        orgSlug={orgSlug}
                        subject={{
                          kind: 'screen',
                          id: screenId,
                          versionId: versionId ?? null,
                          name: String(screen?.displayName ?? ''),
                        }}
                        fields={SCREEN_SEO_LISTING_FIELDS}
                        values={{
                          ...seoValue,
                          imageAlt:
                            seoImage != null
                              ? (seoImage.imageAlt ?? '')
                              : (screen?.seo?.imageAlt ?? ''),
                        }}
                        hasImage={Boolean(seoImageRef)}
                        proposeValues={proposeSeoValues}
                      />
                      {seoSaveButton}
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                size: CARD_WIDE,
                children: (
                  <CardDisplay
                    header={'Versions'}
                    help={docsHelp('versionsAndPublishing', { anchor: '#publish--roll-back', excerpt: 'Every publish is a version you can view, restore, or schedule.' })}
                    contentBordered="all"
                  >
                    <ScrollTable size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{'Version'}</TableCell>
                          <TableCell>{'Created'}</TableCell>
                          <TableCell align="right">{'Actions'}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {pagedVersions.map((version) => {
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
                                <Tooltip title={canPublish ? '' : publishBlock}>
                                  <span>
                                    <Button
                                      size="small"
                                      color="primary"
                                      disabled={isLive || !canPublish}
                                      onClick={handlePublishVersion(version.$id)}
                                    >
                                      {'Publish now'}
                                    </Button>
                                  </span>
                                </Tooltip>
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
                    </ScrollTable>
                    <ListPagination
                      page={versionsPage}
                      pageSize={versionsPageSize}
                      rowCount={pagedVersions.length}
                      count={versions.length}
                      onPageChange={setVersionsPage}
                      onPageSizeChange={setVersionsPageSize}
                    />
                  </CardDisplay>
                ),
              },
              {
                // Per-screen traffic (AGL-152), deliberately ABOVE Page
                // Activity: what the page is DOING outranks who touched it,
                // and the activity feed is an unbounded list that pushes the
                // chart off the screen when it comes first. `Raw JSON` sits
                // below both.
                size: { xs: 12 },
                children: (
                  <ScreenAnalyticsCard hostId={hostId} screenId={screenId} />
                ),
              },
              {
                size: { xs: 12 },
                // FULL WIDTH, in a band of its own below the columns.
                // `masonry` gives every full-width item its own band, so this
                // size is what puts the activity feed under the two columns
                // rather than inside one of them.
                //
                // The slot renders an empty fragment when no activity plugin
                // is entitled, and `GridItems masonry` drops the item wrapper
                // via `:empty` — otherwise an absent widget would leave a
                // band-sized gap here.
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
                // LAST card on the page, and CLOSED by default (AGL-2486).
                //
                // The collapse is MUI's `Collapse` behind a chevron in the
                // card header \u2014 the same pattern the assist panel and the
                // interaction builder already use, rather than a new one.
                // `unmountOnExit` matters twice over: the `<pre>` is not in
                // the DOM at all while closed, so a large screen document
                // costs nothing to render, and the closed card measures as a
                // plain header rather than reporting a placeholder height the
                // way `content-visibility` would.
                size: { xs: 12 },
                children: (
                  <CardDisplay
                    header={'Raw JSON'}
                    help={docsHelp('screens', { excerpt: 'The screen document as stored \u2014 a read-only developer view of its structure.' })}
                    // Gutters and the content border belong to the CONTENT, so
                    // they come off with it. Left on, a closed card draws an
                    // empty bordered strip under its header \u2014 42px of nothing
                    // that reads as a rendering fault rather than a collapsed
                    // card.
                    contentGutterX={rawJsonOpen}
                    contentGutterY={rawJsonOpen}
                    contentBordered={rawJsonOpen ? 'all' : undefined}
                    HeaderProps={{
                      action: (
                        <IconButton
                          size="small"
                          onClick={() => setRawJsonOpen((prior) => !prior)}
                          aria-expanded={rawJsonOpen}
                          aria-label={
                            rawJsonOpen ? 'Hide raw JSON' : 'Show raw JSON'
                          }
                        >
                          <MdiIcon
                            path={
                              rawJsonOpen
                                ? mdiChevronUp.path
                                : mdiChevronDown.path
                            }
                          />
                        </IconButton>
                      ),
                    }}
                  >
                    <Collapse in={rawJsonOpen} unmountOnExit>
                      <pre
                        style={{
                          margin: 0,
                          maxHeight: 360,
                          overflow: 'auto',
                        }}
                      >
                        {JSON.stringify(screen, null, 2)}
                      </pre>
                    </Collapse>
                  </CardDisplay>
                ),
              },
            ]}
          />
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
