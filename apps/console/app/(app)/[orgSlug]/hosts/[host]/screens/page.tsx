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
  SCREEN_SLUG_PATH_SEPARATOR_MESSAGE,
  screenSlugHasPathSeparator,
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
  Alert,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  deleteField,
  doc,
  getDoc,
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
  useUser,
} from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from '../../../../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../../../../components/auth-form-template.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../../components/layouts/main.layout'
import { ListRowActions } from '@aglyn/shared-ui-jsx/components/list-table.component'
import ArtifactDeleteConfirmDescription, {
  fetchArtifactUsage,
} from '../../../../../../components/artifacts/artifact-delete-confirm.component'
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
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
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
import {
  ceilingedWindow,
  hostArtifactQuery,
} from '../../../../../../utils/host-artifact-queries'
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

/**
 * How many screen documents one open of this page reads.
 *
 * A ceiling rather than a page: the tree, the route composition and the
 * billable-screen count all need the WHOLE collection, so this bounds the
 * read instead of windowing it. Sized well above `screensPerHost` on every
 * capped plan (100 on Pro) with room for the documents that plan does not
 * count — error screens, email screens and the tombstones a delete leaves
 * behind.
 */
const SCREEN_WINDOW = 200

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
  // The where-used scan is an authenticated POST; the delete confirmation
  // needs the caller's id token to start it (AGL-703).
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  /**
   * THE WHOLE TREE, ordered, with the ceiling made visible (AGL-2501).
   *
   * This list is the deliberate exception to the console's server-paged
   * lists, and it has to be: a hierarchy sliced by row puts a child on a
   * different page from its parent, so the indentation would describe a
   * parent the reader cannot see, `composeScreenRoutePath` would compose a
   * path from a chain with a hole in it, and `billableScreenIds` would count
   * a fraction of the site against its plan. The PAGING happens in
   * `ScreensHierarchyTableComponent`, which pages top-level screens and
   * carries each one's whole subtree with it.
   *
   * What the read owes is the other half: an ORDER, and honesty about its
   * ceiling.
   *
   *  * The order was absent — `limit(200)` alone — so a site over the ceiling
   *    got a pseudo-random two hundred in document-id order, which
   *    `compareScreenSiblings` then arranged into a believable tree.
   *    `hostArtifactQuery` orders on the document id: not insertion order,
   *    but stable, complete and the same on every load, and it drops nothing
   *    (a document's name cannot be absent, which no field here can promise).
   *
   *  * The ceiling was silent. `screensPerHost` is unlimited from Business up
   *    and error screens, email screens and tombstones are all documents in
   *    here, so a real site can hold more than this window. One PROBE
   *    document past the ceiling is what turns "we may be truncated" into a
   *    fact worth rendering; it is never handed to the tree.
   */
  const { status, data: screenWindow } = useFirestoreCollection<any>(
    () => hostArtifactQuery(firestore, hostId, 'screens', SCREEN_WINDOW + 1),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: data, truncated } = useMemo(
    () => ceilingedWindow<any>(screenWindow, SCREEN_WINDOW),
    [screenWindow],
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
  /** The cap behind the header readout; the create gate reads the same key. */
  const screenQuota = checkOrgQuota(org, 'screensPerHost', billableScreenCount)
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

      // A `/` typed INSIDE the value (AGL-2572). `normalizeScreenSlug`
      // reaches one segment by DELETING the separator, so a screen created
      // with `alternatives/webflow` was stored and routed as the glued
      // `alternativeswebflow` — an address nobody typed, with nothing said.
      // Refused rather than read as a hierarchy. This form uses the value as
      // both the stored slug and the whole routing-map path, so a `/` could
      // mean a nested address here; a slug is ONE segment on every surface
      // instead, and nesting is expressed by choosing a parent.
      if (screenSlugHasPathSeparator(slugInput)) {
        dequeueLoading()
        return enqueueSnackbar(SCREEN_SLUG_PATH_SEPARATOR_MESSAGE, {
          variant: 'warning',
          persist: false,
        })
      }
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
            ? publishScreenRoute(
                firestore,
                { hostId, screenId: newId, user },
                path,
              )
            : undefined,
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
      user,
    ],
  )

  const handleDeleteScreen = useCallback(
    (id: string, versionId: string) => async () => {
      let dequeueLoading
      /*
        The scan starts here and the dialog opens in the same tick (AGL-703).

        The old description was pure ceremony — "please confirm the desired
        option" — about the one artifact whose dependents are hardest to
        recall: the nav links pointing at it live on other screens, and a
        collection rendering its pages through it is not a link at all.
      */
      const scan = (async () =>
        fetchArtifactUsage({
          hostId,
          kind: 'screen',
          id,
          user,
        }))()
      await confirm({
        title: 'Delete this screen?',
        description: (
          <ArtifactDeleteConfirmDescription
            kind="screen"
            name={
              screens.find((screen: any) => screen.$id === id)?.displayName ??
              id
            }
            scan={scan}
          />
        ),
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
            unpublishScreenRoute(firestore, { hostId, screenId: id, user }),
          ]),
        )
        .then(() => logActivity('Deleted screen', { type: 'screen', id }))
        .catch(() => {})
        .finally(() => {
          dequeueLoading && dequeueLoading()
        })
    },
    [confirm, firestore, hostId, queueLoading, logActivity, screens, user],
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
      const parentChanged =
        (screensById[screenId]?.parentId ?? undefined) !==
        (nextParentId ?? undefined)
      // The routing-map writes this drop would make, computed BEFORE the
      // batch so a refusal costs no writes.
      const nextRouteEntries = parentChanged
        ? buildScreenRouteEntries(screenId, nextById, routingMap, {
            publish: false,
          })
        : undefined
      /*
       * A move can recompose a live address onto a reserved segment with
       * nobody typing anything (AGL-2588).
       *
       * `reservedScreenRouteSegment` reads the FIRST segment only, and that
       * is deliberate — a screen published at `docs/search` is servable and
       * legal. Dragging it to the top level recomposes that same screen's
       * live path to `search`, which is not, and the drop is the one moment
       * anybody can be told. So the question is asked of the RECOMPOSED
       * paths this drop would write, not of the screen's slug, which never
       * changed.
       *
       * Every path in the write, not just the moved screen's own: promoting
       * a home screen out of a parent moves its children to the top level
       * under their own slugs, so a descendant can reach a reserved segment
       * the moved screen never touches. Nothing is asked of a screen the
       * move leaves unrouted — a move is not an activation (AGL-2571), an
       * entry that is never written is not an address, and publishing it
       * later still meets the guard on the publish surfaces.
       *
       * The alternative — reserving `search` at EVERY depth — would make
       * currently-legal nested addresses illegal on live customer sites.
       * That is a migration, not a refusal, and is deliberately not done.
       */
      const reservedMove = Object.values(nextRouteEntries ?? {}).reduce<
        string | undefined
      >(
        (found, path) =>
          found ?? (path ? reservedScreenRouteSegment(path) : undefined),
        undefined,
      )
      if (reservedMove) {
        enqueueSnackbar(reservedScreenRouteMessage(reservedMove), {
          variant: 'warning',
          persist: false,
        })
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
        if (nextRouteEntries) {
          // Dragging a screen to a new parent MOVES it; it does not put it
          // on the site (AGL-2571). Live paths follow the new parent, and a
          // screen nobody published stays out of the routing map — the map
          // is the only thing that makes a path reachable, so writing an
          // entry here would publish by drag-and-drop. These are the same
          // entries the reservation check above read, so what is refused and
          // what is written are one composition.
          await syncScreenRouteEntries(firestore, hostId, nextRouteEntries, {
            user,
          })
        }
        enqueueSnackbar(
          // "Now served at" only for a screen that IS served (AGL-2571) —
          // an unpublished screen is moved, not routed, and saying otherwise
          // is the same false report the toolbar was making.
          parentChanged && nextSelfPath && routingMap?.[screenId] !== undefined
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
      user,
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
    (AGL-2501). The screens should only have the drag or expand icon to
    the left.

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

  /**
   * The name column's link target (AGL-2501).
   *
   * The same route `handleRowOpen` pushes, as an href — so the name is a real
   * link like it is on every other artifact list: middle-clickable, copyable,
   * and reachable from the keyboard without the whole row being a button.
   *
   * A screen with no published version has no `SCREEN_DETAILS` address to
   * build (the route carries a `versionId`), so those stay plain text rather
   * than linking somewhere that 404s.
   */
  const rowHref = useCallback(
    (row: ScreenHierarchyRow) =>
      row.versionId
        ? buildRoute(Route.SCREEN_DETAILS, {
            orgSlug,
            host,
            screenId: row.$id,
            versionId: row.versionId,
          })
        : null,
    [orgSlug, host],
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
      /*
        Both console destinations hang off the screen's version, so a screen
        that has none has no address to link to — the same guard `rowHref`
        applies to the name column. Disabled and saying so, rather than an
        anchor onto a route built from `undefined`.
      */
      const noVersionReason = versionId
        ? undefined
        : 'This screen has no saved version yet.'
      return (
        <ListRowActions
          label={label}
          /*
            A screen is the ONE artifact with a real address of its own, so its
            quick action is the live page rather than a preview. Layouts,
            components and templates render inside something else and have no
            route to open, so theirs is a Preview into the canvas.

            Shown DISABLED with the reason when there is no single live page: a
            collection template renders under routes the collection owns, so it
            has no one URL, and an unpublished screen has no address at all.
            Removing the control there would read as the feature being missing
            rather than inapplicable.
          */
          quick={{
            icon: mdiOpenInNew.path,
            label: 'Open live page',
            ...(liveUrl
              ? { href: liveUrl }
              : {
                  unavailableReason:
                    unavailableReason ??
                    (routingMap?.[row.$id] == null
                      ? 'Not published yet — publish this screen to give it ' +
                        'an address on the live site.'
                      : 'No single live page for this screen.'),
                }),
          }}
          items={[
            {
              key: 'details',
              label: 'View details',
              icon: <MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} size={0.8} />,
              href: rowHref(row) ?? undefined,
              disabled: Boolean(noVersionReason),
              disabledReason: noVersionReason,
            },
            {
              key: 'besigner',
              label: 'Edit in besigner',
              icon: <MdiIcon path={ICON_VARIANT_BESIGNER.path} size={0.8} />,
              href: versionId
                ? buildRoute(Route.SCREEN_BESIGNER, {
                    orgSlug,
                    host,
                    screenId: row.$id,
                    versionId,
                  })
                : undefined,
              disabled: Boolean(noVersionReason),
              disabledReason: noVersionReason,
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
      rowHref,
      hostLocales.length,
      screens,
      hostData,
      routingMap,
      buildTemplateSource,
      collectionTemplates,
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
          /*
            The plan readout opposite the heading (AGL-2113), the Sites page
            arrangement. `screensPerHost` was enforced on create and had no
            standing surface at all, so an author learned the cap by being
            refused — the exact failure the shared readout exists to end.

            Counted with `billableScreenIds`, the SAME rule the create gate
            calls. A separate count here is how a readout and the refusal it
            belongs to come to disagree, which is what the comment above that
            memo is about.
          */
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <QuotaReadoutComponent
              ready={orgReady}
              used={billableScreenCount}
              limit={screenQuota.limit}
              noun="screen"
            />
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
          {/*
            The ceiling, said out loud. Every other consequence on this page
            is computed from the window — the tree, the route each screen
            composes from its parents, and the plan count in the header — so a
            site above it is being shown a partial site with no sign of it.
            Naming the number and the order is what lets a reader tell "I have
            no such screen" from "this page did not read it".
          */}
          {truncated ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {`This site holds more than ${SCREEN_WINDOW} screens. The tree ` +
                `below shows the first ${SCREEN_WINDOW} in document order, and ` +
                'the screen count beside Create is counted from those.'}
            </Alert>
          ) : null}
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
              rowHref={rowHref}
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
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
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
