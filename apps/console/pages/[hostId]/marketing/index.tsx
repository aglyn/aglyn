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
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import AnnouncementBarCard from '../../../components/announcement-bar-card.component'
import HostCampaignsCard from '../../../components/host-campaigns-card.component'
import HostExperimentsCard from '../../../components/host-experiments-card.component'
import HostDisplayNameComponent from '../../../components/host-display-name.component'
import HostOverlaysCard from '../../../components/host-overlays-card.component'
import OrgListsCard from '../../../components/org-lists-card.component'
import { useHostId } from '../../../components/host-id-provider'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import PopupCard from '../../../components/popup-card.component'
import hostNavTabItems from '../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

/**
 * Marketing page (AGL-251): the announcement-bar and popup surfaces moved
 * off the dashboard, plus the multi-overlay manager with scheduling and
 * page targeting. Campaigns/automation surfaces join this section as they
 * land (AGL-254+).
 */
const HostMarketing: NextPageWithLayout = () => {
  const hostId = useHostId()

  return (
    <>
      <NextPageTitle screen={'Marketing'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Marketing',
            href: buildRoute(Route.HOST_MARKETING, { hostId }),
          },
        ]}
        header={{
          children: 'Marketing',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12 },
                children: <HostOverlaysCard hostId={hostId} />,
              },
              {
                size: { xs: 12, md: 6 },
                children: <AnnouncementBarCard hostId={hostId} />,
              },
              {
                size: { xs: 12, md: 6 },
                children: <PopupCard hostId={hostId} />,
              },
              // Email marketing (AGL-254): campaigns + org lists.
              {
                size: { xs: 12, md: 6 },
                children: <HostCampaignsCard hostId={hostId} />,
              },
              {
                size: { xs: 12, md: 6 },
                children: <OrgListsCard hostId={hostId} />,
              },
              // A/B experiments (AGL-252).
              {
                size: { xs: 12 },
                children: <HostExperimentsCard hostId={hostId} />,
              },
            ]}
          />
        </Container>
      </DashboardLayout>
    </>
  )
}
HostMarketing.displayName = 'Page:HostMarketing'
HostMarketing.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Marketing',
    },
  },
]

export default HostMarketing
