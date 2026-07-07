/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { ICON_VARIANT_HOME } from '@aglyn/shared-data-enums'
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageWithLayout, useNextPageTitle } from '@aglyn/shared-ui-next'
import { useParams } from 'next/navigation'
import AuthenticatedLayout from '../../components/layouts/authenticated.layout'
import DashboardLayout from '../../components/layouts/dashboard.layout'
import MainLayout from '../../components/layouts/main.layout'
import HostAnalyticsCard from '../../components/analytics/host-analytics-card.component'
import HostProductsCard from '../../components/commerce/host-products-card.component'
import HostFunctionsCard from '../../components/host-functions-card.component'
import HostVariablesCard from '../../components/host-variables-card.component'
import HostWorkflowsCard from '../../components/host-workflows-card.component'
import HostComponentsCard from '../../components/host-components-card.component'
import HostActivityCard from '../../components/host-activity-card.component'
import HostDatasetsCard from '../../components/host-datasets-card.component'
import HostDisplayNameComponent from '../../components/host-display-name.component'
import HostMembersCard from '../../components/host-members-card.component'
import { buildRoute, Route } from '../../constants/route-links'
import hostNavTabItems from '../../constants/host-nav-tabs'
import { CONTENT_MAX_WIDTH } from '../../constants/shared'

const Index: NextPageWithLayout = (props) => {
  const params = useParams<{ hostId: string }>()
  const hostId = params?.hostId
  useNextPageTitle({ screen: 'My Dashboard' })

  return (
    <DashboardLayout
      navTabItems={hostNavTabItems(hostId)}
      header={{
        children: 'My Dashboard',
        icon: { path: ICON_VARIANT_HOME.path },
      }}
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
        },
      ]}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <GridItems
          spacing={3}
          items={[
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <HostMembersCard hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <HostAnalyticsCard hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <HostComponentsCard hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <HostProductsCard hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <HostVariablesCard hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <HostFunctionsCard hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <HostWorkflowsCard hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <HostDatasetsCard hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
              },
              children: <HostActivityCard hostId={hostId} />,
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
