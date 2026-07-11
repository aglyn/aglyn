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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Stack } from '@mui/material'
import HostAnalyticsCard from '../../../components/analytics/host-analytics-card.component'
import CampaignGlanceCard from '../../../components/dashboard/campaign-glance-card.component'
import CommerceGlanceCard from '../../../components/dashboard/commerce-glance-card.component'
import { useHostId } from '../../../components/host-id-provider'
import HostDisplayNameComponent from '../../../components/host-display-name.component'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import hostNavTabItems from '../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

/**
 * Analytics deep dive (AGL-352): the full traffic panel plus commerce
 * and campaign performance in one place — the dashboard keeps only the
 * glanceable summaries.
 */
const HostAnalytics: NextPageWithLayout = () => {
  const hostId = useHostId()

  return (
    <>
      <NextPageTitle screen={'Analytics'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        activeTab={buildRoute(Route.HOST_ANALYTICS, { hostId })}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Analytics',
            href: buildRoute(Route.HOST_ANALYTICS, { hostId }),
          },
        ]}
        header={{
          children: 'Analytics',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <Stack spacing={3}>
            <HostAnalyticsCard hostId={hostId} />
            <CommerceGlanceCard hostId={hostId} />
            <CampaignGlanceCard hostId={hostId} />
          </Stack>
        </Container>
      </DashboardLayout>
    </>
  )
}
HostAnalytics.displayName = 'Page:HostAnalytics'
HostAnalytics.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Analytics' } },
]

export default HostAnalytics
