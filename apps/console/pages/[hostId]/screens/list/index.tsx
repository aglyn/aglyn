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
  createResourceUid,
  findScreenIdByRoutePath,
  normalizeScreenSlug,
  screenRoutePathToUrl,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_CLOSE,
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_SHOW_DETAIL,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  AppLinkNakedLinkProps,
  Container,
  NavigationDrawerComponent,
  SrOnly,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import { FormRenderer, simpleComponentMapper } from '@aglyn/shared-ui-jsx-forms'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { Button, IconButton, Typography } from '@mui/material'
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
import { useParams } from 'next/navigation'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useFirestore, useFirestoreCollectionData } from 'reactfire'
import AuthErrorAlertComponent from '../../../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../../../components/auth-form-template.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { DataTableComponent } from '@aglyn/shared-ui-jsx'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { buildRoute, Route } from '../../../../constants/route-links'
import {
  publishScreenRoute,
  unpublishScreenRoute,
} from '../../../../constants/screen-publishing'
import {
  CONTENT_MAX_WIDTH,
  TABLE_ROW_HEIGHT,
} from '../../../../constants/shared'

const CellItemLinkComponent = forwardRef<any, AppLinkNakedLinkProps>(
  (props, ref) => {
    return <AppLink ref={ref} {...props} componentVariant={'naked'} />
  },
)
CellItemLinkComponent.displayName = 'CellItemLinkComponent'

function Screens(props) {
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
  const screensCollection = collection(firestore, 'hosts', hostId, 'screens')
  const screensQuery = query(screensCollection, limit(pageSize))
  const { status, data } = useFirestoreCollectionData<any>(screensQuery, {
    idField: '$id',
  })
  const screens = data || []
  const { enqueueSnackbar, closeSnackbar } = useSnackbar()

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
      const timestamp = Timestamp.now()
      const { slug: slugInput, ...fields } = values

      // Publishing is what makes the screen reachable: the tenant matches
      // request paths against the host's `screens` routing map, so the slug
      // must both live on the screen doc and be registered in that map.
      const path = normalizeScreenSlug(slugInput)
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

      const newValues = {
        ...fields,
        ...(path && { slug: path }),
        versionId: newVersionId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const newVersionValue = {
        screenId: newId,
        createdAt: timestamp,
        updatedAt: timestamp,
        nodes: {
          [CANVAS_ROOT_ELEMENT_ID]: {
            $id: CANVAS_ROOT_ELEMENT_ID,
            componentId: 'div',
            nodes: [],
          },
        },
      }
      await Promise.all([
        setDoc(doc(firestore, 'hosts', hostId, 'screens', newId), newValues),
        setDoc(
          doc(
            firestore,
            'hosts',
            hostId,
            'screens',
            newId,
            'versions',
            newVersionId,
          ),
          newVersionValue,
        ),
      ])
        .then(() =>
          path
            ? publishScreenRoute(firestore, { hostId, screenId: newId }, path)
            : undefined,
        )
        .catch((error) => {
          console.error(error)
          setError({ ...error })
          enqueueSnackbar('An error has occurred', {
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
        const screenId = id as string
        const versionId = row.versionId as string
        return [
          <GridActionsCellItem
            key="action-detail"
            icon={<MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} />}
            label="detail"
            LinkComponent={CellItemLinkComponent}
            {...({
              href: buildRoute(Route.SCREEN_DETAILS, {
                hostId,
                screenId,
                versionId,
              }),
            } as any)}
          />,
          <GridActionsCellItem
            key="action-delete"
            icon={<MdiIcon path={ICON_VARIANT_MODIFY_DELETE.path} color="error" />}
            label="Delete"
            onClick={handleDeleteScreen(screenId, versionId)}
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
      field: 'slug',
      headerName: 'Path',
      minWidth: 140,
      type: 'string',
      valueFormatter: ({ value }: any) =>
        value ? screenRoutePathToUrl(value) : '--',
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

  // console.log('Screens props', props, data, status, screens)

  return (
    <>
      <NextPageTitle screen={'Screens'} />
      <DashboardLayout
        navTabItems={[
          {
            id: 'nav-tab-dashboard',
            label: 'Dashboard',
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            id: 'nav-tab-screens',
            label: 'Screens',
            href: buildRoute(Route.SCREEN_LIST, { hostId }),
          },
          {
            id: 'nav-tab-layouts',
            label: 'Layouts',
            href: buildRoute(Route.LAYOUT_LIST, { hostId }),
          },
          {
            id: 'nav-tab-theme',
            label: 'Theme',
            href: buildRoute(Route.HOST_THEME, { hostId }),
          },
          {
            id: 'nav-tab-setup',
            label: 'Setup',
            href: buildRoute(Route.HOST_SETUP, { hostId }),
          },
        ]}
        activeTab={buildRoute(Route.SCREEN_LIST, { hostId })}
        breadcrumbItems={[
          {
            children: hostId,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Screens',
            href: buildRoute(Route.SCREEN_LIST, { hostId }),
          },
        ]}
        header={{
          children: 'Screens',
          icon: { path: ICON_VARIANT_PAGES.path },
        }}
        headerRight={
          <Button size="small" variant="contained" onClick={handleFormOpen}>
            {'Create New Screen'}
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
            <DataTableComponent
              rowHeight={TABLE_ROW_HEIGHT}
              getRowId={(row) => row.$id}
              columns={columns}
              noRowsLabel="No screens"
              rows={screens}
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
    {
      component: 'text-field',
      name: 'slug',
      type: 'text',
      label: 'Slug',
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
Screens.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Screens',
    },
  },
]

export default Screens
