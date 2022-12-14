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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useRouter } from 'next/router'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import WidgetCardComponent from '../../../components/widget-card.component'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

const HostSetup: NextPageWithLayout = (props) => {
  const { query } = useRouter()
  const hostId = query.hostId as string

  return (
    <>
      <NextPageTitle screen={'Host Setup'} />
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
        breadcrumbItems={[
          {
            children: hostId,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Setup',
            href: buildRoute(Route.HOST_SETUP, { hostId }),
          },
        ]}
        header={{
          children: 'Host Setup',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                xs: 12,
                md: 6,
                children: (
                  <WidgetCardComponent header={'Login'}>
                    hello
                  </WidgetCardComponent>
                ),
              },
              {
                xs: 12,
                md: 6,
                children: (
                  <WidgetCardComponent header={'Profile Details'}>
                    hello
                  </WidgetCardComponent>
                ),
              },
            ]}
          />
        </Container>
      </DashboardLayout>
    </>
  )
}
HostSetup.displayName = 'Page:HostSetup'
HostSetup.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Host Setup',
    },
  },
]

export default HostSetup
