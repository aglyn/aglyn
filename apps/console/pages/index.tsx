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

import {ICON_VARIANT_HOME} from '@aglyn/shared-data-enums'
import {GridItems} from '@aglyn/shared-ui-jsx'
import {Container} from '@mui/material'
import DataTableComponent from '../components/data-table.component'
import WidgetCardComponent from '../components/widget-card.component'
import {CONTENT_MAX_WIDTH} from '../constants/shared'
import LayoutConsoleComponent from '../layouts/layout-console.component'
import LayoutDashboardComponent from '../layouts/layout-dashboard.component'


export function Index(props) {

  console.log('index props', props)

  return (
    <LayoutDashboardComponent
      breadcrumbItems={[
        {
          children: 'Details',
        },
      ]}
      header={{
        children: 'My Dashboard',
        icon: {path: ICON_VARIANT_HOME.path},
      }}
    >
      <Container sx={{py: 3}} maxWidth={CONTENT_MAX_WIDTH}>
        <GridItems
          spacing={3}
          items={[
            {
              xs: 12, md: 6,
              children: (
                <WidgetCardComponent
                  header={'Users'}
                >
                  <DataTableComponent
                    rowHeight={40}
                    getRowId={(row) => row.uid}
                    columns={[
                      {field: 'uid', headerName: 'User ID', type: 'string'},
                      {field: 'displayName', headerName: 'Display Name', type: 'string', width: 150, maxWidth: 175},
                      {field: 'email', headerName: 'E-Mail', type: 'string', width: 175, maxWidth: 200},
                      {field: 'emailVerified', headerName: 'E-Verified', type: 'boolean', maxWidth: 100},
                      {field: 'created', headerName: 'Created', type: 'date', maxWidth: 100},
                    ]}
                    rows={[]}
                  />
                </WidgetCardComponent>
              ),
            },
            {
              xs: 12, md: 6,
              children: (
                <WidgetCardComponent contentGutterX>
                  hello
                </WidgetCardComponent>
              ),
            },
          ]}
        />
      </Container>
    </LayoutDashboardComponent>
  )
}
Index.displayName = 'Page:Index'
Index.layoutComponent = LayoutConsoleComponent
Index.layoutProps = {
  LayoutConsoleComponent: {
    title: 'My Dashboard',
    disableAppBarElevation: true,
  },
}

export default Index
