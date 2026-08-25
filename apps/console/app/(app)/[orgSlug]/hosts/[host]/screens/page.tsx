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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn'
import {
  billableScreenIds,
  buildScreenRouteEntries,
  composeScreenRoutePath,
  createResourceUid,
  decodeStoredNodes,
  findScreenIdByRoutePath,
  formatQuotaLimit,
  normalizeScreenSlug,
  reservedScreenRouteMessage,
  reservedScreenRouteSegment,
  screenRoutePathToUrl,
  wouldCreateScreenCycle,
  type ScreenRouteNode,
  type ScreenUid,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_CLOSE,
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_SHOW_DETAIL,
  ICON_VARIANT_BESIGNER,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  AppLinkNakedLinkProps,
  Container,
  SrOnly,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  mdiBookmarkOutline,
  mdiOpenInNew,
  mdiTranslate,
} from '@aglyn/shared-data-mdi'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteField,
  doc,
  getDoc,
  limit,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useHostResourceApi,
  useHostVersionApi,
} from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from '../../../../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../../../../components/auth-form-template.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import RowActionsMenu from '../../../../../../components/row-actions-menu.component'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import { ArtifactRowActions } from '../../../../../../components/artifacts/artifact-table.component'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import SaveAsTemplateDialog, {
  type SaveAsTemplateSource,
} from '../../../../../../components/templates/save-as-template-dialog.component'
import TemplateGalleryDialog from '../../../../../../components/templates/template-gallery-dialog.component'
import {
  compareScreenSiblings,
  ScreensHierarchyTableComponent,
  type ScreenHierarchyRow,
  type ScreenMoveRequest,
} from '../../../../../../components/screens-hierarchy-table.component'
import { checkOrgQuota } from '../../../../../../constants/entitlements'
import { docsHelp } from '../../../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import DocumentPresenceChips from '../../../../../../components/document-presence-chips.component'
import usePresenceSummary from '../../../../../../hooks/use-presence-summary'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import { resolveScreenLiveUrl } from '../../../../../../constants/tenant-links'
import {
  publishScreenRoute,
  syncScreenRouteEntries,
  unpublishScreenRoute,
} from '../../../../../../constants/screen-publishing'
import { CONTENT_MAX_WIDTH } from '../../../../../../constants/shared'
import useCollectionTemplates from '../../../../../../hooks/use-collection-templates'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import useFirestoreCollection from '../../../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../../../hooks/use-firestore-doc'
import useHostActivityLogger from '../../../../../../hooks/use-host-activity-logger'

const CellItemLinkComponent = forwardRef<any, AppLinkNakedLinkProps>(
  (props, ref) => {
    return <AppLink ref={ref} {...props} componentVariant={'naked'} />
  },
)
CellItemLinkComponent.displayName = 'CellItemLinkComponent'

