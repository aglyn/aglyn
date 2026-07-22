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
  LAYOUT_SLOT_COMPONENT_ID,
} from '@aglyn/aglyn'
import { MUI_BUNDLE_ID } from '@aglyn/aglyn'
import {
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_MODIFY_EDIT,
} from '@aglyn/shared-data-enums'
import {
  mdiBookmarkOutline,
  mdiPageLayoutBody,
  mdiStorefrontOutline,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  AppLinkNakedLinkProps,
  CardDisplay,
  Container,
  DataTableComponent,
  MdiIcon,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { Button, Stack } from '@mui/material'
import TemplateGalleryDialog from '../../../../../../../components/templates/template-gallery-dialog.component'
import { GridActionsCellItem, type GridColDef } from '@mui/x-data-grid'
import {
  collection,
  doc,
  getDoc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useParams, useRouter } from 'next/navigation'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useFirestore, useHostResourceApi } from '@aglyn/tenant-feature-instance'
import CreateArtifactDrawer from '../../../../../../../components/create-artifact-drawer.component'
import AuthenticatedLayout from '../../../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import PublishArtifactDialog, {
  type PublishArtifactTarget,
} from '../../../../../../../components/templates/publish-artifact-dialog.component'
import SaveAsTemplateDialog, {
  type SaveAsTemplateSource,
} from '../../../../../../../components/templates/save-as-template-dialog.component'
import MainLayout from '../../../../../../../components/layouts/main.layout'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { useHostId, useHostSubdomain } from '../../../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../../../hooks/use-org-scope'
import hostNavTabItems from '../../../../../../../constants/host-nav-tabs'
import {
  CONTENT_MAX_WIDTH,
  TABLE_ROW_HEIGHT,
} from '../../../../../../../constants/shared'
import useFirestoreCollection from '../../../../../../../hooks/use-firestore-collection'

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
  const [pageSize, setPageSize] = useState<number>(5)
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
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
        const nodes = snapshot.get('nodes') as
          | Record<string, unknown>
          | undefined
        // The LayoutSlot node rides along inside `nodes` — it marks where a
        // bound screen grafts in, so a layout template without it would be
        // chrome with nowhere to put the page.
        return nodes ? { nodes } : null
      },
    }),
    [firestore, hostId],
  )
  const { status, data } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'layouts'), limit(pageSize)),
    [firestore, hostId, pageSize],
    { idField: '$id' },
  )
  const layouts = data || []
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
      const newValues = {
        ...values,
        versionId: newVersionId,
        versions: [newVersionId],
      }
      // Seed with a single LayoutSlot so bound screens have a graft point
      // from the first save.
      const newVersionValue = {
        layoutId: newId,
        createdAt: timestamp,
        updatedAt: timestamp,
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
      // Layout doc rides the quota-enforcing resources API (AGL-473);
      // the seeded first version stays client-written.
      await createHostResource({
        hostId,
        resource: 'layout',
        id: newId,
        data: newValues,
      })
        .then(() =>
          setDoc(
            doc(
              firestore,
              'hosts',
              hostId,
              'layouts',
              newId,
              'versions',
              newVersionId,
            ),
            newVersionValue,
          ),
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
      enqueueSnackbar,
    ],
  )

  const handleDeleteLayout = useCallback(
    (id: string) => async () => {
      let dequeueLoading
      await confirm({
        title: 'Are you sure?',
        description:
          "You are about to delete a layout. Screens bound to it will render without shared chrome until they are rebound. Press 'Delete' to confirm or 'Cancel' to keep the layout.",
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

  const columns: GridColDef[] = [
    {
      field: 'actions',
      type: 'actions',
      width: 100,
      getActions: ({ id, row }) => {
        const layoutId = id as string
        const versionId = row.versionId as string
        return [
          <GridActionsCellItem
            key="action-edit"
            icon={<MdiIcon path={ICON_VARIANT_MODIFY_EDIT.path} />}
            label="edit"
            LinkComponent={CellItemLinkComponent}
            {...({
              href: buildRoute(Route.LAYOUT_BESIGNER, { orgSlug, 
                host,
                layoutId,
                versionId,
              }),
            } as any)}
          />,
          <GridActionsCellItem
            key="action-save-template"
            icon={<MdiIcon path={mdiBookmarkOutline.path} />}
            label="Save as template"
            onClick={() =>
              setSaveTemplateFor(
                buildTemplateSource(layoutId, versionId, row.displayName),
              )
            }
          />,
          // Publishing shares the whole layout with other organizations;
          // saving a template above keeps it on this site (AGL-672).
          <GridActionsCellItem
            key="action-publish"
            icon={<MdiIcon path={mdiStorefrontOutline.path} />}
            label="Publish to marketplace"
            onClick={() =>
              setPublishTarget({
                endpoint: 'community/publish-layout',
                payload: { hostId, layoutId },
                displayName: row.displayName,
                description: row.description,
                noun: 'layout',
                categoryPlaceholder: 'e.g. Marketing, Docs, Storefront',
              })
            }
          />,
          <GridActionsCellItem
            key="action-delete"
            icon={<MdiIcon path={ICON_VARIANT_MODIFY_DELETE.path} color="error" />}
            label="Delete"
            onClick={handleDeleteLayout(layoutId)}
          />,
        ]
      },
    },
    { field: '$id', headerName: 'ID', type: 'string', minWidth: 150 },
    {
      field: 'displayName',
      headerName: 'Display name',
      minWidth: 220,
      type: 'string',
      // The name leads to the detail page (AGL-695); the row's edit action
      // still goes straight to the besigner for anyone who wants that.
      renderCell: ({ id, value }: any) => (
        <AppLink
          href={buildRoute(Route.LAYOUT_DETAILS, {
            orgSlug,
            host,
            layoutId: id as string,
          })}
        >
          {value || (id as string)}
        </AppLink>
      ),
    },
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
  ]

  return (
    <>
      <NextPageTitle screen={'Layouts'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(orgSlug, host)}
        activeTab={buildRoute(Route.LAYOUT_LIST, { orgSlug,  host })}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
          },
          {
            children: 'Layouts',
            href: buildRoute(Route.LAYOUT_LIST, { orgSlug,  host }),
          },
        ]}
        help="screens"
        header={{
          children: 'Layouts',
          icon: { path: mdiPageLayoutBody.path },
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
              {'Create New Layout'}
            </Button>
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
            <DataTableComponent
              rowHeight={TABLE_ROW_HEIGHT}
              getRowId={(row) => row.$id}
              columns={columns}
              noRowsLabel="No layouts"
              rows={layouts}
              onRowClick={({ id }) =>
                router.push(
                  buildRoute(Route.LAYOUT_DETAILS, {
                    orgSlug,
                    host,
                    layoutId: id as string,
                  }),
                )
              }
              sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
              loading={status === 'loading'}
              initialState={{ pagination: { paginationModel: { pageSize } } }}
              onPaginationModelChange={(model) => setPageSize(model.pageSize)}
              pageSizeOptions={[5, 10, 15]}
              pagination
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
