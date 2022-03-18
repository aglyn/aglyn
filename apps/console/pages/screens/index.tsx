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

import type {AglynTenantHostScreen} from '@aglyn/core-data-framework'
import {
  ICON_VARIANT_MODIFY_DELETE,
  ICON_VARIANT_MODIFY_EDIT,
  ICON_VARIANT_PAGES,
} from '@aglyn/shared-data-enums'
import {ContainerComponent, NavigationDrawerComponent} from '@aglyn/shared-ui-jsx'
import {FormRenderer, simpleComponentMapper} from '@aglyn/shared-ui-jsx-forms'
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {Button, Container, Typography} from '@mui/material'
import {GridActionsCellItem, type GridColumns} from '@mui/x-data-grid'
import {collection, orderBy, query} from 'firebase/firestore'
import {useCallback, useState} from 'react'
import {useFirestore, useFirestoreCollectionData} from 'reactfire'
import AuthErrorAlertComponent from '../../components/auth-error-alert.component'
import AuthFormTemplateComponent from '../../components/auth-form-template.component'
import DataTableComponent from '../../components/data-table.component'
import WidgetCardComponent from '../../components/widget-card.component'
import {CONTENT_MAX_WIDTH} from '../../constants/shared'
import LayoutConsoleComponent from '../../layouts/layout-console.component'
import LayoutDashboardComponent from '../../layouts/layout-dashboard.component'


const columns: GridColumns = [
  {
    field: 'actions',
    type: 'actions',
    width: 100,
    getActions: () => [
      <GridActionsCellItem
        key="action-edit"
        icon={<MdiIcon path={ICON_VARIANT_MODIFY_EDIT.path} />}
        label="Edit"
      />,
      <GridActionsCellItem
        key="action-delete"
        icon={<MdiIcon path={ICON_VARIANT_MODIFY_DELETE.path} />}
        label="Delete"
      />,
    ],
  },
  {field: 'id', headerName: 'ID', type: 'string'},
  {field: 'updatedAt', headerName: 'Last Updated', type: 'date'},
  {field: 'createdAt', headerName: 'Created', type: 'date'},
]

export function Screens(props) {

  const [quickDrawerOpen, setQuickDrawerOpen] = useState<boolean>(false)
  const [pageSize, setPageSize] = useState<number>(5)
  const firestore = useFirestore()
  const screensCollection = collection(firestore, 'screens')
  const screensQuery = query(screensCollection, orderBy('createdAt', 'desc'))

  const {status, data: screens} = useFirestoreCollectionData(screensQuery, {
    idField: '$id', // this field will be added to the object created from each document
  }) as unknown as {status: string, data: AglynTenantHostScreen[]}

  const error = useState(null)
  const handleFormSubmit = useCallback(async (values) => {

  }, [])
  const handleFormOpen = useCallback(() => {
    setQuickDrawerOpen(true)
  }, [])
  const handleFormClose = useCallback(() => {
    setQuickDrawerOpen(false)
  }, [])
  console.log('Screens props', props, status, screens)
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
          variant="outlined"
          color="primary"
          onClick={handleFormOpen}
        >
          {'Add New Screen'}
        </Button>
      )}
    >
      <Container sx={{py: 3}} maxWidth={CONTENT_MAX_WIDTH}>

        <WidgetCardComponent>
          <DataTableComponent
            rowHeight={40}
            getRowId={(row) => row.id}
            columns={columns}
            noRowsLabel="No screens"
            rows={screens || []}
            loading={status === 'loading'}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            rowsPerPageOptions={[5, 10, 15]}
            pagination
          />
        </WidgetCardComponent>

        <NavigationDrawerComponent
          open={quickDrawerOpen}
          anchor="right"
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

      </Container>
    </LayoutDashboardComponent>
  )
}
const formSchema = {
  'fields': [
    {
      'component': 'text-field',
      'name': 'displayName ',
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
