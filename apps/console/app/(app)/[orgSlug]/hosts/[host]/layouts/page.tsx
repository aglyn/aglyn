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
  CANVAS_ROOT_ELEMENT_ID,
  createResourceUid,
  decodeStoredNodes,
  LAYOUT_SLOT_COMPONENT_ID,
} from '@aglyn/aglyn'
import { MUI_BUNDLE_ID } from '@aglyn/aglyn'
import {
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_MODIFY_EDIT,
  ICON_VARIANT_SHOW_DETAIL,
} from '@aglyn/shared-data-enums'
import {
  mdiBookmarkOutline,
  mdiPageLayoutBody,
  mdiStorefrontOutline,
  mdiEyeOutline,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  AppLinkNakedLinkProps,
  CardDisplay,
  Container,
  MdiIcon,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { checkOrgQuota } from '../../../../../../constants/entitlements'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import ListTable, {
  ListRowActions,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import ArtifactDeleteConfirmDescription, {
  fetchArtifactUsage,
} from '../../../../../../components/artifacts/artifact-delete-confirm.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { Button, Stack } from '@mui/material'
import DocumentPresenceChips from '../../../../../../components/document-presence-chips.component'
import usePresenceSummary from '../../../../../../hooks/use-presence-summary'
import TemplateGalleryDialog from '../../../../../../components/templates/template-gallery-dialog.component'
import { type GridColDef } from '@mui/x-data-grid'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import {
  useFirestore,
  useHostResourceApi,
  useHostVersionApi,
  usePagedCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import CreateArtifactDrawer from '../../../../../../components/create-artifact-drawer.component'
import AuthenticatedLayout from '../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../components/layouts/dashboard.layout'
import PublishArtifactDialog, {
  type PublishArtifactTarget,
} from '../../../../../../components/templates/publish-artifact-dialog.component'
import SaveAsTemplateDialog, {
  type SaveAsTemplateSource,
} from '../../../../../../components/templates/save-as-template-dialog.component'
import MainLayout from '../../../../../../components/layouts/main.layout'
import HostDisplayNameComponent from '../../../../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../../../../constants/route-links'
import { useHostId, useHostSubdomain } from '../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../hooks/use-org-scope'
import {
  CONTENT_MAX_WIDTH,
  TABLE_ROW_HEIGHT,
} from '../../../../../../constants/shared'
import { hostArtifactQuery } from '../../../../../../utils/host-artifact-queries'
import { useLiveArtifactCount } from '@aglyn/tenant-feature-instance'

const CellItemLinkComponent = forwardRef<any, AppLinkNakedLinkProps>(
  (props, ref) => {
    return <AppLink ref={ref} {...props} componentVariant={'naked'} />
  },
)
CellItemLinkComponent.displayName = 'CellItemLinkComponent'

function Layouts(props) {
  const params = useParams<{ hostId: string }>()
  const orgSlug = useOrgSlug()
  const router = useRouter()
  // Layout templates, not layouts (AGL-699) — the same picker the screens
  // page uses, filtered to the layout kind.
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const host = useHostSubdomain()
  const hostId = useHostId()
  const { queueLoading, loading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [quickDrawerOpen, setQuickDrawerOpen] = useState<boolean>(false)
  const [saveTemplateFor, setSaveTemplateFor] =
    useState<SaveAsTemplateSource | null>(null)
  const [publishTarget, setPublishTarget] =
    useState<PublishArtifactTarget | null>(null)
  const handleFormOpen = useCallback(() => {
    setQuickDrawerOpen(true)
  }, [])
  const handleFormClose = useCallback(() => {
    setQuickDrawerOpen(false)
  }, [])
  const firestore = useFirestore()
  const { org, ready: orgReady } = useCurrentOrg()
  // The where-used scan is an authenticated POST (host admin only).
  const { data: user } = useUser()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  // Save as template (AGL-668). A layout's nodes live on its published
  // version doc, so they are read on confirm rather than per row.
  const buildTemplateSource = useCallback(
    (
      layoutId: string,
      versionId: string,
      displayName?: string,
    ): SaveAsTemplateSource => ({
      kind: 'layout',
      displayName,
      loadNodes: async () => {
        if (!versionId) return null
        const snapshot = await getDoc(
          doc(
            firestore,
            'hosts',
            hostId,
            'layouts',
            layoutId,
            'versions',
            versionId,
          ),
        )
        // Decoded (AGL-1397): the besigner stores `nodes` as msgpack `Bytes`,
        // and the LayoutSlot check below is exactly the sort that cannot work
        // on the wrapper — it walks the map and finds nothing, silently.
        const nodes = decodeStoredNodes(snapshot.get('nodes'))
        // The LayoutSlot node rides along inside `nodes` — it marks where a
        // bound screen grafts in, so a layout template without it would be
        // chrome with nowhere to put the page.
        return nodes ? { nodes } : null
      },
    }),
    [firestore, hostId],
  )
  /**
   * The list PAGES, over an ordered walk (AGL-2501).
   *
   * It was `limit(pageSize)` with no `orderBy` and no pager: one page-sized
   * read, and the grid's own footer paging a window that never grew. So the
   * "next page" button led to an empty grid on a site with more layouts than
   * the page size, and the rows on the first page were a pseudo-random sample
   * — Firestore answers an unordered limit in document-id order.
   *
   * `hostArtifactQuery` holds the ordering decision and the reason it is the
   * document id rather than `displayName`; the walk it produces is total, so
   * every layout is reachable by paging.
   */
  const {
    status,
    rows: layoutWindow,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<any>(
    (pageLimit) => hostArtifactQuery(firestore, hostId, 'layouts', pageLimit),
    [firestore, hostId],
    { idField: '$id' },
  )
  /**
   * A deleted layout is a TOMBSTONE, not a row (AGL-2501).
   *
   * Delete here stamps `deletedAt` and leaves the document in place so
   * published tenant pages keep rendering their chrome until the next
   * revalidate. Nothing filtered them out, so a deleted layout stayed in this
   * list forever — the screens page and the components card have always
   * dropped theirs, and this was the one artifact list that did not.
   *
   * Client-side because it has to be: Firestore cannot ask for the ABSENCE of
   * a field, and the two live shapes are not one value — a layout created
   * through the resources route carries no `deletedAt`, one installed from the
   * marketplace carries an explicit `null`. The cost is that a tombstone still
   * spends a slot in the page it falls in, so a page can render fewer rows
   * than its size; `hasMore` and the walk are unaffected.
   */
  const layouts = layoutWindow.filter((layout: any) => !layout.deletedAt)
  /**
   * `sharedLayoutsPerHost` is enforced by `/api/hosts/resources` and had no
   * standing surface here — an author learned the cap by being refused a
   * create. The count is a server aggregate over the same LIVE documents the
   * route counts (AGL-1716), because the page it sits beside holds ten rows:
   * `10/10 layouts on your plan` on a site with sixty of them reads as room
   * to spare, right up until the create is refused.
   */
  const liveLayoutCount = useLiveArtifactCount(hostId, 'layouts')
  // Pending or refused, the page window stands in. It can only UNDERSTATE the
  // site's layouts, never overstate them, so nothing this figure gates fires
  // on a count larger than the truth.
  const layoutsUsed = liveLayoutCount ?? layouts.length
  const layoutQuota = checkOrgQuota(org, 'sharedLayoutsPerHost', layoutsUsed)
  const { enqueueSnackbar } = useSnackbar()

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
      const dequeueLoading = queueLoading()
      const newId = createResourceUid()
      const newVersionId = createResourceUid()
      const slotNodeId = createResourceUid()
      const timestamp = Timestamp.now()
      // createdAt/updatedAt are stamped server-side by the resources API
      // (AGL-473) — client Timestamps don't survive the JSON hop. This
      // also enforces sharedLayoutsPerHost, previously ungated here.
      // No `versions` array (AGL-1384): every reader — the layouts list, the
      // layout detail page — reads the `versions` SUBCOLLECTION, and nothing
      // kept this array in step as versions were added, so it was stale from
      // the second version onward. `versionId` is the pointer that matters.
      const newValues = {
        ...values,
        versionId: newVersionId,
      }
      // Seed with a single LayoutSlot so bound screens have a graft point
      // from the first save.
      // No createdAt/updatedAt: /api/hosts/versions stamps both server-side
      // (AGL-1369), and a client Timestamp does not survive the JSON hop.
      const newVersionValue = {
        layoutId: newId,
        nodes: {
          [CANVAS_ROOT_ELEMENT_ID]: {
            $id: CANVAS_ROOT_ELEMENT_ID,
            componentId: 'div',
            nodes: [slotNodeId],
          },
          [slotNodeId]: {
            $id: slotNodeId,
            componentId: LAYOUT_SLOT_COMPONENT_ID,
            pluginId: MUI_BUNDLE_ID,
            parentId: CANVAS_ROOT_ELEMENT_ID,
            props: {},
          },
        },
      }
      // Layout doc rides the quota-enforcing resources API (AGL-473); the
      // seeded first version rides /api/hosts/versions (AGL-1369), which
      // allows a resource's FIRST version on every plan and charges the
      // `versioning` entitlement only for retaining more than one.
      await createHostResource({
        hostId,
        resource: 'layout',
        id: newId,
        data: newValues,
      })
        .then(() =>
          createHostVersion({
            hostId,
            kind: 'layout',
            parentId: newId,
            id: newVersionId,
            data: newVersionValue,
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
      createHostResource,
      createHostVersion,
      enqueueSnackbar,
    ],
  )

  const handleDeleteLayout = useCallback(
    (id: string) => async () => {
      let dequeueLoading
      /*
        The scan STARTS here and the dialog opens in the same tick (AGL-703) —
        see `ArtifactDeleteConfirmDescription` for why it is not awaited.

        The old sentence named the CONSEQUENCE and not the dependents: "screens
        bound to it will render without shared chrome" is true and unanswerable
        — which screens? The answer was one request away and already rendered
        on the layout's own detail page.
      */
      const scan = (async () =>
        fetchArtifactUsage({
          hostId,
          kind: 'layout',
          id,
          idToken: await (user as any)?.getIdToken?.(),
        }))()
      await confirm({
        title: 'Delete this layout?',
        description: (
          <ArtifactDeleteConfirmDescription
            kind="layout"
            name={
              layouts.find((layout: any) => layout.$id === id)?.displayName ??
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
          updateDoc(doc(firestore, 'hosts', hostId, 'layouts', id), {
            deletedAt: Timestamp.now(),
          }),
        )
        .catch(() => {})
        .finally(() => {
          dequeueLoading && dequeueLoading()
        })
    },
    [confirm, firestore, hostId, queueLoading],
  )

  /**
   * Who is already in each layout, beside its name (AGL-2486).
   *
   * ONE request for the whole list. The RTDB rules admit a client to exactly
   * one room at a time, so a chip per row would mean a subscription per row —
   * and the presence tree is sparse enough (2 occupied rooms against a largest
   * host of 69 documents) that ~97% of them would report an empty room.
   *
   * Rolled up across VERSIONS, because a row names a document and not a
   * version. The chip's own copy carries that caveat so the count cannot be
   * read as "already in the one you are about to open".
   */
  const { peopleIn } = usePresenceSummary(hostId)

  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Display name',
      minWidth: 220,
      type: 'string',
      // The name leads to the detail page (AGL-695); the row's edit action
      // still goes straight to the besigner for anyone who wants that.
      renderCell: ({ id, value }: any) => (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <AppLink
            href={buildRoute(Route.LAYOUT_DETAILS, {
              orgSlug,
              host,
              layoutId: id as string,
            })}
          >
            {value || (id as string)}
          </AppLink>
          <DocumentPresenceChips people={peopleIn('layout', id as string)} />
        </Stack>
      ),
    },
    { field: '$id', headerName: 'ID', type: 'string', minWidth: 150 },
    {
      field: 'description',
      headerName: 'Description',
      flex: 1,
      minWidth: 275,
      type: 'string',
      // Blank reads as a rendering gap; '--' reads as "nothing here",
      // which is what the screens list has always shown.
      valueFormatter: (value: any) => value || '--',
    },
    {
      field: 'updatedAt',
      headerName: 'Updated',
      flex: 1,
      minWidth: 170,
      type: 'date',
      // MUI X v9 passes the value positionally. The old v6 object form
      // (`({ value })`) silently destructures undefined off a Date and every
      // row renders '--', which is what these columns were doing.
      valueGetter: (value: any) => value?.toDate?.() ?? null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      flex: 1,
      minWidth: 170,
      type: 'date',
      // MUI X v9 passes the value positionally. The old v6 object form
      // (`({ value })`) silently destructures undefined off a Date and every
      // row renders '--', which is what these columns were doing.
      valueGetter: (value: any) => value?.toDate?.() ?? null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    /*
      The trailing cluster every artifact list shares (AGL-2501). Four inline
      icons in a LEADING column put a delete two icons away from the row's own
      open handler, and make the first thing in the row a toolbar rather than
      the layout's name.
    */
    listActionsColumn((row: any) => {
      const layoutId = row.$id as string
      const versionId = row.versionId as string
      return (
        <ListRowActions
          label={row.displayName ?? layoutId}
          quick={{
            icon: mdiEyeOutline.path,
            label: 'Preview',
            ...(versionId
              ? {
                  to: buildRoute(Route.LAYOUT_PREVIEW, {
                    orgSlug,
                    host,
                    layoutId,
                    versionId,
                  }),
                }
              : {
                  unavailableReason:
                    'Nothing to preview yet — open it in the besigner once.',
                }),
          }}
          items={[
            {
              key: 'details',
              label: 'View details',
              icon: <MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} size={0.8} />,
              href: buildRoute(Route.LAYOUT_DETAILS, {
                orgSlug,
                host,
                layoutId,
              }),
            },
            {
              key: 'besigner',
              label: 'Edit in besigner',
              icon: (
                <MdiIcon path={ICON_VARIANT_MODIFY_EDIT.path} size={0.8} />
              ),
              href: buildRoute(Route.LAYOUT_BESIGNER, {
                orgSlug,
                host,
                layoutId,
                versionId,
              }),
            },
            {
              key: 'save-template',
              label: 'Save as template',
              icon: <MdiIcon path={mdiBookmarkOutline.path} size={0.8} />,
              onClick: () =>
                setSaveTemplateFor(
                  buildTemplateSource(layoutId, versionId, row.displayName),
                ),
            },
            {
              // Publishing shares the whole layout with other organizations;
              // saving a template above keeps it on this site (AGL-672).
              key: 'publish',
              label: 'Publish to marketplace',
              icon: <MdiIcon path={mdiStorefrontOutline.path} size={0.8} />,
              onClick: () =>
                setPublishTarget({
                  endpoint: 'marketplace/publish-layout',
                  payload: { hostId, layoutId },
                  displayName: row.displayName,
                  description: row.description,
                  noun: 'layout',
                  categoryPlaceholder: 'e.g. Marketing, Docs, Storefront',
                }),
            },
            {
              key: 'delete',
              label: 'Delete',
              destructive: true,
              icon: (
                <MdiIcon path={ICON_VARIANT_MODIFY_DELETE.path} size={0.8} />
              ),
              onClick: handleDeleteLayout(layoutId),
            },
          ]}
        />
      )
    }),
  ]

  return (
    <>
      <DashboardLayout
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
          },
          {
            children: 'Layouts',
            href: buildRoute(Route.HOST_LAYOUTS, { orgSlug,  host }),
          },
        ]}
        help="layouts"
        header={{
          children: 'Layouts',
          icon: { path: mdiPageLayoutBody.path },
        }}
        headerRight={
          /*
            The plan readout sits OPPOSITE the heading, beside the create
            button (AGL-2113) — the arrangement the Sites page uses for
            `6 of 10 sites · Business plan`. the 'templates on your
            plan' need to be moved to the header like we have on the hosts
            page, same thing goes for the screens page, components, layouts
            and templates.

            Above the table rather than inside it, because it is a fact about
            the PAGE: a reader deciding whether to create another one is
            looking at the create button, and that is where the number has to
            be. Inside the card it was a caption on a list.
          */
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <QuotaReadoutComponent
              ready={orgReady}
              used={layoutsUsed}
              limit={layoutQuota.limit}
              noun="layout"
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
                {'Create New Layout'}
              </Button>
            </Stack>
          </Stack>
        }
        aside={
          // Shared with the component and template creates (AGL-700); this
          // drawer's chrome and field schema were lifted from here.
          <CreateArtifactDrawer
            open={quickDrawerOpen}
            onClose={handleFormClose}
            title="Create new layout"
            onSubmit={handleFormSubmit}
            error={error}
          />
        }
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <TemplateGalleryDialog
            hostId={hostId}
            open={templatesOpen}
            onClose={() => setTemplatesOpen(false)}
            existingSlugs={[]}
            screenCount={0}
            kind="layout"
            title="Start from a layout template"
            blurb="Layout templates add a ready-made layout you can restyle in the besigner. Existing layouts are never touched."
          />
          <CardDisplay>
            <ListTable
              rowHeight={TABLE_ROW_HEIGHT}
              columns={columns}
              noRowsLabel="No layouts yet"
              /*
                THE WAY OUT, not just the picture (AGL-1152). This list drew
                the illustration and offered nothing to do about it, while the
                screens list offered buttons and drew no illustration. Same
                omission from two sides.
              */
              noRowsDescription="Layouts are the chrome your screens render inside — headers, footers, sidebars. Create one, or start from a template."
              noRowsAction={
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={handleFormOpen}>
                    {'Create your first layout'}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => setTemplatesOpen(true)}
                  >
                    {'Browse templates'}
                  </Button>
                </Stack>
              }
              rows={layouts}
              onOpen={(id) =>
                router.push(
                  buildRoute(Route.LAYOUT_DETAILS, {
                    orgSlug,
                    host,
                    layoutId: id,
                  }),
                )
              }
              loading={status === 'loading'}
              // Paged by the footer below, so the grid must not also slice.
              hideFooter
            />
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={layouts.length}
              hasMore={hasMore}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </CardDisplay>
        </Container>
      </DashboardLayout>
      <SaveAsTemplateDialog
        hostId={hostId}
        source={saveTemplateFor}
        onClose={() => setSaveTemplateFor(null)}
      />
      <PublishArtifactDialog
        target={publishTarget}
        onClose={() => setPublishTarget(null)}
      />
    </>
  )
}
Layouts.displayName = 'Page:Layouts'

export default Layouts