function Screens(props) {
  const params = useParams<{ hostId: string }>()
  const orgSlug = useOrgSlug()
  const router = useRouter()
  const host = useHostSubdomain()
  const hostId = useHostId()
  const { queueLoading, loading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [quickDrawerOpen, setQuickDrawerOpen] = useState<boolean>(false)
  const handleFormOpen = useCallback(() => {
    setQuickDrawerOpen(true)
  }, [])
  const handleFormClose = useCallback(() => {
    setQuickDrawerOpen(false)
  }, [])
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  // The hierarchy table renders the whole tree, so no page-sized query: a
  // paginated slice could orphan children whose parent fell off the page.
  const { status, data } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const screens: ScreenHierarchyRow[] = useMemo(
    // Email screens (kind 'email') have their own list on the Emails page
    // (AGL-395), so keep them out of the site's page hierarchy here.
    () =>
      (data ?? []).filter(
        (screen: any) => !screen.deletedAt && screen.kind !== 'email',
      ),
    [data],
  )
  // A content collection's ENTRY template serves every entry from one screen
  // at no URL of its own, so it doesn't spend the plan's screen allowance
  // (AGL-1173) — and, since AGL-1267, it is not a page of the site at all. Its
  // LIST template is the opposite on both counts: `/{collectionSlug}` renders
  // that screen, so it is a page and it is billable (AGL-1387). All three
  // answers come from the same read of the collections, shared with the
  // publish surfaces (AGL-1269); this precheck stays in step with the server's
  // countBillableScreens, because a client that warns on a different number
  // than the API enforces is worse than no precheck at all.
  const collectionTemplates = useCollectionTemplates(hostId)
  const { data: hostData } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const routingMap = hostData?.screens as Record<ScreenUid, string> | undefined
  // Counted off the UNFILTERED `data` by THE server's rule, not by a copy of
  // it (AGL-2093). The `screens` list above drops soft-deleted and email
  // documents for the hierarchy table, which is the right filter for a table
  // and the wrong one for a quota, so this maps the raw rows into the shape
  // `billableScreenIds` reads and asks it.
  //
  // It used to restate the rule — routed-first (AGL-1383), minus templates
  // (AGL-1400) — with a comment saying a precheck that warns on a different
  // number than the API enforces is worse than no precheck at all. It then
  // drifted anyway: the restatement never learned AGL-2093's error-screen
  // bound, so on a host holding five `kind: 'error'` screens this offered room
  // /api/hosts/resources refused. The rule moved to `screen-route.ts` (which
  // the client barrel exports) so there is nothing left to restate.
  const billableScreenCount = useMemo(
    () =>
      billableScreenIds(
        (data ?? []).map((screen: any) => ({
          id: screen.$id,
          kind: screen.kind,
          deletedAt: screen.deletedAt,
        })),
        routingMap,
      ).size,
    [data, routingMap],
  )
  const screensById = useMemo(() => {
    const map: Record<ScreenUid, ScreenRouteNode> = {}
    for (const screen of screens) {
      map[screen.$id] = { slug: screen.slug, parentId: screen.parentId }
    }
    return map
  }, [screens])
  const { enqueueSnackbar, closeSnackbar } = useSnackbar()
  const { org, ready: orgReady } = useCurrentOrg()
  const logActivity = useHostActivityLogger(hostId)

  const [error, setError] = useState(null)

  useEffect(() => {
    if (status === 'error') {
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [status])

  const handleFormSubmit = useCallback(
    async (values) => {
      if (loading) return
      if (error) setError(null)
      // AGL-1422: "once the org has an explicit plan" is exactly what an
      // undefined `org` does NOT mean — `checkOrgQuota` reads it as the FREE
      // tier, so a submit inside the loading window quoted the free screen
      // limit to a paying site and DROPPED the screen it was creating.
      // Pending declines and says only that it is still checking.
      if (!orgReady) {
        return enqueueSnackbar('Checking your plan — try again in a moment', {
          variant: 'info',
          persist: false,
        })
      }
      // Plan quota (AGL-39): enforced once the org has an explicit plan.
      const quota = checkOrgQuota(org, 'screensPerHost', billableScreenCount)
      if (!quota.allowed) {
        return enqueueSnackbar(
          // `formatQuotaLimit`, not the raw number: `UNLIMITED` is
          // `Number.POSITIVE_INFINITY`, so an uncapped plan that ever reached
          // this branch would read "Screen limit reached (Infinity)".
          `Screen limit reached (${formatQuotaLimit(quota.limit)}) — see ` +
            'Billing to upgrade',
          { variant: 'warning', persist: false },
        )
      }
      const dequeueLoading = queueLoading()
      const newId = createResourceUid()
      const newVersionId = createResourceUid()
      const timestamp = Timestamp.now()
      const { slug: slugInput, ...fields } = values

      // Publishing is what makes the screen reachable: the org matches
      // request paths against the host's `screens` routing map, so the slug
      // must both live on the screen doc and be registered in that map.
      const path = normalizeScreenSlug(slugInput)
      // A handful of addresses the published site cannot answer, whatever the
      // routing map says (AGL-2076) — refused BEFORE the conflict read, since
      // no amount of the host's own state changes the answer. Without this the
      // page was created, published, listed as live, and served the framework's
      // own `404.html`; the only way to find out was to curl for
      // `x-matched-path`.
      const reserved = reservedScreenRouteSegment(path)
      if (reserved) {
        dequeueLoading()
        return enqueueSnackbar(reservedScreenRouteMessage(reserved), {
          variant: 'warning',
          persist: false,
        })
      }
      if (path) {
        const hostSnapshot = await getDoc(doc(firestore, 'hosts', hostId))
        const owner = findScreenIdByRoutePath(hostSnapshot.get('screens'), path)
        if (owner) {
          dequeueLoading()
          return enqueueSnackbar(
            `Another screen is already published at ${screenRoutePathToUrl(path)}`,
            { variant: 'warning', persist: false },
          )
        }
      }

      // createdAt/updatedAt are stamped server-side by the resources API
      // (AGL-473) — client Timestamps don't survive the JSON hop.
      const newValues = {
        ...fields,
        ...(path && { slug: path }),
        versionId: newVersionId,
      }
      // No createdAt/updatedAt: /api/hosts/versions stamps both server-side
      // (AGL-1369), and a client Timestamp does not survive the JSON hop —
      // the same reason the resources API stamps the doc above.
      const newVersionValue = {
        screenId: newId,
        nodes: {
          [CANVAS_ROOT_ELEMENT_ID]: {
            $id: CANVAS_ROOT_ELEMENT_ID,
            componentId: 'div',
            nodes: [],
          },
        },
      }
      // Screen doc rides the quota-enforcing resources API (AGL-473); the
      // first version rides /api/hosts/versions (AGL-1369). Rules deny client
      // `create` under a screen's `versions` now, because that create is what
      // the `versioning` entitlement sells — the route allows a resource's
      // FIRST version on every plan and charges only for retaining more.
      await createHostResource({
        hostId,
        resource: 'screen',
        id: newId,
        data: newValues,
      })
        .then(() =>
          createHostVersion({
            hostId,
            kind: 'screen',
            parentId: newId,
            id: newVersionId,
            data: newVersionValue,
          }),
        )
        .then(() =>
          path
            ? publishScreenRoute(firestore, { hostId, screenId: newId }, path)
            : undefined,
        )
        .then(() =>
          logActivity('Created screen', {
            type: 'screen',
            id: newId,
            name: newValues.displayName,
          }),
        )
        .catch((error) => {
          console.error(error)
          setError({ ...error })
          enqueueSnackbar(error?.message ?? 'An error has occurred', {
            variant: 'error',
            allowDuplicate: true,
          })
        })
        .finally(() => {
          handleFormClose()
          dequeueLoading()
        })
    },
    [
      loading,
      error,
      queueLoading,
      firestore,
      hostId,
      handleFormClose,
      enqueueSnackbar,
      org,
      orgReady,
      billableScreenCount,
      createHostResource,
      createHostVersion,
      logActivity,
    ],
  )

  const handleDeleteScreen = useCallback(
    (id: string, versionId: string) => async () => {
      let dequeueLoading
      await confirm({
        title: 'Are you sure?',
        description:
          "You are about to delete a screen from the application, please confirm the desired option. Press 'Delete' to confirm and delete the item. Press 'Cancel' to void the operation and close this dialog.",
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => {
          dequeueLoading = queueLoading()
        })
        .then(() =>
          Promise.all([
            updateDoc(doc(firestore, 'hosts', hostId, 'screens', id), {
              deletedAt: Timestamp.now(),
            }),
            // A deleted screen must leave the routing map or its path keeps
            // resolving (then 404s deep in the tenant render).
            unpublishScreenRoute(firestore, { hostId, screenId: id }),
          ]),
        )
        .then(() => logActivity('Deleted screen', { type: 'screen', id }))
        .catch(() => {})
        .finally(() => {
          dequeueLoading && dequeueLoading()
        })
    },
    [confirm, firestore, hostId, queueLoading, logActivity],
  )

  // Drop handler for the hierarchy table: re-parents/reorders the screen,
  // rewrites sibling `order` values, then cascades routing-map paths for the
  // moved screen and its descendants (parent `company` + own `about` →
  // /company/about, same rules as the besigner Publishing section).
  const handleMoveScreen = useCallback(
    async ({ screenId, nextParentId, beforeId }: ScreenMoveRequest) => {
      if (loading) return
      if (wouldCreateScreenCycle(screenId, nextParentId, screensById)) {
        enqueueSnackbar(
          "A screen can't be nested inside itself or its own children",
          { variant: 'warning', persist: false },
        )
        return
      }
      const nextById = {
        ...screensById,
        [screenId]: { ...screensById[screenId], parentId: nextParentId },
      }
      const nextSelfPath = composeScreenRoutePath(screenId, nextById)
      const owner = nextSelfPath
        ? findScreenIdByRoutePath(routingMap, nextSelfPath)
        : undefined
      if (owner && owner !== screenId) {
        enqueueSnackbar(
          `Another screen is already published at ${screenRoutePathToUrl(nextSelfPath as string)}`,
          { variant: 'warning', persist: false },
        )
        return
      }
      const dequeueLoading = queueLoading()
      try {
        const rowById = new Map(screens.map((screen) => [screen.$id, screen]))
        const orderedIds = screens
          .filter(
            (screen) =>
              screen.$id !== screenId &&
              (screen.parentId && screensById[screen.parentId]
                ? screen.parentId
                : undefined) === nextParentId,
          )
          .sort(compareScreenSiblings)
          .map((screen) => screen.$id)
        const insertAt = beforeId ? orderedIds.indexOf(beforeId) : -1
        orderedIds.splice(
          insertAt === -1 ? orderedIds.length : insertAt,
          0,
          screenId,
        )
        const batch = writeBatch(firestore)
        orderedIds.forEach((id, index) => {
          const screenRef = doc(firestore, 'hosts', hostId, 'screens', id)
          if (id === screenId) {
            batch.update(screenRef, {
              parentId: nextParentId ?? deleteField(),
              order: index,
              updatedAt: Timestamp.now(),
            })
          } else if (rowById.get(id)?.order !== index) {
            batch.update(screenRef, { order: index })
          }
        })
        await batch.commit()
        const parentChanged =
          (screensById[screenId]?.parentId ?? undefined) !==
          (nextParentId ?? undefined)
        if (parentChanged) {
          await syncScreenRouteEntries(
            firestore,
            hostId,
            buildScreenRouteEntries(screenId, nextById, routingMap),
          )
        }
        enqueueSnackbar(
          parentChanged && nextSelfPath
            ? `Screen moved — now served at ${screenRoutePathToUrl(nextSelfPath)}`
            : 'Screen moved',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeueLoading()
      }
    },
    [
      loading,
      screens,
      screensById,
      routingMap,
      firestore,
      hostId,
      queueLoading,
      enqueueSnackbar,
    ],
  )

  // Translations (AGL-164): per-locale variant screen mapping.
  const hostLocales: string[] = Array.isArray(hostData?.locales)
    ? hostData.locales
    : []
  const [translationsFor, setTranslationsFor] = useState<{
    screenId: string
    locale: string
    variants: Record<string, string>
  } | null>(null)
  // Save as template (AGL-668). Nodes live on the published version doc, so
  // they are fetched when the user confirms rather than per row.
  const [saveTemplateFor, setSaveTemplateFor] =
    useState<SaveAsTemplateSource | null>(null)
  const buildTemplateSource = useCallback(
    (row: ScreenHierarchyRow): SaveAsTemplateSource => ({
      kind: 'page',
      displayName: (row as { displayName?: string }).displayName,
      loadNodes: async () => {
        const screen = screens.find((entry: any) => entry.$id === row.$id) as any
        const versionId = screen?.versionId ?? row.versionId
        if (!versionId) return null
        const snapshot = await getDoc(
          doc(
            firestore,
            'hosts',
            hostId,
            'screens',
            row.$id,
            'versions',
            String(versionId),
          ),
        )
        // Decoded (AGL-1397): a besigner-saved version stores `nodes` as
        // msgpack `Bytes`, and a template built from the wrapper carries no
        // node tree at all.
        const nodes = decodeStoredNodes(snapshot.get('nodes'))
        if (!nodes) return null
        return {
          nodes,
          // The slug is a suggestion only — instantiation de-conflicts it
          // against the host's routing map.
          slug: routingMap?.[row.$id],
          seo: screen?.seo,
        }
      },
    }),
    [screens, firestore, hostId, routingMap],
  )
  const handleSaveTranslations = useCallback(async () => {
    if (!translationsFor) return
    const variants: Record<string, string> = {}
    for (const [locale, screenId] of Object.entries(
      translationsFor.variants,
    )) {
      if (screenId) variants[locale] = screenId
    }
    try {
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'screens', translationsFor.screenId),
        {
          locale: translationsFor.locale || deleteField(),
          localeVariants: Object.keys(variants).length
            ? variants
            : deleteField(),
        },
      )
      setTranslationsFor(null)
      enqueueSnackbar('Translations saved', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [translationsFor, firestore, hostId, enqueueSnackbar])

  /*
    The row's LEFT is the drag handle and the expand chevron, and nothing else
    (AGL-693). Zach: *"The screens should only have the drag or expand icon to
    the left."*

    A "Details" icon used to sit there, on the argument that it is navigation
    rather than a row action. That was true and is now moot: the ROW opens the
    detail view, so a second control that does the same thing is a smaller
    target for the same destination — and it made screens the only list whose
    rows began with a toolbar. It moves into the overflow, where every other
    list also names it.
  */

  /**
   * Who is already in this screen, beside its name (AGL-2486).
   *
   * ONE request for the whole list, not one per row: the RTDB rules admit a
   * client to exactly one room at a time, so per-row subscriptions would be a
   * listener per screen and — measured at 2 occupied rooms against 69
   * documents — about 97% of them would exist only to report an empty room.
   *
   * The count is the DOCUMENT's, rolled up across its versions, because "is
   * anybody in this at all" is the question a row is asked. The chip's own
   * copy says so; it must never imply the reader would land beside them.
   */
  const { peopleIn } = usePresenceSummary(hostId)
  const renderRowPresence = useCallback(
    (row: { $id: string }) => (
      <DocumentPresenceChips people={peopleIn('screen', row.$id)} />
    ),
    [peopleIn],
  )

  const handleRowOpen = useCallback(
    (row: any) => {
      router.push(
        buildRoute(Route.SCREEN_DETAILS, {
          orgSlug,
          host,
          screenId: row.$id,
          versionId: row.versionId as string,
        }),
      )
    },
    [router, orgSlug, host],
  )

  const renderRowActions = useCallback(
    (row: ScreenHierarchyRow) => {
      // AGL-374: slug→path normalization, custom domains, preview links;
      // AGL-1271: a collection template's live URL is decided by the
      // collection that renders it, not its own (dropped) routing entry.
      const { url: liveUrl, unavailableReason } = resolveScreenLiveUrl(
        hostData,
        row.$id,
        {
          isTemplate: collectionTemplates.templateScreenIds.has(row.$id),
          routes: collectionTemplates.routesByScreenId.get(row.$id),
        },
      )
      const label = (row as { displayName?: string }).displayName ?? row.$id
      const versionId = row.versionId as string
      return (
        <ArtifactRowActions
          label={label}
          /*
            A screen is the ONE artifact with a real address of its own, so its
            quick action is the live page rather than a preview — Zach: *"it
            should be preview if it is not a screen or open live page"*.

            Shown DISABLED with the reason when there is no single live page: a
            collection template renders under routes the collection owns, so it
            has no one URL. Removing the control there would read as the
            feature being missing rather than inapplicable.
          */
          quick={{
            icon: mdiOpenInNew.path,
            label: 'Open live page',
            ...(liveUrl
              ? { href: liveUrl }
              : {
                  unavailableReason:
                    unavailableReason ?? 'No single live page for this screen.',
                }),
          }}
          items={[
            {
              key: 'details',
              label: 'View details',
              icon: <MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} size={0.8} />,
              onClick: () => handleRowOpen(row),
            },
            {
              key: 'besigner',
              label: 'Edit in besigner',
              icon: <MdiIcon path={ICON_VARIANT_BESIGNER.path} size={0.8} />,
              onClick: () =>
                router.push(
                  buildRoute(Route.SCREEN_BESIGNER, {
                    orgSlug,
                    host,
                    screenId: row.$id,
                    versionId,
                  }),
                ),
            },
            // Translations only where the site HAS locales — the control is
            // meaningless on a single-language site and this is the one menu
            // item that varies by host rather than by row.
            ...(hostLocales.length
              ? [
                  {
                    key: 'translations',
                    label: 'Translations…',
                    icon: <MdiIcon path={mdiTranslate.path} size={0.8} />,
                    onClick: () => {
                      const current = screens.find(
                        (screen: any) => screen.$id === row.$id,
                      ) as any
                      setTranslationsFor({
                        screenId: row.$id,
                        locale: current?.locale ?? '',
                        variants: { ...(current?.localeVariants ?? {}) },
                      })
                    },
                  },
                ]
              : []),
            {
              key: 'save-template',
              label: 'Save as template',
              icon: <MdiIcon path={mdiBookmarkOutline.path} size={0.8} />,
              onClick: () => setSaveTemplateFor(buildTemplateSource(row)),
            },
            {
              key: 'delete',
              label: 'Delete',
              destructive: true,
              icon: (
                <MdiIcon path={ICON_VARIANT_MODIFY_DELETE.path} size={0.8} />
              ),
              onClick: () =>
                void handleDeleteScreen(row.$id, versionId)(),
            },
          ]}
        />
      )
    },
    [
      handleDeleteScreen,
      handleRowOpen,
      hostLocales.length,
      screens,
      hostData,
      buildTemplateSource,
      collectionTemplates,
      router,
      orgSlug,
      host,
    ],
  )

  // console.log('Screens props', props, data, status, screens)

  return (
    <>
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
        ]}
        help="screens"
        header={{
          children: 'Screens',
          icon: { path: ICON_VARIANT_PAGES.path },
        }}
        headerRight={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setTemplatesOpen(true)}
            >
              {'Templates'}
            </Button>
            <Button size="small" variant="contained" onClick={handleFormOpen}>
              {'Create New Screen'}
            </Button>
          </Stack>
        }
        aside={
          <NavigationDrawerComponent
            open={quickDrawerOpen}
            anchor="right"
            variant="temporary"
            onClose={handleFormClose}
            AppBarProps={{ color: 'surface' }}
            appBarLeft={
              <>
                <IconButton
                  color="inherit"
                  edge="start"
                  onClick={handleFormClose}
                  sx={{ mr: 2 }}
                >
                  <MdiIcon path={ICON_VARIANT_CLOSE.path} />
                  <SrOnly>close drawer</SrOnly>
                </IconButton>
                <Typography variant="h6" component="div">
                  {'Create new screen'}
                </Typography>
              </>
            }
            appBarRight={
              <Button
                variant="outlined"
                color="inherit"
                onClick={handleFormClose}
              >
                {'Cancel'}
              </Button>
            }
          >
            <Container gutterY>
              <FormRenderer
                FormTemplate={AuthFormTemplateComponent}
                componentMapper={simpleComponentMapper}
                onSubmit={handleFormSubmit}
                schema={formSchema}
                subscription={{ values: true }}
                clearOnUnmount
              />
              <AuthErrorAlertComponent
                error={error as any}
                sx={{ mt: 2, mb: 1 }}
              />
            </Container>
          </NavigationDrawerComponent>
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <CardDisplay>
            {/*<AccordionListComponent*/}
            {/*  unique*/}
            {/*  items={screens}*/}
            {/*  AccordionSummaryProps={{ dense: true }}*/}
            {/*  DetailsContentComponent={DetailsContentComponent as any}*/}
            {/*  SummaryContentComponent={SummaryContentComponent as any}*/}
            {/*  getItemId={(item) => item.$id}*/}
            {/*/>*/}
            <ScreensHierarchyTableComponent
                    renderRowPresence={renderRowPresence}
              onRowOpen={handleRowOpen}
              screens={screens}
              routingMap={routingMap}
              collectionTemplates={collectionTemplates}
              loading={status === 'loading'}
              onMoveScreen={handleMoveScreen}
              renderRowActions={renderRowActions}
              emptyAction={
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    onClick={handleFormOpen}
                  >
                    {'Create your first screen'}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setTemplatesOpen(true)}
                  >
                    {'Browse templates'}
                  </Button>
                </Stack>
              }
            />
          </CardDisplay>
        </Container>
      </DashboardLayout>
      <SaveAsTemplateDialog
        hostId={hostId}
        source={saveTemplateFor}
        onClose={() => setSaveTemplateFor(null)}
      />
      <TemplateGalleryDialog
        hostId={hostId}
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        existingSlugs={Object.values(routingMap ?? {})}
        screenCount={billableScreenCount}
      />

      <Dialog
        open={Boolean(translationsFor)}
        onClose={() => setTranslationsFor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Screen translations'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            select
            label="This screen's language"
            value={translationsFor?.locale ?? ''}
            onChange={(event) =>
              setTranslationsFor((prev) =>
                prev ? { ...prev, locale: event.target.value } : prev,
              )
            }
            size="small"
            sx={{ mt: 1 }}
          >
            <MenuItem value="">{'Unset'}</MenuItem>
            {hostLocales.map((locale) => (
              <MenuItem key={locale} value={locale}>
                {locale}
              </MenuItem>
            ))}
          </TextField>
          {hostLocales
            .filter((locale) => locale !== translationsFor?.locale)
            .map((locale) => (
              <TextField
                key={locale}
                select
                label={`${locale} version`}
                value={translationsFor?.variants[locale] ?? ''}
                onChange={(event) =>
                  setTranslationsFor((prev) =>
                    prev
                      ? {
                          ...prev,
                          variants: {
                            ...prev.variants,
                            [locale]: event.target.value,
                          },
                        }
                      : prev,
                  )
                }
                size="small"
              >
                <MenuItem value="">{'None'}</MenuItem>
                {screens
                  .filter(
                    (screen: any) =>
                      screen.$id !== translationsFor?.screenId,
                  )
                  .map((screen: any) => (
                    <MenuItem key={screen.$id} value={screen.$id}>
                      {screen.displayName ?? screen.$id}
                    </MenuItem>
                  ))}
              </TextField>
            ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTranslationsFor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSaveTranslations}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
const formSchema = {
  fields: [
    {
      component: 'text-field',
      name: 'displayName',
      helperText: 'Friendly name for internal reference',
      type: 'text',
      label: 'Display name',
      isRequired: true,
      validate: [
        { type: 'required', message: 'Provide a display name' },
        {
          type: 'max-length',
          threshold: 25,
          message: 'Must not exceed 25 characters',
        },
      ],
    },
    {
      component: 'textarea',
      name: 'description',
      label: 'Description',
      helperText: 'Brief description for internal reference',
      validate: [
        {
          type: 'max-length',
          threshold: 80,
          message: 'Must not exceed 80 characters',
        },
      ],
    },
    {
      component: 'text-field',
      name: 'slug',
      type: 'text',
      label: 'Slug',
      help: docsHelp('screens', {
        anchor: '#screens--routing',
        excerpt:
          'Publishing registers the slug in the routing map — nested ' +
          'screens compose their path from their parents.',
      }),
      helperText:
        'Path the screen is served at on your site ("/" for the home page). Leave empty to keep it unpublished.',
      validate: [
        {
          type: 'max-length',
          threshold: 60,
          message: 'Must not exceed 60 characters',
        },
      ],
    },
  ],
}
Screens.displayName = 'Page:Screens'

export default Screens
