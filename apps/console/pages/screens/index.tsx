/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {createResourceUid} from '@aglyn/core-data-framework'
import {
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_PAGES,
  ICON_VARIANT_SHOW_DETAIL,
} from '@aglyn/shared-data-enums'
import {
  AppLink,
  ContainerComponent,
  NavigationDrawerComponent,
  useConfirmationContext,
  useLoading,
} from '@aglyn/shared-ui-jsx'
import {FormRenderer, simpleComponentMapper} from '@aglyn/shared-ui-jsx-forms'
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {Button, Typography} from '@mui/material'
import {GridActionsCellItem, type GridColumns} from '@mui/x-data-grid'
import {collection, deleteDoc, doc, limit, query, setDoc, Timestamp} from 'firebase/firestore'
import {useCallback, useState} from 'react'
import {useFirestore, useFirestoreCollectionData} from 'reactfire'
import AuthErrorAlertComponent from '../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../components/auth-form-template.component'
import DataTableComponent from '../../components/data-table.component'
import WidgetCardComponent from '../../components/widget-card.component'
import {CONTENT_MAX_WIDTH, TABLE_ROW_HEIGHT} from '../../constants/shared'
import LayoutConsoleComponent from '../../layouts/layout-console.component'
import LayoutDashboardComponent from '../../layouts/layout-dashboard.component'


export function Screens(props) {

  const {queueLoading, loading} = useLoading()
  const {confirm} = useConfirmationContext()
  const [quickDrawerOpen, setQuickDrawerOpen] = useState<boolean>(false)
  const handleFormOpen = useCallback(() => {setQuickDrawerOpen(true)}, [])
  const handleFormClose = useCallback(() => {setQuickDrawerOpen(false)}, [])
  const [pageSize, setPageSize] = useState<number>(5)
  const firestore = useFirestore()
  const screensCollection = collection(firestore, 'screens')
  const screensQuery = query(screensCollection, limit(pageSize))
  const {status, data} = useFirestoreCollectionData(screensQuery, {idField: '$id'})
  const screens = data || []

  const [error, setError] = useState(null)
  const handleFormSubmit = useCallback(async (values) => {
    if (loading) return
    if (error) setError(null)
    const dequeueLoading = queueLoading()
    const newId = createResourceUid()
    const timestamp = Timestamp.now()
    const newValues = {...values, createdAt: timestamp, updatedAt: timestamp}
    await setDoc(doc(firestore, 'screens', newId), newValues)
      .then(() => {handleFormClose()})
      .catch((error) => {
        console.error(error)
        setError({...error})
      })
      .finally(() => {dequeueLoading()})
  }, [firestore, error, loading, queueLoading, handleFormClose])

  const handleDeleteScreen = useCallback((id: string) => async () => {
    let dequeueLoading
    await confirm({
      title: 'Are you sure?',
      description: 'You are about to delete a screen from the application, please confirm the desired option. Press \'Delete\' to confirm and delete the item. Press \'Cancel\' to void the operation and close this dialog.',
      confirmationText: 'Delete',
      confirmationButtonProps: {color: 'error'},
    })
      .then(() => {dequeueLoading = queueLoading()})
      .then(() => {return deleteDoc(doc(firestore, 'screens', id))})
      .catch(() => {})
      .finally(() => {dequeueLoading && dequeueLoading()})
  }, [confirm, firestore, queueLoading])


  const columns: GridColumns = [
    {
      field: 'actions',
      type: 'actions',
      width: 100,
      getActions: ({id}) => [
        <GridActionsCellItem
          key="action-detail"
          icon={<MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} />}
          label="detail"
          component={AppLink}
          componentVariant="naked"
          hrefAs={`/screens/${id}`}
          href={`/screens/[screenId]`}
        />,
        <GridActionsCellItem
          key="action-delete"
          icon={<MdiIcon path={ICON_VARIANT_MODIFY_DELETE.path} />}
          label="Delete"
          onClick={handleDeleteScreen(id as string)}
          color="error"
        />,
      ],
    },
    {field: '$id', headerName: 'ID', type: 'string', flex: 1, minWidth: 150},
    {field: 'displayName', headerName: 'Display name', flex: 1, minWidth: 200, type: 'string'},
    {field: 'description', headerName: 'Description', flex: 1, minWidth: 275, type: 'string'},
    {field: 'updatedAt', headerName: 'Updated', flex: 1, minWidth: 150, type: 'date', valueFormatter: ({value}: any) => value?.toDate?.()},
    {field: 'createdAt', headerName: 'Created', flex: 1, minWidth: 150, type: 'date', valueFormatter: ({value}: any) => value?.toDate?.()},
  ]

  console.log('Screens props', props, data, status, screens)

  return (
    <LayoutDashboardComponent
      breadcrumbItems={[
        {
          children: 'Screens',
        },
      ]}
      header={{
        children: 'App Screens',
        icon: {path: ICON_VARIANT_PAGES.path},
      }}
      headerRight={(
        <Button
          size="small"
          variant="outlined"
          onClick={handleFormOpen}
        >
          {'Create New Screen'}
        </Button>
      )}
      aside={(
        <NavigationDrawerComponent
          open={quickDrawerOpen}
          anchor="right"
          variant="temporary"
          onClose={handleFormClose}
          appBarLeft={
            <Typography variant="h6" component="div">
              {'Create new screen'}
            </Typography>
          }
          appBarRight={
            <Button
              variant="outlined"
              color="primary"
              onClick={handleFormClose}
            >
              {'Cancel'}
            </Button>
          }
        >
          <ContainerComponent gutterY>
            <FormRenderer
              FormTemplate={AuthFormTemplateComponent}
              componentMapper={simpleComponentMapper}
              onSubmit={handleFormSubmit}
              schema={formSchema}
              subscription={{values: true}}
              clearOnUnmount
            />
            <AuthErrorAlertComponent
              error={error as any}
              sx={{mt: 2, mb: 1}}
            />
          </ContainerComponent>
        </NavigationDrawerComponent>
      )}
    >
      <ContainerComponent gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <WidgetCardComponent>
          <DataTableComponent
            rowHeight={TABLE_ROW_HEIGHT}
            getRowId={(row) => row.$id}
            columns={columns}
            noRowsLabel="No screens"
            rows={screens}
            loading={status === 'loading'}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            rowsPerPageOptions={[5, 10, 15]}
            pagination
          />
        </WidgetCardComponent>
      </ContainerComponent>
    </LayoutDashboardComponent>
  )
}
const formSchema = {
  'fields': [
    {
      'component': 'text-field',
      'name': 'displayName',
      'helperText': 'Friendly name for internal reference',
      'type': 'text', 'label': 'Display name',
      'isRequired': true,
      'validate': [
        {'type': 'required', 'message': 'Provide a display name'},
        {'type': 'max-length', 'threshold': 25, 'message': 'Must not exceed 25 characters'},
      ],
    }, {
      'component': 'textarea',
      'name': 'description',
      'label': 'Description',
      'helperText': 'Brief description for internal reference',
      'validate': [
        {'type': 'max-length', 'threshold': 80, 'message': 'Must not exceed 80 characters'},
      ],
    },
  ],
}
Screens.displayName = 'Page:Screens'
Screens.layoutComponent = LayoutConsoleComponent
Screens.layoutProps = {
  LayoutConsoleComponent: {
    title: 'App Screens',
    disableAppBarElevation: true,
  },
}

export default Screens
