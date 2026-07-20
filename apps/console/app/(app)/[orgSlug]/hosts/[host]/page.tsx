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
import { useNextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useParams } from 'next/navigation'
import AuthenticatedLayout from '../../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../../components/layouts/main.layout'
import HostAnalyticsCard from '../../../../../components/analytics/host-analytics-card.component'
import CampaignGlanceCard from '../../../../../components/dashboard/campaign-glance-card.component'
import NewestSiteUsersCard from '../../../../../components/dashboard/newest-site-users-card.component'
import PluginWidgetSlot from '../../../../../components/plugin-widget-slot.component'
import HostDisplayNameComponent from '../../../../../components/host-display-name.component'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { useHostId, useHostSubdomain } from '../../../../../components/host-id-provider'
import { useOrgSlug } from '../../../../../hooks/use-org-scope'
import hostNavTabItems from '../../../../../constants/host-nav-tabs'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'

const Index: NextPageWithLayout<Record<string, never>> = (props) => {
  const params = useParams<{ hostId: string }>()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const hostId = useHostId()
  useNextPageTitle({ screen: 'My Dashboard' })

  return (
    <DashboardLayout
      navTabItems={hostNavTabItems(orgSlug, host)}
      help="consoleTour"
      header={{
        children: 'My Dashboard',
        icon: { path: ICON_VARIANT_HOME.path },
      }}
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
        },
      ]}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <GridItems
          spacing={3}
          items={[
            // Glanceable widgets (AGL-352/353): summaries only — the
            // Users and Analytics sections own the deep views. Feature
            // widgets (commerce, campaigns) hide until the host uses them.
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: (
                <HostAnalyticsCard
                  hostId={hostId}
                  viewAllHref={buildRoute(Route.HOST_ANALYTICS, { orgSlug,  host })}
                />
              ),
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <NewestSiteUsersCard hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <PluginWidgetSlot slot="commerceGlance" hostId={hostId} />,
            },
            {
              size: {
                xs: 12,
                md: 6,
              },
              children: <CampaignGlanceCard hostId={hostId} />,
            },
            // Announcement bar + popup moved to /marketing (AGL-251);
            // components, products, variables and functions to their own
            // pages (AGL-250); workflows to /workflows (AGL-128); datasets
            // to /data (AGL-132); site users to /users (AGL-350).
            {
              size: {
                xs: 12,
              },
              children: (
                <PluginWidgetSlot
                  slot="hostActivity"
                  hostId={hostId}
                  max={10}
                  viewAllHref={`${buildRoute(Route.HOST_SETUP, { orgSlug,  host })}?tab=activity`}
                />
              ),
            },
          ]}
        />
        {/* Plugin zone (AGL-433): widgets registered for dashboardFooter. */}
        <PluginWidgetSlot slot="dashboardFooter" hostId={hostId} />
      </Container>
    </DashboardLayout>
  )
}
Index.displayName = 'Page:Index'

export default Index
