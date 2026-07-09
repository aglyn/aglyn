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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import CommunityBrowse from '../../../components/community/community-browse.component'
import HostPluginsCard from '../../../components/community/host-plugins-card.component'
import FeatureGate from '../../../components/feature-gate.component'
import { useHostId } from '../../../components/host-id-provider'
import HostDisplayNameComponent from '../../../components/host-display-name.component'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import hostNavTabItems from '../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

const HostCommunity: NextPageWithLayout = () => {
  const hostId = useHostId()

  return (
    <>
      <NextPageTitle screen={'Community'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Community',
            href: buildRoute(Route.HOST_COMMUNITY, { hostId }),
          },
        ]}
        header={{
          children: 'Community',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <FeatureGate flag="release_community">
            <HostPluginsCard hostId={hostId} />
            <CommunityBrowse hostId={hostId} />
          </FeatureGate>
        </Container>
      </DashboardLayout>
    </>
  )
}
HostCommunity.displayName = 'Page:HostCommunity'
HostCommunity.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Community',
    },
  },
]

export default HostCommunity
