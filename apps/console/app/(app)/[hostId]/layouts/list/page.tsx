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
  ICON_VARIANT_CLOSE,
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_MODIFY_EDIT,
} from '@aglyn/shared-data-enums'
import { mdiPageLayoutBody } from '@aglyn/shared-data-mdi'
import {
  AppLink,
  AppLinkNakedLinkProps,
  CardDisplay,
  Container,
  DataTableComponent,
  MdiIcon,
  NavigationDrawerComponent,
  SrOnly,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { Button, IconButton, Typography } from '@mui/material'
import { GridActionsCellItem, type GridColDef } from '@mui/x-data-grid'
import {
  collection,
  doc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useFirestore, useHostResourceApi } from '@aglyn/tenant-feature-instance'
import AuthErrorAlertComponent from '../../../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../../../components/auth-form-template.component'
import AuthenticatedLayout from '../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../components/layouts/main.layout'
import HostDisplayNameComponent from '../../../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../../../constants/route-links'
import hostNavTabItems from '../../../../../constants/host-nav-tabs'
import {
  CONTENT_MAX_WIDTH,
  TABLE_ROW_HEIGHT,
} from '../../../../../constants/shared'
import useFirestoreCollection from '../../../../../hooks/use-firestore-collection'

const CellItemLinkComponent = forwardRef<any, AppLinkNakedLinkProps>(
  (props, ref) => {
    return <AppLink ref={ref} {...props} componentVariant={'naked'} />
  },
)
CellItemLinkComponent.displayName = 'CellItemLinkComponent'

function Layouts(props) {
  const params = useParams<{ hostId: string }>()
  const hostId = params?.hostId as string
  const { queueLoading, loading } = useLoading()
  const { confirm } = useConfirmationContext()
  const [quickDrawerOpen, setQuickDrawerOpen] = useState<boolean>(false)
  const handleFormOpen = useCallback(() => {
    setQuickDrawerOpen(true)
  }, [])
  const handleFormClose = useCallback(() => {
    setQuickDrawerOpen(false)
  }, [])
  const [pageSize, setPageSize] = useState<number>(5)
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
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
              href: buildRoute(Route.LAYOUT_BESIGNER, {
                hostId,
                layoutId,
                versionId,
              }),
            } as any)}
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
    },
    {
      field: 'description',
      headerName: 'Description',
      flex: 1,
      minWidth: 275,
      type: 'string',
    },
    {
      field: 'updatedAt',
      headerName: 'Updated',
      flex: 1,
      minWidth: 150,
      type: 'date',
      valueFormatter: ({ value }: any) =>
        value?.toDate?.().toLocaleTimeString() || '--',
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      flex: 1,
      minWidth: 150,
      type: 'date',
      valueFormatter: ({ value }: any) =>
        value?.toDate?.().toLocaleTimeString() || '--',
    },
  ]

  return (
    <>
      <NextPageTitle screen={'Layouts'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        activeTab={buildRoute(Route.LAYOUT_LIST, { hostId })}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Layouts',
            href: buildRoute(Route.LAYOUT_LIST, { hostId }),
          },
        ]}
        header={{
          children: 'Layouts',
          icon: { path: mdiPageLayoutBody.path },
        }}
        headerRight={
          <Button size="small" variant="contained" onClick={handleFormOpen}>
            {'Create New Layout'}
          </Button>
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
                  {'Create new layout'}
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
            <DataTableComponent
              rowHeight={TABLE_ROW_HEIGHT}
              getRowId={(row) => row.$id}
              columns={columns}
              noRowsLabel="No layouts"
              rows={layouts}
              loading={status === 'loading'}
              initialState={{ pagination: { paginationModel: { pageSize } } }}
              onPaginationModelChange={(model) => setPageSize(model.pageSize)}
              pageSizeOptions={[5, 10, 15]}
              pagination
            />
          </CardDisplay>
        </Container>
      </DashboardLayout>
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
  ],
}
Layouts.displayName = 'Page:Layouts'

export default Layouts
