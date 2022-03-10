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
import {MdiIcon} from '@aglyn/shared-ui-mdi-jsx'
import {Container} from '@mui/material'
import {GridActionsCellItem, type GridColumns} from '@mui/x-data-grid'
import {collection, orderBy, query} from 'firebase/firestore'
import {useFirestore, useFirestoreCollectionData} from 'reactfire'
import DataTableComponent from '../components/data-table.component'
import WidgetCardComponent from '../components/widget-card.component'
import {CONTENT_MAX_WIDTH} from '../constants/shared'
import LayoutDashboardComponent from '../layouts/layout-dashboard.component'


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
  {field: 'updatedAt', headerName: 'Updated', type: 'date'},
  {field: 'createdAt', headerName: 'Created', type: 'date'},
]

export function Screens(props) {

  const firestore = useFirestore()
  const screensCollection = collection(firestore, 'screens')
  const screensQuery = query(screensCollection, orderBy('createdAt', 'desc'))

  const {status, data: screens} = useFirestoreCollectionData(screensQuery, {
    idField: '$id', // this field will be added to the object created from each document
  }) as unknown as {status: string, data: AglynTenantHostScreen[]}

  console.log('Screens props', props, status, screens)
  return (
    <Container sx={{py: 3}} maxWidth={CONTENT_MAX_WIDTH}>

      <WidgetCardComponent>
        <DataTableComponent
          rowHeight={40}
          getRowId={(row) => row.id}
          columns={columns}
          noRowsLabel="No screens"
          rows={screens || []}
          loading={status === 'loading'}
        />
      </WidgetCardComponent>


    </Container>
  )
}
Screens.displayName = 'Page:Screens'
Screens.layoutComponent = LayoutDashboardComponent
Screens.layoutProps = {
  LayoutConsoleComponent: {
    title: 'App Screens',
  },
  LayoutDashboardComponent: {
    header: {
      children: 'Application Screens',
      icon: {path: ICON_VARIANT_PAGES.path},
    },
    breadcrumbItems: [
      {
        children: 'Screens',
      },
    ],
  },
}

export default Screens
