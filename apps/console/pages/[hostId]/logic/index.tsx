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
import HostDisplayNameComponent from '../../../components/host-display-name.component'
import HostFunctionsCard from '../../../components/host-functions-card.component'
import HostVariablesCard from '../../../components/host-variables-card.component'
import { useHostId } from '../../../components/host-id-provider'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import hostNavTabItems from '../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

/**
 * Logic page (AGL-250): variables and functions moved off the dashboard —
 * the component-builder primitives that screens bind to and workflows run.
 */
const HostLogic: NextPageWithLayout = () => {
  const hostId = useHostId()

  return (
    <>
      <NextPageTitle screen={'Logic'} />
      <DashboardLayout
        navTabItems={hostNavTabItems(hostId)}
        breadcrumbItems={[
          {
            children: <HostDisplayNameComponent hostId={hostId} />,
            href: buildRoute(Route.HOST_DASHBOARD, { hostId }),
          },
          {
            children: 'Logic',
            href: buildRoute(Route.HOST_LOGIC, { hostId }),
          },
        ]}
        header={{
          children: 'Functions & Variables',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12, md: 6 },
                children: <HostVariablesCard hostId={hostId} />,
              },
              {
                size: { xs: 12, md: 6 },
                children: <HostFunctionsCard hostId={hostId} />,
              },
            ]}
          />
        </Container>
      </DashboardLayout>
    </>
  )
}
HostLogic.displayName = 'Page:HostLogic'
HostLogic.layouts = [
  {
    Component: AuthenticatedLayout,
  },
  {
    Component: MainLayout,
    props: {
      title: 'Logic',
    },
  },
]

export default HostLogic
