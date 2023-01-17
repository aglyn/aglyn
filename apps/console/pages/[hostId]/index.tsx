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

import { ICON_VARIANT_HOME } from '@aglyn/shared-data-enums'
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageWithLayout, useNextPageTitle } from '@aglyn/shared-ui-next'
import { useRouter } from 'next/router'
import DataTableComponent from '../../components/data-table.component'
import AuthenticatedLayout from '../../components/layouts/authenticated.layout'
import DashboardLayout from '../../components/layouts/dashboard.layout'
import MainLayout from '../../components/layouts/main.layout'
import CardDisplay from '../../components/card-display'
import { buildRoute, Route } from '../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../constants/shared'

const Index: NextPageWithLayout = (props) => {
  const { query } = useRouter()
  const hostId = query.hostId as string
  useNextPageTitle({ screen: 'My Dashboard' })

  return (
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
          id: 'nav-tab-setup',
          label: 'Setup',
          href: buildRoute(Route.HOST_SETUP, { hostId }),
        },
      ]}
      header={{
        children: 'My Dashboard',
        icon: { path: ICON_VARIANT_HOME.path },
      }}
      breadcrumbItems={[
        {
          children: hostId,
          href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
        },
      ]}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <GridItems
          spacing={3}
          items={[
            {
              xs: 12,
              md: 6,
              children: (
                <CardDisplay header={'Users'}>
                  <DataTableComponent
                    rowHeight={40}
                    getRowId={(row) => row.uid}
                    columns={[
                      { field: 'uid', headerName: 'User ID', type: 'string' },
                      {
                        field: 'displayName',
                        headerName: 'Display Name',
                        type: 'string',
                        width: 150,
                        maxWidth: 175,
                      },
                      {
                        field: 'email',
                        headerName: 'E-Mail',
                        type: 'string',
                        width: 175,
                        maxWidth: 200,
                      },
                      {
                        field: 'emailVerified',
                        headerName: 'E-Verified',
                        type: 'boolean',
                        maxWidth: 100,
                      },
                      {
                        field: 'created',
                        headerName: 'Created',
                        type: 'date',
                        maxWidth: 100,
                      },
                    ]}
                    rows={[]}
                  />
                </CardDisplay>
              ),
            },
            {
              xs: 12,
              md: 6,
              children: (
                <CardDisplay contentGutterX>hello</CardDisplay>
              ),
            },
          ]}
        />
      </Container>
    </DashboardLayout>
  )
}
Index.displayName = 'Page:Index'
Index.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'My Dashboard',
    },
  },
]

export default Index
